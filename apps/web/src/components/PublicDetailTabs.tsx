import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useDetailBrowsing, type DetailTab } from '../features/detailBrowsing'
import { useFeaturedMedia, useMediaItem, type MediaScope } from '../features/media'
import { usePublicEvent } from '../features/publicReads'
import { PublicSeriesEvents } from './PublicSeriesEvents'
import { FeaturedStrip } from './media/FeaturedStrip'
import { Lightbox } from './media/Lightbox'
import { MediaGallery } from './media/MediaGallery'
import { ReadState } from '../views/shared'

export function PublicDetailTabs({ scope }: { scope: MediaScope }) {
  const { t } = useTranslation()
  const series = scope.kind === 'open-mic'
  const { state, update, shuffleSeed, updateShuffleSeed } = useDetailBrowsing(series)
  const featured = useFeaturedMedia(series ? scope.id : undefined, true)
  const anchor = useMediaItem(state.media, true)
  const featuredAnchor = featured.data?.items.some((item) => item.id === anchor.data?.id)
  const anchorEvent = usePublicEvent(series && featured.isSuccess && !featuredAnchor ? anchor.data?.event_id ?? undefined : undefined)
  const [featuredId, setFeaturedId] = useState<string | null>(null)
  const origin = useRef<HTMLElement | null>(null)
  const tabRefs = useRef<Partial<Record<DetailTab, HTMLButtonElement>>>({})
  const tabs: DetailTab[] = series ? ['events', 'photos', 'videos'] : ['photos', 'videos']
  // A canonical media link selects its type; featured clicks intentionally never set this anchor.
  const anchorBelongsHere = anchor.data && (
    scope.kind === 'event' ? anchor.data.event_id === scope.id
      : scope.kind === 'open-mic' ? featuredAnchor || anchor.data.open_mic_id === scope.id || anchorEvent.data?.open_mic_id === scope.id
        : anchor.data.attribution?.profile_id === scope.id
  )
  const resolvingAnchor = Boolean(state.media) && (anchor.isPending || (series && Boolean(anchor.data?.event_id) && !featuredAnchor && (featured.isPending || (featured.isSuccess && anchorEvent.isPending))))
  const tab: DetailTab = state.media && anchor.data && anchorBelongsHere
    ? anchor.data.media_type === 'photo' ? 'photos' : 'videos'
    : state.tab
  const collection = (featured.data?.items ?? []).filter((item) =>
    tab === 'events' || item.media_type === (tab === 'photos' ? 'photo' : 'video'))
  const featuredIndex = collection.findIndex((item) => item.id === featuredId)
  const openFeatured = collection[featuredIndex]
  const chooseTab = (next: DetailTab, focus = false) => {
    update({ tab: next, media: undefined })
    if (focus) tabRefs.current[next]?.focus({ preventScroll: true })
  }
  const closeFeatured = () => {
    setFeaturedId(null)
    requestAnimationFrame(() => { if (origin.current?.isConnected) origin.current.focus({ preventScroll: true }) })
  }
  useEffect(() => {
    if (state.media && anchorBelongsHere && state.tab !== tab) update({ tab }, true)
  }, [state.media, state.tab, tab, anchorBelongsHere, update])
  const strip = collection.length > 0 && <FeaturedStrip items={collection} onOpen={(id) => {
    origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setFeaturedId(id)
  }} />
  return <section className="public-detail-tabs">
    {tab === 'events' && strip}
    <div className="public-tab-list" role="tablist" aria-label={t('browseSections')}>
      {tabs.map((value, index) => <button key={value} ref={(node) => { if (node) tabRefs.current[value] = node }}
        id={`detail-tab-${scope.id}-${value}`} role="tab" type="button"
        aria-selected={tab === value} aria-controls={`detail-panel-${scope.id}`}
        tabIndex={tab === value ? 0 : -1} onClick={() => chooseTab(value)}
        onKeyDown={(event) => {
          const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
            : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length]
              : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : undefined
          if (next) { event.preventDefault(); chooseTab(next, true) }
        }}>{t(value === 'events' ? 'browseEvents' : value === 'photos' ? 'mediaFilterPhotos' : 'mediaFilterVideos')}</button>)}
    </div>
    <div id={`detail-panel-${scope.id}`} role="tabpanel" aria-labelledby={`detail-tab-${scope.id}-${tab}`} tabIndex={0}>
      {series && featured.isError && <ReadState message={t('browseFeaturedError')} retry={() => void featured.refetch()} />}
      {state.media && !resolvingAnchor && !anchorBelongsHere && <p role="status">{t('mediaUnavailableNotice')}</p>}
      {resolvingAnchor && <ReadState message={t('loading')} />}
      {tab === 'events' ? <PublicSeriesEvents id={scope.id} filters={{ period: state.period, page: state.page, year: state.year, month: state.month }} onChange={update} />
        : <>
          {strip}
          {!resolvingAnchor && (!series || featured.isSuccess) && <MediaGallery key={`${scope.kind}-${scope.id}-${tab}`} scope={scope}
            fixedType={tab === 'photos' ? 'photo' : 'video'} publicView controlledSort={state.sort}
            initialShuffleSeed={shuffleSeed}
            onShuffleSeedChange={updateShuffleSeed}
            onSortChange={(sort) => update({ sort })} initialOpenId={anchorBelongsHere ? state.media : undefined}
            onCloseAnchor={() => update({ media: undefined }, true)}
            featuredItems={series ? collection : undefined} />}
          {series && featured.isPending && <ReadState message={t('loading')} />}
        </>}
    </div>
    {openFeatured && <Lightbox item={openFeatured} position={{ index: featuredIndex, total: collection.length }}
      hasPrev={featuredIndex > 0} hasNext={featuredIndex < collection.length - 1}
      onClose={closeFeatured} onNavigate={(direction) => {
        const index = direction === 'first' ? 0 : direction === 'last' ? collection.length - 1
          : featuredIndex + (direction === 'next' ? 1 : -1)
        if (collection[index]) setFeaturedId(collection[index].id)
      }}
      browseActions={<>
        <button className="quiet-button" type="button" onClick={() => { closeFeatured(); chooseTab('photos', true) }}>{t('browseAllPhotos')}</button>
        <button className="quiet-button" type="button" onClick={() => { closeFeatured(); chooseTab('videos', true) }}>{t('browseAllVideos')}</button>
        {openFeatured.event_id && <Link className="quiet-button" to="/events/$eventId" params={{ eventId: openFeatured.event_id }} onClick={closeFeatured}>{t('browseViewEvent')}</Link>}
      </>} />}
  </section>
}
