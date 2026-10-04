import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play, Star, Trash2 } from 'lucide-react'

import type { MediaItem } from '../../features/media'
import { resolveCaption } from '../../features/media-captions'
import { captionValuesOf, tileImageSource } from './MediaGallery'

export type ManageSort = 'newest' | 'oldest' | 'caption' | 'performer'

export function sortManageItems(items: MediaItem[], sort: ManageSort): MediaItem[] {
  const sorted = [...items]
  switch (sort) {
    case 'oldest':
      return sorted.sort((a, b) => a.created_at.localeCompare(b.created_at))
    case 'caption':
      return sorted.sort((a, b) => (resolveCaption(a.caption, captionValuesOf(a), 'short') || '').localeCompare(resolveCaption(b.caption, captionValuesOf(b), 'short') || ''))
    case 'performer':
      return sorted.sort((a, b) => (a.attribution?.performer_name ?? '￿').localeCompare(b.attribution?.performer_name ?? '￿'))
    case 'newest':
    default:
      return sorted.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
}

export type MediaManageGridProps = {
  items: MediaItem[]
  /** Event scope enables the per-tile attribution dropdown. */
  attributionOptions?: { id: string; performer_name: string; performer_city?: string | null }[]
  /** Series scope enables the Pin-to-Featured action. */
  featuredIds?: Set<string>
  onToggleFeatured?: (item: MediaItem) => void
  /** Tile click outside selection mode: opens the lightbox with organizer actions (§6.4). */
  onOpen: (item: MediaItem) => void
  onEditCaption: (item: MediaItem) => void
  onChangeAttribution: (item: MediaItem, registrationId: string | null) => void
  onSoftDelete: (item: MediaItem) => void
  bulkDelete: (ids: string[]) => void
  bulkAttribute?: (ids: string[], registrationId: string | null) => void
}

// The organizer manage grid (design §8.4): same masonry feel as the public gallery, a
// persistent per-tile toolbar (touch-sized targets), and an explicit selection mode —
// identical for mouse, keyboard, and touch (no long-press, no hover dependency).
export function MediaManageGrid({ items, attributionOptions, featuredIds, onToggleFeatured, onOpen, onEditCaption, onChangeAttribution, onSoftDelete, bulkDelete, bulkAttribute }: MediaManageGridProps) {
  const { t } = useTranslation()
  const [selectionMode, setSelectionMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkAttribution, setBulkAttribution] = useState('')

  const toggleSelect = (id: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const exitSelectionMode = () => {
    setSelectionMode(false)
    setSelected(new Set())
  }

  return (
    <div className="media-manage">
      <div className="media-manage-toolbar">
        <button type="button" className="secondary-button" aria-pressed={selectionMode} onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}>
          {selectionMode ? t('mediaSelectionDone') : t('mediaSelectionMode')}
        </button>
        {selectionMode && (
          <>
            <span role="status">{t('mediaSelectedCount', { count: selected.size })}</span>
            <button type="button" className="secondary-button" disabled={selected.size === 0} onClick={() => { bulkDelete([...selected]); exitSelectionMode() }}>
              <Trash2 size={15} aria-hidden="true" /> {t('mediaBulkDelete')}
            </button>
            {attributionOptions && bulkAttribute && (
              <span className="media-bulk-attribute">
                <select value={bulkAttribution} onChange={(event) => setBulkAttribution(event.target.value)} aria-label={t('mediaBulkAttributeLabel')}>
                  <option value="">{t('mediaNoPerformer')}</option>
                  {attributionOptions.map((registration) => (
                    <option key={registration.id} value={registration.id}>
                      {registration.performer_name}{registration.performer_city ? ` · ${registration.performer_city}` : ''}
                    </option>
                  ))}
                </select>
                <button type="button" className="secondary-button" disabled={selected.size === 0} onClick={() => { bulkAttribute([...selected], bulkAttribution || null); exitSelectionMode() }}>
                  {t('mediaBulkAttributeApply')}
                </button>
              </span>
            )}
          </>
        )}
      </div>
      <ul className="media-manage-grid">
        {items.map((item) => {
          const caption = resolveCaption(item.caption, captionValuesOf(item), 'short')
          const { src } = tileImageSource(item)
          const isFeatured = featuredIds?.has(item.id) ?? false
          return (
            <li key={item.id} className={`media-manage-tile${selectionMode ? ' selecting' : ''}${selected.has(item.id) ? ' selected' : ''}`}>
              <button
                type="button"
                className="media-manage-tile-main"
                onClick={() => (selectionMode ? toggleSelect(item.id) : onOpen(item))}
                aria-pressed={selectionMode ? selected.has(item.id) : undefined}
                aria-label={item.alt_text}
              >
                {src && <img src={src} alt="" loading="lazy" />}
                {item.media_type === 'video' && <span className="media-tile-play" aria-hidden="true"><Play size={22} /></span>}
                {selectionMode && <span className="media-select-mark" aria-hidden="true">{selected.has(item.id) ? '✓' : ''}</span>}
              </button>
              {/* Static caption below the image. It must live OUTSIDE the aspect-ratio-locked
                  button: inside, it overflowed onto the action row below. */}
              {caption && <span className="media-tile-caption static">{caption}</span>}
              {!selectionMode && (
                <div className="media-manage-tile-actions">
                  <button type="button" className="quiet-button" onClick={() => onEditCaption(item)}>{t('mediaEditCaption')}</button>
                  {attributionOptions && (
                    <select
                      value={item.registration_id ?? ''}
                      aria-label={t('mediaAttributionLabel')}
                      onChange={(event) => onChangeAttribution(item, event.target.value || null)}
                    >
                      <option value="">{t('mediaNoPerformer')}</option>
                      {attributionOptions.map((registration) => (
                        <option key={registration.id} value={registration.id}>
                          {registration.performer_name}{registration.performer_city ? ` · ${registration.performer_city}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {onToggleFeatured && (
                    <button type="button" className={`quiet-button icon-button${isFeatured ? ' featured' : ''}`} aria-pressed={isFeatured} onClick={() => onToggleFeatured(item)} aria-label={isFeatured ? t('mediaUnpinFeatured') : t('mediaPinFeatured')} title={isFeatured ? t('mediaUnpinFeatured') : t('mediaPinFeatured')}>
                      <Star size={15} fill={isFeatured ? 'currentColor' : 'none'} />
                    </button>
                  )}
                  <button type="button" className="quiet-button icon-button danger" onClick={() => onSoftDelete(item)} aria-label={t('mediaSoftDelete')} title={t('mediaSoftDelete')}>
                    <Trash2 size={15} />
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
