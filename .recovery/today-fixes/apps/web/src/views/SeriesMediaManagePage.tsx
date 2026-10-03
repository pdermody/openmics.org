import { useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Play } from 'lucide-react'

import { friendlyApiErrorMessage } from '../api/client'
import { flattenMediaPages, useFeaturedMedia, useMediaList, useRecentlyDeletedMedia, useRecoverMedia, useReplaceFeaturedMedia, useSoftDeleteMedia, useUpdateMedia, type MediaItem } from '../features/media'
import { useOrganizerProfile } from '../features/organizer'
import { usePublicOpenMic } from '../features/publicReads'
import { resolveCaption } from '../features/media-captions'
import { captionValuesOf, MediaGallery, tileImageSource } from '../components/media/MediaGallery'
import { FeaturedStrip } from '../components/media/FeaturedStrip'
import { CaptionEditor } from '../components/media/CaptionEditor'
import { MediaManageGrid, sortManageItems, type ManageSort } from '../components/media/MediaManageGrid'
import { MediaUploader } from '../components/media/MediaUploader'
import { Modal, ReadState, SiteHeader, type ThemeProps } from './shared'
import { RecentlyDeletedList } from './EventMediaManagePage'

// Organizer manage view for series media + the Featured strip editor (design §8.4).
// Lives at /dashboard/series/$seriesId/media.
export function SeriesMediaManagePage({ seriesId, theme, mode }: { seriesId: string } & ThemeProps) {
  const { t } = useTranslation()
  const { activeProfile, isOrganizer, isOrganizerPending } = useOrganizerProfile()
  const openMic = usePublicOpenMic(seriesId)

  const [tab, setTab] = useState<'gallery' | 'deleted'>('gallery')
  const [typeFilter, setTypeFilter] = useState<'all' | 'photo' | 'video'>('all')
  const [manageSort, setManageSort] = useState<ManageSort>('newest')
  const [previewMode, setPreviewMode] = useState(false)
  const [editingCaption, setEditingCaption] = useState<MediaItem | null>(null)
  const [captionDraft, setCaptionDraft] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState<MediaItem | null>(null)

  const list = useMediaList({ kind: 'open-mic', id: seriesId }, { type: typeFilter, sort: 'newest' })
  const items = useMemo(() => sortManageItems(flattenMediaPages(list.data), manageSort), [list.data, manageSort])
  const featured = useFeaturedMedia(seriesId)
  const replaceFeatured = useReplaceFeaturedMedia(seriesId)
  const updateMedia = useUpdateMedia()
  const softDeleteMedia = useSoftDeleteMedia()
  const recoverMedia = useRecoverMedia()
  const recentlyDeleted = useRecentlyDeletedMedia(tab === 'deleted')

  const featuredIds = useMemo(() => new Set((featured.data?.items ?? []).map((item) => item.id)), [featured.data])

  const ownsSeries = Boolean(openMic.data && activeProfile && openMic.data.owner_profile_id === activeProfile.id)

  if (isOrganizerPending || openMic.isPending) {
    return <main className="app" data-theme={theme} data-mode={mode}><ReadState message={t('loading')} /></main>
  }
  if (!isOrganizer || !ownsSeries || !openMic.data) {
    return <main className="app" data-theme={theme} data-mode={mode}><SiteHeader /><ReadState message={t('mediaManageForbidden')} /></main>
  }

  const toggleFeatured = (item: MediaItem) => {
    const ids = featuredIds.has(item.id)
      ? [...featuredIds].filter((id) => id !== item.id)
      : [...featuredIds, item.id]
    replaceFeatured.mutate(ids)
  }

  const moveFeatured = (item: MediaItem, direction: -1 | 1) => {
    const ids = (featured.data?.items ?? []).map((existing) => existing.id)
    const index = ids.indexOf(item.id)
    const target = index + direction
    if (index === -1 || target < 0 || target >= ids.length) return
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    replaceFeatured.mutate(ids)
  }

  // Drag-and-drop reorder: move the dragged item to the drop target's index directly.
  const reorderFeatured = (draggedId: string, targetId: string) => {
    const ids = (featured.data?.items ?? []).map((existing) => existing.id)
    const fromIndex = ids.indexOf(draggedId)
    const toIndex = ids.indexOf(targetId)
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return
    ids.splice(toIndex, 0, ...ids.splice(fromIndex, 1))
    replaceFeatured.mutate(ids)
  }

  return (
    <main className="app" data-theme={theme} data-mode={mode}>
      <SiteHeader />
      <section className="detail-page media-manage-page">
        <Link className="back-link" to="/dashboard/series/$seriesId" params={{ seriesId }}>{t('mediaBackToSeries')}</Link>
        <div className="eyebrow">{t('mediaManageSeriesEyebrow')}</div>
        <h1>{t('mediaManageSeriesTitle', { series: openMic.data.name })}</h1>

        <div className="media-manage-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'gallery'} className={`filter-chip${tab === 'gallery' ? ' active' : ''}`} onClick={() => setTab('gallery')}>{t('mediaTabGallery')}</button>
          <button type="button" role="tab" aria-selected={tab === 'deleted'} className={`filter-chip${tab === 'deleted' ? ' active' : ''}`} onClick={() => setTab('deleted')}>{t('mediaTabRecentlyDeleted')}</button>
          <label className="media-preview-toggle">
            <input type="checkbox" checked={previewMode} onChange={(event) => setPreviewMode(event.target.checked)} />
            <span>{t('mediaPreviewAsVisitor')}</span>
          </label>
        </div>

        {tab === 'deleted' ? (
          <RecentlyDeletedList
            filter={(group) => group.open_mic_id === openMic.data!.id}
            query={recentlyDeleted}
            onRecover={(id) => recoverMedia.mutate(id)}
            recovering={recoverMedia.isPending}
          />
        ) : previewMode ? (
          <MediaGallery
            scope={{ kind: 'open-mic', id: seriesId }}
            featuredStrip={(openLightbox) => <FeaturedStrip items={featured.data?.items ?? []} onOpen={openLightbox} />}
          />
        ) : (
          <>
            <MediaUploader openMicId={openMic.data.id} />
            {(featured.data?.items.length ?? 0) > 0 && (
              <FeaturedEditor
                items={featured.data!.items}
                onMove={moveFeatured}
                onReorder={reorderFeatured}
                onRemove={(item) => toggleFeatured(item)}
                saving={replaceFeatured.isPending}
              />
            )}
            <div className="media-manage-controls">
              <div className="media-filter-chips" role="group" aria-label={t('mediaTypeFilter')}>
                {(['all', 'photo', 'video'] as const).map((value) => (
                  <button key={value} type="button" className={`filter-chip${typeFilter === value ? ' active' : ''}`} aria-pressed={typeFilter === value} onClick={() => setTypeFilter(value)}>
                    {value === 'all' ? t('mediaFilterAll') : value === 'photo' ? t('mediaFilterPhotos') : t('mediaFilterVideos')}
                  </button>
                ))}
              </div>
              <label className="media-sort-control">
                {t('mediaSortLabel')}
                <select value={manageSort} onChange={(event) => setManageSort(event.target.value as ManageSort)}>
                  <option value="newest">{t('mediaSortNewest')}</option>
                  <option value="oldest">{t('mediaSortOldest')}</option>
                  <option value="caption">{t('mediaSortCaption')}</option>
                  <option value="performer">{t('mediaSortPerformer')}</option>
                </select>
              </label>
            </div>
            {list.isPending && <ReadState message={t('loading')} />}
            {list.isError && <ReadState message={friendlyApiErrorMessage(list.error, t('mediaGalleryLoadError'))} retry={() => void list.refetch()} />}
            {!list.isPending && items.length === 0 && (
              <div className="media-empty-manage">
                <p>{t('mediaEmptyManage')}</p>
              </div>
            )}
            {items.length > 0 && (
              <MediaManageGrid
                items={items}
                featuredIds={featuredIds}
                onToggleFeatured={toggleFeatured}
                onEditCaption={(item) => { setEditingCaption(item); setCaptionDraft(item.caption ?? '') }}
                onChangeAttribution={() => undefined}
                onSoftDelete={(item) => setConfirmingDelete(item)}
                bulkDelete={(ids) => { for (const id of ids) softDeleteMedia.mutate(id) }}
              />
            )}
            {list.hasNextPage && (
              <button type="button" className="secondary-button media-load-more" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {t('mediaLoadMore')}
              </button>
            )}
          </>
        )}
      </section>

      {editingCaption && (
        <Modal title={t('mediaEditCaption')} onClose={() => setEditingCaption(null)}>
          <CaptionEditor item={editingCaption} value={captionDraft} onChange={setCaptionDraft} form="long" />
          <div className="modal-actions">
            <button type="button" className="primary-button" disabled={updateMedia.isPending} onClick={() => {
              updateMedia.mutate({ id: editingCaption.id, caption: captionDraft.trim() || null }, { onSuccess: () => setEditingCaption(null) })
            }}>{t('save')}</button>
            <button type="button" className="secondary-button" onClick={() => setEditingCaption(null)}>{t('cancel')}</button>
          </div>
        </Modal>
      )}

      {confirmingDelete && (
        <Modal title={t('mediaSoftDelete')} onClose={() => setConfirmingDelete(null)}>
          <p>{t('mediaSoftDeleteConfirm')}</p>
          <div className="modal-actions">
            <button type="button" className="primary-button danger" disabled={softDeleteMedia.isPending} onClick={() => {
              softDeleteMedia.mutate(confirmingDelete.id, { onSuccess: () => setConfirmingDelete(null) })
            }}>{t('mediaSoftDelete')}</button>
            <button type="button" className="secondary-button" onClick={() => setConfirmingDelete(null)}>{t('cancel')}</button>
          </div>
        </Modal>
      )}
    </main>
  )
}

