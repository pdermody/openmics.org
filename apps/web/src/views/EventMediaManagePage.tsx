import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { friendlyApiErrorMessage } from '../api/client'
import { canAttributeMedia, flattenMediaPages, useMediaList, useRecentlyDeletedMedia, useRecoverMedia, useSoftDeleteMedia, useUpdateMedia, type MediaItem } from '../features/media'
import { useEventRoster, useOrganizerProfile } from '../features/organizer'
import { usePublicEvent, usePublicOpenMic } from '../features/publicReads'
import { CaptionEditor } from '../components/media/CaptionEditor'
import { Lightbox } from '../components/media/Lightbox'
import { PublicDetailTabs } from '../components/PublicDetailTabs'
import { MediaManageGrid, sortManageItems, type ManageSort } from '../components/media/MediaManageGrid'
import { MediaUploader } from '../components/media/MediaUploader'
import { Modal, ReadState, SiteHeader, type ThemeProps } from './shared'

// Organizer manage view for event media (design §8). Lives at
// /dashboard/series/$seriesId/events/$eventId/media.
export function EventMediaManagePage({ seriesId, eventId, theme, mode }: { seriesId: string; eventId: string } & ThemeProps) {
  const { t } = useTranslation()
  const { activeProfile, isOrganizer, isOrganizerPending } = useOrganizerProfile()
  const openMic = usePublicOpenMic(seriesId)
  const event = usePublicEvent(eventId)
  const roster = useEventRoster(eventId)

  const [tab, setTab] = useState<'gallery' | 'deleted'>('gallery')
  const [typeFilter, setTypeFilter] = useState<'all' | 'photo' | 'video'>('all')
  const [manageSort, setManageSort] = useState<ManageSort>('newest')
  const [previewMode, setPreviewMode] = useState(false)
  const [editingCaption, setEditingCaption] = useState<MediaItem | null>(null)
  const [captionDraft, setCaptionDraft] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState<MediaItem | null>(null)
  const [viewingId, setViewingId] = useState<string | null>(null)

  const list = useMediaList({ kind: 'event', id: eventId }, { type: typeFilter, sort: 'newest' })
  const items = useMemo(() => sortManageItems(flattenMediaPages(list.data), manageSort), [list.data, manageSort])
  const updateMedia = useUpdateMedia()
  const softDeleteMedia = useSoftDeleteMedia()
  const recoverMedia = useRecoverMedia()
  const recentlyDeleted = useRecentlyDeletedMedia(tab === 'deleted')

  // Lightbox over the loaded (manage-sorted) window (design §6.4 organizer actions).
  const viewingIndex = viewingId ? items.findIndex((item) => item.id === viewingId) : -1
  const viewingItem = viewingIndex >= 0 ? items[viewingIndex] : null
  const navigateViewing = (direction: 'prev' | 'next' | 'first' | 'last') => {
    if (viewingIndex < 0) return
    const target = direction === 'prev' ? viewingIndex - 1
      : direction === 'next' ? viewingIndex + 1
        : direction === 'first' ? 0
          : items.length - 1
    if (target < 0 || target >= items.length) return
    setViewingId(items[target].id)
  }

  // Attribution picker: this event's registrations only, verified + kiosk provenance,
  // consent-holding (revoked rows are rejected by the API anyway — design §8.3).
  const attributable = useMemo(
    () => (roster.data ?? []).filter(canAttributeMedia),
    [roster.data],
  )

  const ownsSeries = Boolean(openMic.data && activeProfile && openMic.data.owner_profile_id === activeProfile.id)

  if (isOrganizerPending || openMic.isPending || event.isPending) {
    return <main className="app" data-theme={theme} data-mode={mode}><ReadState message={t('loading')} /></main>
  }
  if (!isOrganizer || !ownsSeries) {
    return <main className="app" data-theme={theme} data-mode={mode}><SiteHeader /><ReadState message={t('mediaManageForbidden')} /></main>
  }
  if (!event.data) {
    return <main className="app" data-theme={theme} data-mode={mode}><SiteHeader /><ReadState message={t('mediaManageMissing')} /></main>
  }

  return (
    <main className="app" data-theme={theme} data-mode={mode}>
      <SiteHeader />
      <section className="detail-page media-manage-page">
        <Link className="back-link" to="/dashboard/series/$seriesId/events/$eventId/roster" params={{ seriesId, eventId }}>{t('mediaBackToRoster')}</Link>
        <div className="eyebrow">{t('mediaManageEventEyebrow')}</div>
        <h1>{t('mediaManageEventTitle', { event: event.data.title })}</h1>

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
            filter={(group) => group.event_id === eventId}
            query={recentlyDeleted}
            onRecover={(id) => recoverMedia.mutate(id)}
            recovering={recoverMedia.isPending}
          />
        ) : previewMode ? (
          <PublicDetailTabs scope={{ kind: 'event', id: eventId }} />
        ) : (
          <>
            <MediaUploader eventId={eventId} registrations={attributable} />
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
                attributionOptions={attributable}
                onOpen={(item) => setViewingId(item.id)}
                onEditCaption={(item) => { setEditingCaption(item); setCaptionDraft(item.caption ?? '') }}
                onChangeAttribution={(item, registrationId) => updateMedia.mutate({ id: item.id, registration_id: registrationId })}
                onSoftDelete={(item) => setConfirmingDelete(item)}
                bulkDelete={(ids) => { for (const id of ids) softDeleteMedia.mutate(id) }}
                bulkAttribute={(ids, registrationId) => { for (const id of ids) updateMedia.mutate({ id, registration_id: registrationId }) }}
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

      {viewingItem && (
        <Lightbox
          item={viewingItem}
          position={{ index: viewingIndex, total: items.length }}
          onClose={() => setViewingId(null)}
          onNavigate={navigateViewing}
          hasPrev={viewingIndex > 0}
          hasNext={viewingIndex < items.length - 1}
          organizerActions={(
            <>
              {/* The caption/delete modals layer UNDER the lightbox (z 40 < 61), so the
                  lightbox closes when they open. */}
              <button type="button" className="quiet-button" onClick={() => { setEditingCaption(viewingItem); setCaptionDraft(viewingItem.caption ?? ''); setViewingId(null) }}>{t('mediaEditCaption')}</button>
              <select
                value={viewingItem.registration_id ?? ''}
                aria-label={t('mediaAttributionLabel')}
                onChange={(change) => updateMedia.mutate({ id: viewingItem.id, registration_id: change.target.value || null })}
              >
                <option value="">{t('mediaNoPerformer')}</option>
                {attributable.map((registration) => (
                  <option key={registration.id} value={registration.id}>
                    {registration.performer_name}{registration.performer_city ? ` · ${registration.performer_city}` : ''}
                  </option>
                ))}
              </select>
              <button type="button" className="quiet-button danger" onClick={() => { setConfirmingDelete(viewingItem); setViewingId(null) }}>{t('mediaSoftDelete')}</button>
            </>
          )}
        />
      )}

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

export function RecentlyDeletedList({ filter, query, onRecover, recovering }: {
  filter: (group: { event_id: string | null; open_mic_id: string }) => boolean
  query: ReturnType<typeof useRecentlyDeletedMedia>
  onRecover: (mediaId: string) => void
  recovering: boolean
}) {
  const { t } = useTranslation()
  if (query.isPending) return <ReadState message={t('loading')} />
  if (query.isError) return <ReadState message={t('mediaGalleryLoadError')} retry={() => void query.refetch()} />
  const groups = (query.data?.items ?? []).filter(filter)
  const total = groups.reduce((sum, group) => sum + group.items.length, 0)
  if (total === 0) return <p className="field-hint">{t('mediaRecentlyDeletedEmpty')}</p>
  return (
    <div className="media-recently-deleted">
      {groups.map((group) => (
        <section key={`${group.open_mic_id}:${group.event_id ?? ''}`}>
          <h3>{group.event_title ?? group.open_mic_name}</h3>
          <ul className="media-recently-deleted-grid">
            {group.items.map((item) => (
              <li key={item.id}>
                <img src={item.renditions?.thumb?.url ?? item.thumbnail_url ?? item.source_url} alt={item.alt_text} loading="lazy" />
                <div className="media-recently-deleted-actions">
                  {item.deletion_reason === 'consent_revocation' ? (
                    <span className="field-hint" title={t('mediaRestoreConsentHint')}>{t('mediaRestoreConsentOnly')}</span>
                  ) : (
                    <button type="button" className="secondary-button" disabled={recovering} onClick={() => onRecover(item.id)}>{t('mediaRestore')}</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
