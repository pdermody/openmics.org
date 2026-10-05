import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play } from 'lucide-react'

import { flattenMediaPages, useMediaList, type MediaItem, type MediaScope, type MediaSort, type MediaTypeFilter } from '../../features/media'
import { resolveCaption, type CaptionValues } from '../../features/media-captions'
import { Lightbox } from './Lightbox'
import { useMasonry } from './useMasonry'

// JS-balanced masonry (design §5.1): items are assigned to the currently-shortest column
// in code and absolutely positioned, so visual order, DOM order, and the active sort all
// agree — a pure CSS multi-column layout is ruled out because it fills column-major.
const MIN_TILE_WIDTH = 240

/** Effective tile aspect ratio (h/w): intrinsic dims for photos (capped per §5.1), 16:9 for videos. */
export function tileAspectRatio(item: MediaItem): number {
  if (item.media_type === 'video') return 9 / 16
  if (item.width && item.height) {
    const ratio = item.height / item.width
    return Math.min(Math.max(ratio, 9 / 16), 16 / 9)
  }
  // Renditions not yet processed: neutral placeholder ratio keeps the grid stable.
  return 2 / 3
}

export function tileImageSource(item: MediaItem): { src: string; srcSet?: string } {
  if (item.media_type === 'video') return { src: item.thumbnail_url ?? '' }
  const renditions = item.renditions
  if (renditions?.grid) {
    const srcSet = [
      renditions.thumb ? `${renditions.thumb.url} ${renditions.thumb.width}w` : null,
      `${renditions.grid.url} ${renditions.grid.width}w`,
      renditions.lightbox ? `${renditions.lightbox.url} ${renditions.lightbox.width}w` : null,
    ].filter(Boolean).join(', ')
    return { src: renditions.grid.url, srcSet }
  }
  return { src: item.source_url }
}

export function captionValuesOf(item: MediaItem): CaptionValues {
  return {
    performerName: item.attribution?.performer_name,
    performerCity: item.attribution?.performer_city,
    eventName: item.caption_context.event_name,
    eventDate: item.caption_context.event_starts_at
      ? new Date(item.caption_context.event_starts_at).toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: item.caption_context.event_time_zone ?? undefined })
      : null,
  }
}

const SORT_STORAGE_KEY = 'openmic-media-sort'
const TYPE_STORAGE_KEY = 'openmic-media-type-filter'

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const value = localStorage.getItem(key)
  return allowed.includes(value as T) ? (value as T) : fallback
}

export type MediaGalleryProps = {
  scope: MediaScope
  /** Deep-link/anchor: open the lightbox on this media id once its window has loaded. */
  initialOpenId?: string | null
  /** Profile galleries omit the type filter chip (design §11.2). */
  hideTypeFilter?: boolean
  /** Series pages render the Featured strip above the grid (hidden while a filter is active). */
  featuredStrip?: (openLightbox: (mediaId: string) => void) => React.ReactNode
  /** Series pages pass the Featured pins so the lightbox navigates featured → grid as one
      continuous list (§6.6); the grid fetch excludes them to avoid showing them twice. */
  featuredItems?: MediaItem[]
  /** Optional organizer toolbar rendered inside the lightbox for owned media. */
  renderLightboxOrganizerActions?: (item: MediaItem, close: () => void) => React.ReactNode
  canManageItem?: (item: MediaItem) => boolean
  fixedType?: 'photo' | 'video'
  publicView?: boolean
  controlledSort?: MediaSort
  onSortChange?: (sort: MediaSort) => void
  onCloseAnchor?: () => void
  initialShuffleSeed?: number
  onShuffleSeedChange?: (seed: number) => void
}

