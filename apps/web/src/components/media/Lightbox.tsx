import { useCallback, useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Download, ExternalLink, Share2, X } from 'lucide-react'

import type { MediaItem } from '../../features/media'
import { resolveCaption } from '../../features/media-captions'
import { captionValuesOf } from './MediaGallery'
import { SocialButton } from '../../views/shared'

function videoEmbedUrl(item: MediaItem): string | null {
  if (item.media_type !== 'video' || !item.platform_video_id) return null
  if (item.video_platform === 'youtube') {
    return `https://www.youtube-nocookie.com/embed/${item.platform_video_id}?enablejsapi=0&rel=0&autoplay=1&mute=1`
  }
  if (item.video_platform === 'vimeo') {
    return `https://player.vimeo.com/video/${item.platform_video_id}?dnt=1&autoplay=1&muted=1`
  }
  return null
}

export function videoWatchUrl(item: MediaItem): string | null {
  if (item.media_type !== 'video' || !item.platform_video_id) return null
  return item.video_platform === 'youtube'
    ? `https://www.youtube.com/watch?v=${item.platform_video_id}`
    : `https://vimeo.com/${item.platform_video_id}`
}

/** {series-slug}-{event-date}-{performer-or-media-id}.{ext} (design §6.4). */
export function downloadFileName(item: MediaItem): string {
  const slug = (item.caption_context.series_name ?? 'open-mic').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const date = item.caption_context.event_starts_at ? item.caption_context.event_starts_at.slice(0, 10) : 'media'
  const subject = item.attribution?.performer_name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || item.id
  const extension = item.source_url.split('.').pop()?.split('?')[0] || 'jpg'
  return `${slug}-${date}-${subject}.${extension}`
}

export type LightboxProps = {
  item: MediaItem
  position: { index: number; total: number }
  onClose: () => void
  onNavigate: (direction: 'prev' | 'next' | 'first' | 'last') => void
  hasPrev: boolean
  hasNext: boolean
  organizerActions?: React.ReactNode
  browseActions?: React.ReactNode
}

export function Lightbox(props: LightboxProps) {
  // Per-item state (zoom, caption expansion, image failure, share toast) lives in the
  // keyed content component so navigating resets it naturally — and the provider iframe
  // remounts on Prev/Next so audio stops immediately (§6.3).
  return <LightboxContent key={props.item.id} {...props} />
}

