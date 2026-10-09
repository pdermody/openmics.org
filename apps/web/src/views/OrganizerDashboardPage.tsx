import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Clock3, Copy, Eye, MapPin, Pause, Pencil, Play, QrCode, Settings2, Trash2, Upload } from 'lucide-react'
import { EventManagementActions } from '../components/EventManagementActions'
import { ActionMenu } from '../components/ActionMenu'
import { copyRegistrationLink, downloadRegistrationQr } from '../components/RegistrationLinkTools'
import { useTranslation } from 'react-i18next'
import { useDeleteOpenMic, useOrganizerOpenMics, useOrganizerProfile, useOrganizerSeriesEvents, useUpdateOpenMic } from '../features/organizer'
import type { OpenMic } from '../features/publicReads'
import type { ColorMode, ThemeId } from '../theme'
import { ClaimableRegistrationsBanner } from './ClaimableRegistrationsBanner'
import { Modal, ReadState, SiteHeader } from './shared'

function OrganizerDashboardSeriesCard({ openMic }: { openMic: OpenMic }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const events = useOrganizerSeriesEvents(openMic.id, true)
  const updateOpenMic = useUpdateOpenMic(openMic.id)
  const deleteOpenMic = useDeleteOpenMic(openMic.id)
  const [confirmation, setConfirmation] = useState<'publish' | 'pause' | 'resume' | 'delete' | null>(null)
  const now = Date.now()
  const currentOrUpcomingEvents = events.data?.filter((event) => (
    new Date(event.ends_at ?? event.starts_at).getTime() >= now
  )).slice(0, 3) ?? []

  return <article className="dashboard-series-card dashboard-series-card-expanded">
    <div className="dashboard-series-card-header">
      <div>
        <span className="panel-label">{openMic.status}</span>
        <div className="dashboard-card-title-row">
          <h2><Link to="/dashboard/series/$seriesId" params={{ seriesId: openMic.id }}>{openMic.name}</Link></h2>
          <ActionMenu label={t('seriesActions')} items={[
            { label: t('view'), icon: <Eye size={16} />, onClick: () => void navigate({ to: '/open-mics/$openMicId', params: { openMicId: openMic.current_handle ?? openMic.id } }) },
            { label: t('edit'), icon: <Pencil size={16} />, onClick: () => void navigate({ to: '/dashboard/series/$seriesId/edit', params: { seriesId: openMic.id } }) },
            { label: t('manage'), icon: <Settings2 size={16} />, onClick: () => void navigate({ to: '/dashboard/series/$seriesId', params: { seriesId: openMic.id } }) },
            { label: t('copyLink'), icon: <Copy size={16} />, onClick: () => void copyRegistrationLink(`${window.location.origin}/${openMic.current_handle ? `@${openMic.current_handle}` : `open-mics/${openMic.id}`}/register`) },
            { label: t('downloadQr'), icon: <QrCode size={16} />, onClick: () => void downloadRegistrationQr(`${window.location.origin}/${openMic.current_handle ? `@${openMic.current_handle}` : `open-mics/${openMic.id}`}/register`, openMic.current_handle ?? openMic.id) },
            ...(openMic.status === 'draft' ? [{ label: t('publishSeries'), icon: <Upload size={16} />, onClick: () => setConfirmation('publish') }] : []),
            ...(openMic.status === 'active' ? [{ label: t('pauseSeries'), icon: <Pause size={16} />, onClick: () => setConfirmation('pause') }] : []),
            ...(openMic.status === 'paused' ? [{ label: t('resumeSeries'), icon: <Play size={16} />, onClick: () => setConfirmation('resume') }, { label: t('deleteSeries'), icon: <Trash2 size={16} />, onClick: () => setConfirmation('delete') }] : []),
          ]} />
        </div>
        <p>{openMic.description ?? t('noDescription')}</p>
        <span className="event-meta"><MapPin size={15} /> {openMic.venue_name}, {openMic.city}</span>
      </div>
    </div>
    {confirmation && <Modal title={t('confirmAction')} onClose={() => setConfirmation(null)}>
      <p>{t(confirmation === 'publish' ? 'confirmPublishSeries' : confirmation === 'pause' ? 'confirmPauseSeries' : confirmation === 'resume' ? 'confirmResumeSeries' : 'confirmDeleteSeries')}</p>
      <div className="dashboard-series-card-actions">
        <button type="button" className="quiet-button" onClick={() => { if (confirmation === 'delete') deleteOpenMic.mutate(); else updateOpenMic.mutate({ status: confirmation === 'pause' ? 'paused' : 'active' }); setConfirmation(null) }}>{t('confirm')}</button>
        <button type="button" className="link-button" onClick={() => setConfirmation(null)}>{t('cancel')}</button>
      </div>
    </Modal>}
    <div className="dashboard-upcoming-events">
      <span className="panel-label">{t('upcomingEvents')}</span>
      {events.isPending && <ReadState message={t('loading')} />}
      {events.isError && <ReadState message={t('eventLoadError')} retry={() => void events.refetch()} />}
      {events.isSuccess && currentOrUpcomingEvents.length === 0 && <ReadState message={t('noEvents')} />}
      {currentOrUpcomingEvents.map((event) => <article className="dashboard-event-card" key={event.id}>
        <div>
          <div className="dashboard-card-title-row">
            <h3><Link to="/dashboard/series/$seriesId/events/$eventId/roster" params={{ seriesId: openMic.id, eventId: event.id }}>{event.title}</Link></h3>
            <EventManagementActions
              openMicId={openMic.id}
              eventId={event.id}
              navigationItems={[
                { label: t('view'), icon: <Eye size={16} />, onClick: () => void navigate({ to: '/events/$eventId', params: { eventId: event.public_code } }) },
                { label: t('edit'), icon: <Pencil size={16} />, onClick: () => void navigate({ to: '/dashboard/series/$seriesId/events/$eventId/edit', params: { seriesId: openMic.id, eventId: event.id } }) },
                { label: t('manage'), icon: <Settings2 size={16} />, onClick: () => void navigate({ to: '/dashboard/series/$seriesId/events/$eventId/roster', params: { seriesId: openMic.id, eventId: event.id } }) },
                { label: t('eventCopyActionLabel', { title: event.title }), icon: <Copy size={16} />, onClick: () => void navigate({ to: '/dashboard/series/$seriesId/events/new', params: { seriesId: openMic.id }, search: { sourceEventId: event.id, copySchedule: true } }) },
                { label: t('copyLink'), icon: <Copy size={16} />, onClick: () => void copyRegistrationLink(`${window.location.origin}/events/${event.id}/register`) },
                { label: t('downloadQr'), icon: <QrCode size={16} />, onClick: () => void downloadRegistrationQr(`${window.location.origin}/events/${event.id}/register`, event.public_code) },
              ]}
            />
          </div>
          <p className="event-meta"><Clock3 size={15} /> {new Date(event.starts_at).toLocaleString()}</p>
          <p className="event-meta"><MapPin size={15} /> {event.venue_name}, {event.city}</p>
        </div>
      </article>)}
    </div>
  </article>
}

