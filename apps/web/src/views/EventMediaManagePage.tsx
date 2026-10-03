import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { friendlyApiErrorMessage } from '../api/client'
import { flattenMediaPages, useMediaList, useRecentlyDeletedMedia, useRecoverMedia, useSoftDeleteMedia, useUpdateMedia, type MediaItem } from '../features/media'
import { useEventRoster, useOrganizerProfile } from '../features/organizer'
import { usePublicEvent, usePublicOpenMic } from '../features/publicReads'
import { CaptionEditor } from '../components/media/CaptionEditor'
import { MediaGallery } from '../components/media/MediaGallery'
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

  const list = useMediaList({ kind: 'event', id: eventId }, { type: typeFilter, sort: 'newest' })
  const items = useMemo(() => sortManageItems(flattenMediaPages(list.data), manageSort), [list.data, manageSort])
  const updateMedia = useUpdateMedia()
  const softDeleteMedia = useSoftDeleteMedia()
  const recoverMedia = useRecoverMedia()
  const recentlyDeleted = useRecentlyDeletedMedia(tab === 'deleted')

  // Attribution picker: this event's registrations only, verified + kiosk provenance,
  // consent-holding (revoked rows are rejected by the API anyway — design §8.3).
  const attributable = useMemo(
    () => (roster.data ?? []).filter((registration) => registration.visibility_state === 'valid' && registration.media_consent),
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
          <MediaGallery scope={{ kind: 'event', id: eventId }} />
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