// The Featured strip editor (§8.4): HTML5 drag-and-drop with pointer/mouse/touch support,
// plus up/down button fallback for keyboard use.
function FeaturedEditor({ items, onMove, onReorder, onRemove, saving }: {
  items: MediaItem[]
  onMove: (item: MediaItem, direction: -1 | 1) => void
  onReorder: (draggedId: string, targetId: string) => void
  onRemove: (item: MediaItem) => void
  saving: boolean
}) {
  const { t } = useTranslation()
  const dragId = useRef<string | null>(null)

  return (
    <section className="media-featured-editor" aria-label={t('mediaFeaturedEditorHeading')}>
      <h3>{t('mediaFeaturedEditorHeading')}</h3>
      <p className="field-hint">{t('mediaFeaturedEditorHint')}</p>
      <ul>
        {items.map((item, index) => (
          <li
            key={item.id}
            draggable
            onDragStart={(event) => { dragId.current = item.id; event.dataTransfer.effectAllowed = 'move' }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              if (dragId.current) onReorder(dragId.current, item.id)
              dragId.current = null
            }}
            aria-busy={saving}
          >
            <FeaturedThumb item={item} />
            <span className="media-featured-editor-caption">{resolveCaption(item.caption, captionValuesOf(item), 'long') || item.alt_text}</span>
            <span className="media-featured-editor-actions">
              <button type="button" className="quiet-button icon-button" disabled={index === 0} onClick={() => onMove(item, -1)} aria-label={t('mediaFeaturedMoveUp')}><ArrowUp size={15} /></button>
              <button type="button" className="quiet-button icon-button" disabled={index === items.length - 1} onClick={() => onMove(item, 1)} aria-label={t('mediaFeaturedMoveDown')}><ArrowDown size={15} /></button>
              <button type="button" className="quiet-button" onClick={() => onRemove(item)}>{t('mediaUnpinFeatured')}</button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function FeaturedThumb({ item }: { item: MediaItem }) {
  const { src } = tileImageSource(item)
  return (
    <span className="media-featured-editor-thumb">
      {src && <img src={src} alt="" />}
      {item.media_type === 'video' && <Play size={14} aria-hidden="true" />}
    </span>
  )
}