export function OrganizerDashboardPage({ theme, mode }: { theme: ThemeId; mode: ColorMode }) {
  const { t } = useTranslation()
  const { context, activeProfile: selected, isOrganizer, isOrganizerPending } = useOrganizerProfile()
  const openMics = useOrganizerOpenMics(selected?.id, isOrganizer)
  const hasOrganizerProfile = context.profiles.data?.items.some((profile) => profile.profile_kind === 'organizer') ?? false
  const hasNoOpenMics = isOrganizer && !openMics.isPending && (openMics.data?.length ?? 0) === 0

  return <main className="app" data-theme={theme} data-mode={mode}>
    <SiteHeader />
    <section className="dashboard-page">
      <div className="eyebrow">{t('dashboard')}</div>
      <h1>{t('dashboardTitle')}</h1>
      {isOrganizerPending && <ReadState message={t('loading')} />}
      {!isOrganizerPending && !context.account.data && <ReadState message={t('signInDashboard')} />}
      <ClaimableRegistrationsBanner />
      {!isOrganizerPending && context.account.data && !isOrganizer && <ReadState message={t('selectOrganizer')} />}
      {isOrganizer && selected && <>
        <p className="detail-lede">{t('workingAs', { name: selected.profile_name })}</p>
        {!hasOrganizerProfile && <div className="dashboard-series-card-actions"><Link className="quiet-button" to="/dashboard/series/new">{t('dashboardCreateSeries')}</Link></div>}
        {hasNoOpenMics && <div className="dashboard-card"><span className="panel-label">{t('getStarted')}</span><h2>{t('setupFirst')}</h2><p>{t('noSeriesYet')}</p></div>}
        <div className="dashboard-series-list">
          {openMics.isPending && <ReadState message={t('loading')} />}
          {openMics.isError && <ReadState message={t('seriesLoadError')} retry={() => void openMics.refetch()} />}
          {openMics.isSuccess && openMics.data.map((openMic) => <OrganizerDashboardSeriesCard key={openMic.id} openMic={openMic} />)}
        </div>
      </>}
    </section>
  </main>
}