function LightboxContent({ item, position, onClose, onNavigate, hasPrev, hasNext, organizerActions, browseActions }: LightboxProps) {
  const { t } = useTranslation()
  const [zoom, setZoom] = useState(1)
  const [showFullCaption, setShowFullCaption] = useState(false)
  const [shareMessage, setShareMessage] = useState('')
  const [imageFailed, setImageFailed] = useState(false)
  const shareTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mediaRef = useRef<HTMLDivElement>(null)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null)

  useEffect(() => () => { if (shareTimer.current) clearTimeout(shareTimer.current) }, [])

  const caption = resolveCaption(item.caption, captionValuesOf(item), 'long')
  const embedUrl = videoEmbedUrl(item)
  const watchUrl = videoWatchUrl(item)
  const deepLink = `${window.location.origin}/media/${item.id}`
  const imageSrc = item.renditions?.lightbox?.url ?? item.renditions?.original?.url ?? item.source_url

  // Keyboard navigation (§6.6). Document-level (focus-independent): the per-item remount
  // drops DOM focus, and arrow keys must work wherever focus lands inside the lightbox.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      if (event.key === 'ArrowLeft') { event.preventDefault(); onNavigate('prev') }
      else if (event.key === 'ArrowRight') { event.preventDefault(); onNavigate('next') }
      else if (event.key === 'Home') { event.preventDefault(); onNavigate('first') }
      else if (event.key === 'End') { event.preventDefault(); onNavigate('last') }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onNavigate])

  const share = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: item.alt_text, url: deepLink })
        return
      } catch (error) {
        if ((error as DOMException).name === 'AbortError') return
      }
    }
    await navigator.clipboard.writeText(deepLink).catch(() => {})
    setShareMessage(t('mediaLinkCopied'))
    if (shareTimer.current) clearTimeout(shareTimer.current)
    shareTimer.current = setTimeout(() => setShareMessage(''), 2500)
  }, [deepLink, item.alt_text, t])

  // Zoom: wheel on desktop, double-click/double-tap toggles fit ↔ 2×, pinch on touch (§6.2).
  const onWheel = useCallback((event: React.WheelEvent) => {
    if (item.media_type !== 'photo') return
    event.preventDefault()
    setZoom((current) => Math.min(4, Math.max(1, current - Math.sign(event.deltaY) * 0.25)))
  }, [item.media_type])

  const onDoubleClick = useCallback(() => {
    if (item.media_type === 'photo') setZoom((current) => (current > 1 ? 1 : 2))
  }, [item.media_type])

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinchStart.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom }
    }
  }, [zoom])

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (!pointers.current.has(event.pointerId)) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()]
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      setZoom(Math.min(4, Math.max(1, pinchStart.current.zoom * (distance / Math.max(1, pinchStart.current.distance)))))
    }
  }, [])

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinchStart.current = null
  }, [])

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="media-lightbox-backdrop" />
        <Dialog.Content
          className="media-lightbox"
          aria-label={item.alt_text}
        >
          <Dialog.Title className="visually-hidden">{item.alt_text}</Dialog.Title>
          <div className="media-lightbox-toolbar">
            <span className="media-lightbox-position" aria-live="polite">{t('mediaPosition', { index: position.index + 1, total: position.total })}</span>
            <div className="media-lightbox-actions">
              <SocialButton label="React" icon="heart" />
              <SocialButton label="Comment" icon="message" />
              <button type="button" className="quiet-button icon-button" onClick={() => void share()} aria-label={t('mediaShare')} title={t('mediaShare')}><Share2 size={17} /></button>
              {item.media_type === 'photo' && (
                // Direct CDN link via <a download> (settled: no signed URL, no endpoint).
                <a
                  className="quiet-button icon-button"
                  href={item.renditions?.original?.url ?? item.source_url}
                  download={downloadFileName(item)}
                  aria-label={t('mediaDownload')}
                  title={t('mediaDownload')}
                ><Download size={17} /></a>
              )}
              {watchUrl && (
                <a className="quiet-button icon-button" href={watchUrl} target="_blank" rel="noreferrer" aria-label={t('mediaWatchOnProvider', { provider: item.video_platform === 'youtube' ? 'YouTube' : 'Vimeo' })} title={t('mediaWatchOnProvider', { provider: item.video_platform === 'youtube' ? 'YouTube' : 'Vimeo' })}>
                  <ExternalLink size={17} />
                </a>
              )}
              <Dialog.Close asChild>
                <button type="button" className="quiet-button icon-button" aria-label={t('close')} title={t('close')}><X size={17} /></button>
              </Dialog.Close>
            </div>
          </div>

          <div className="media-lightbox-body">
            {hasPrev && <button type="button" className="media-lightbox-nav media-lightbox-prev" onClick={() => onNavigate('prev')} aria-label={t('mediaPrevious')}><ChevronLeft size={28} /></button>}
            <div
              ref={mediaRef}
              className="media-lightbox-media"
              onWheel={onWheel}
              onDoubleClick={onDoubleClick}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {item.media_type === 'video' ? (
                embedUrl ? (
                  <iframe
                    key={item.id}
                    src={embedUrl}
                    title={item.alt_text}
                    allow="autoplay; fullscreen; picture-in-picture"
                    allowFullScreen
                    className="media-lightbox-video"
                  />
                ) : (
                  <div className="media-unavailable" role="status">{t('mediaVideoUnavailable')}</div>
                )
              ) : imageFailed ? (
                <div className="media-unavailable" role="alert">
                  <span>{t('mediaImageUnavailable')}</span>
                  <button type="button" className="link-button" onClick={() => setImageFailed(false)}>{t('tryAgain')}</button>
                </div>
              ) : (
                <img
                  key={item.id}
                  src={imageSrc}
                  alt={item.alt_text}
                  onError={() => setImageFailed(true)}
                  style={{ transform: zoom > 1 ? `scale(${zoom})` : undefined }}
                  draggable={false}
                />
              )}
            </div>
            {hasNext && <button type="button" className="media-lightbox-nav media-lightbox-next" onClick={() => onNavigate('next')} aria-label={t('mediaNext')}><ChevronRight size={28} /></button>}
          </div>

          <div className="media-lightbox-detail">
            {item.attribution && (
              <p className="media-attribution">
                {item.attribution.profile_handle ? (
                  <Link to="/@{$handle}" params={{ handle: item.attribution.profile_handle }} onClick={onClose}>
                    {item.attribution.performer_name}
                  </Link>
                ) : (
                  item.attribution.performer_name
                )}
                {item.attribution.performer_city && <span className="field-hint"> · {item.attribution.performer_city}</span>}
              </p>
            )}
            {caption && (
              <p className={`media-caption${showFullCaption ? ' expanded' : ''}`}>
                {caption}
                {caption.length > 180 && (
                  <button type="button" className="link-button" onClick={() => setShowFullCaption((current) => !current)}>
                    {showFullCaption ? t('mediaShowLess') : t('mediaShowMore')}
                  </button>
                )}
              </p>
            )}
            {organizerActions && <div className="media-lightbox-organizer">{organizerActions}</div>}
            {browseActions && <div className="media-lightbox-browse">{browseActions}</div>}
            {shareMessage && <p className="media-toast" role="status">{shareMessage}</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