export function MediaGallery({ scope, initialOpenId, hideTypeFilter = false, featuredStrip, featuredItems, renderLightboxOrganizerActions, canManageItem, fixedType, publicView = false, controlledSort, onSortChange, onCloseAnchor, initialShuffleSeed, onShuffleSeedChange }: MediaGalleryProps) {
  const { t } = useTranslation()
  // URL query wins on mount and is written back to localStorage; localStorage seeds the
  // default otherwise (design §11.1). Mount-time read via window.location (not the
  // router's useSearch) so the gallery works outside a matched route as well.
  const [search] = useState(() => new URLSearchParams(window.location.search))
  const [storedTypeFilter, setTypeFilter] = useState<MediaTypeFilter>(() => {
    const fromUrl = search.get('type')
    if (fromUrl === 'photo' || fromUrl === 'video' || fromUrl === 'all') return fromUrl
    return readStored(TYPE_STORAGE_KEY, ['all', 'photo', 'video'] as const, 'all')
  })
  const typeFilter = fixedType ?? storedTypeFilter
  const [storedSort, setSort] = useState<MediaSort>(() => {
    const fromUrl = search.get('sort')
    if (fromUrl === 'shuffle' || fromUrl === 'newest') return fromUrl
    return readStored(SORT_STORAGE_KEY, ['newest', 'shuffle'] as const, 'newest')
  })
  const sort = controlledSort ?? storedSort
  // The shuffle seed lives in memory + history.state — never in the URL (§11.1).
  const [localShuffleSeed, setShuffleSeed] = useState<number>(() => {
    if (initialShuffleSeed !== undefined) return initialShuffleSeed
    const state = window.history.state as { mediaShuffleSeed?: number } | null
    return typeof state?.mediaShuffleSeed === 'number' ? state.mediaShuffleSeed : Math.floor(Math.random() * 2 ** 31)
  })
  const shuffleSeed = initialShuffleSeed ?? localShuffleSeed

  useEffect(() => {
    if (fixedType) return
    localStorage.setItem(TYPE_STORAGE_KEY, typeFilter)
    if (search.get('type') !== typeFilter) {
      const url = new URL(window.location.href)
      if (typeFilter === 'all') url.searchParams.delete('type')
      else url.searchParams.set('type', typeFilter)
      window.history.replaceState(window.history.state, '', url.toString())
    }
  }, [typeFilter, fixedType]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (controlledSort !== undefined) return
    localStorage.setItem(SORT_STORAGE_KEY, sort)
    if (search.get('sort') !== sort) {
      const url = new URL(window.location.href)
      if (sort === 'newest') url.searchParams.delete('sort')
      else url.searchParams.set('sort', sort)
      window.history.replaceState({ ...(window.history.state ?? {}), mediaShuffleSeed: shuffleSeed }, '', url.toString())
    }
  }, [sort, shuffleSeed, controlledSort]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the loaded deep-link window when closing its viewer.
  const [queryAnchor, setQueryAnchor] = useState(initialOpenId)
  if (initialOpenId && queryAnchor !== initialOpenId) setQueryAnchor(initialOpenId)
  const query = useMediaList(scope, {
    type: typeFilter,
    sort,
    seed: sort === 'shuffle' ? shuffleSeed : undefined,
    anchor: featuredItems?.some((item) => item.id === queryAnchor) ? undefined : queryAnchor ?? undefined,
    // Featured pins render in the strip, not the masonry — but only while the strip is
    // visible ('all' filter); filtering rejoins them so Photos shows every photo (§11.4).
    excludeFeatured: (Boolean(fixedType) || typeFilter === 'all') && featuredItems !== undefined,
    publicView,
  })
  const items = useMemo(() => flattenMediaPages(query.data), [query.data])

  // One continuous lightbox sequence: Featured pins first (manual order), then the grid.
  // The filter defensively dedupes — when a type filter is active the grid re-includes
  // featured items (exclusion off), and indexOf resolves them at their strip position.
  const navItems = useMemo(() => {
    if (!featuredItems || featuredItems.length === 0) return items
    const featuredIds = new Set(featuredItems.map((item) => item.id))
    return [...featuredItems, ...items.filter((item) => !featuredIds.has(item.id))]
  }, [featuredItems, items])

  // Reshuffle on refresh is a feature; a fresh page load generates a new seed in useState.
  const reShuffle = () => {
    const seed = Math.floor(Math.random() * 2 ** 31)
    setShuffleSeed(seed)
    onShuffleSeedChange?.(seed)
  }

  // ------------------------------------------------------------------
  // Balanced masonry layout (shared engine; public tiles are image-only height)
  // ------------------------------------------------------------------
  const containerRef = useRef<HTMLDivElement | null>(null)
  const tileHeight = useCallback((index: number, columnWidth: number) => columnWidth * tileAspectRatio(items[index]), [items])
  const { ref: setMasonryRef, layout } = useMasonry(items.length, tileHeight)
  // Keep containerRef in sync for scroll-into-view on lightbox close.
  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node
    setMasonryRef(node)
  }, [setMasonryRef])

  // ------------------------------------------------------------------
  // Hybrid infinite scroll: two auto-pages, then explicit Load more (§11.3)
  // ------------------------------------------------------------------
  const autoPagesFetched = useRef(Math.max(0, (query.data?.pages.length ?? 1) - 1))
  const sentinelRef = useRef<HTMLDivElement>(null)
  const hasNext = Boolean(query.hasNextPage)
  useEffect(() => {
    autoPagesFetched.current = Math.max(0, (query.data?.pages.length ?? 1) - 1)
  }, [typeFilter, sort, shuffleSeed, scope.kind, scope.id])
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasNext || autoPagesFetched.current >= 2) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && autoPagesFetched.current < 2 && !query.isFetchingNextPage) {
        autoPagesFetched.current += 1
        void query.fetchNextPage()
      }
    })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNext, query.isFetchingNextPage, query.fetchNextPage])

  // ------------------------------------------------------------------
  // Lightbox
  // ------------------------------------------------------------------
  const [openId, setOpenId] = useState<string | null>(null)
  const tileRefs = useRef(new Map<string, HTMLButtonElement>())
  const focusOrigin = useRef<HTMLElement | null>(null)
  const openItem = navItems.find((item) => item.id === openId) ?? null

  // Deep-link: open the lightbox once the anchor window has loaded. Checks the combined
  // nav list — a deep-linked Featured pin is excluded from the grid window (§5.1).
  useEffect(() => {
    if (initialOpenId && !query.isPending && navItems.some((item) => item.id === initialOpenId)) {
      setOpenId(initialOpenId)
    }
  }, [initialOpenId, query.isPending, navItems])

  const openLightbox = useCallback((mediaId: string) => {
    focusOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setOpenId(mediaId)
  }, [])

  const closeLightbox = () => {
    setOpenId(null)
    onCloseAnchor?.()
    const origin = focusOrigin.current ?? (openId ? tileRefs.current.get(openId) : undefined)
    requestAnimationFrame(() => {
      if (origin?.isConnected) {
        origin.scrollIntoView({ block: 'nearest' })
        origin.focus({ preventScroll: true })
      }
    })
  }

  // Prefetch the next page as the lightbox approaches the loaded edge (±1 page rule).
  const openIndex = openItem ? navItems.indexOf(openItem) : -1
  const openGridIndex = openItem ? items.indexOf(openItem) : -1
  useEffect(() => {
    if (openGridIndex >= 0 && openGridIndex >= items.length - 3 && query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage()
    }
  }, [openGridIndex, items.length, query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage])

  const navigateLightbox = useCallback((direction: 'prev' | 'next' | 'first' | 'last') => {
    if (openIndex < 0) return
    const target = direction === 'prev' ? openIndex - 1
      : direction === 'next' ? openIndex + 1
        : direction === 'first' ? 0
          : navItems.length - 1
    if (target < 0 || target >= navItems.length) return
    setOpenId(navItems[target].id)
  }, [openIndex, navItems])

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  // Empty public view: the whole section is hidden (§5.5).
  if (!fixedType && !query.isPending && !query.isError && items.length === 0 && !featuredStrip) return null

  return (
    <section className="media-gallery" aria-label={t('mediaGalleryHeading')}>
      <div className="media-gallery-controls">
        {!hideTypeFilter && !fixedType && (
          <div className="media-filter-chips" role="group" aria-label={t('mediaTypeFilter')}>
            {(['all', 'photo', 'video'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`filter-chip${typeFilter === value ? ' active' : ''}`}
                aria-pressed={typeFilter === value}
                onClick={() => setTypeFilter(value)}
              >
                {value === 'all' ? t('mediaFilterAll') : value === 'photo' ? t('mediaFilterPhotos') : t('mediaFilterVideos')}
              </button>
            ))}
          </div>
        )}
        <div className="media-sort-control">
          <label htmlFor={`media-sort-${scope.kind}-${scope.id}`}>{t('mediaSortLabel')}</label>
          <select
            id={`media-sort-${scope.kind}-${scope.id}`}
            value={sort}
            onChange={(event) => {
              const value = event.target.value === 'shuffle' ? 'shuffle' : 'newest'
              if (onSortChange) onSortChange(value)
              else setSort(value)
            }}
          >
            <option value="newest">{t('mediaSortNewest')}</option>
            <option value="shuffle">{t('mediaSortShuffle')}</option>
            {/* Most liked stays hidden until reactions ship (§11.1). */}
          </select>
          {sort === 'shuffle' && (
            <button type="button" className="link-button" onClick={reShuffle}>{t('mediaReshuffle')}</button>
          )}
        </div>
      </div>

      {featuredStrip && typeFilter === 'all' ? featuredStrip(openLightbox) : null}
      {fixedType && !query.isPending && !query.isError && items.length === 0 && !featuredItems?.length && (
        <p className="field-hint">{t(fixedType === 'photo' ? 'browseNoPhotos' : 'browseNoVideos')}</p>
      )}

      {query.isPending && (
        <div className="media-masonry" ref={setContainerRef} aria-busy="true">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="media-tile media-tile-skeleton" style={{ position: 'relative', aspectRatio: '3 / 2' }} />
          ))}
        </div>
      )}

      {query.isError && (
        <div className="read-state" role="alert">
          <span>{t('mediaGalleryLoadError')}</span>
          <button className="link-button" type="button" onClick={() => void query.refetch()}>{t('tryAgain')}</button>
        </div>
      )}

      {/* A filter (photo/video) or sort can legitimately yield zero items while the section
          stays mounted (e.g. a Featured strip is present). Show a hint instead of vanishing.
          When everything is featured the strip already says it all — suppress the hint. */}
      {!query.isPending && !query.isError && items.length === 0 && featuredStrip && (typeFilter !== 'all' || (featuredItems?.length ?? 0) === 0) && (
        <p className="media-gallery-empty field-hint">{t('mediaEmptyFiltered')}</p>
      )}

      {!query.isPending && !query.isError && items.length > 0 && (
        <div className="media-masonry" ref={setContainerRef} style={{ position: 'relative', height: layout.height || undefined }}>
          {items.map((item, index) => {
            const position = layout.positions[index]
            const caption = resolveCaption(item.caption, captionValuesOf(item), scope.kind === 'open-mic' ? 'long' : 'short')
            const { src, srcSet } = tileImageSource(item)
            return (
              <button
                key={item.id}
                ref={(node) => { if (node) tileRefs.current.set(item.id, node); else tileRefs.current.delete(item.id) }}
                type="button"
                className={`media-tile${item.media_type === 'video' ? ' media-tile-video' : ''}`}
                style={position ? { position: 'absolute', left: position.left, top: position.top, width: position.width, height: position.height } : { position: 'relative', visibility: 'hidden' }}
                onClick={() => openLightbox(item.id)}
                aria-label={item.alt_text}
              >
                {src && <img src={src} srcSet={srcSet || undefined} sizes={`${MIN_TILE_WIDTH}px`} alt="" loading="lazy" />}
                {item.media_type === 'video' && <span className="media-tile-play" aria-hidden="true"><Play size={22} /></span>}
                {caption && <span className="media-tile-caption">{caption}</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* Sentinel drives the two auto-loaded pages; afterwards an explicit button (§11.3). */}
      {hasNext && <div ref={sentinelRef} className="media-load-sentinel" aria-hidden="true" />}
      {query.isFetchingNextPage && (
        <div className="media-tile-skeleton-row" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="media-tile media-tile-skeleton" style={{ aspectRatio: '3 / 2' }} />)}
        </div>
      )}
      {hasNext && autoPagesFetched.current >= 2 && !query.isFetchingNextPage && (
        <button type="button" className="secondary-button media-load-more" onClick={() => void query.fetchNextPage()}>
          {t('mediaLoadMore')}
        </button>
      )}
      {query.isError && items.length > 0 && (
        <div className="read-state" role="alert">
          <span>{t('mediaLoadMoreError')}</span>
          <button className="link-button" type="button" onClick={() => void query.fetchNextPage()}>{t('tryAgain')}</button>
        </div>
      )}
      {!hasNext && !query.isPending && items.length > 0 && (
        <p className="media-gallery-end">{t('mediaGalleryEnd')} <a href="#top" onClick={(event) => { event.preventDefault(); containerRef.current?.scrollIntoView({ behavior: 'smooth' }) }}>{t('mediaBackToTop')}</a></p>
      )}

      {openItem && (
        <Lightbox
          item={openItem}
          position={{ index: openIndex, total: navItems.length }}
          onClose={closeLightbox}
          onNavigate={navigateLightbox}
          hasPrev={openIndex > 0}
          hasNext={openIndex >= 0 && (openIndex < navItems.length - 1 || Boolean(query.hasNextPage))}
          organizerActions={renderLightboxOrganizerActions && canManageItem?.(openItem) ? renderLightboxOrganizerActions(openItem, closeLightbox) : undefined}
        />
      )}
    </section>
  )
}
