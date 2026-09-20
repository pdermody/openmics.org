import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { Clock3, Copy, Eye, MapPin, Pause, Pencil, Play, Plus, QrCode, Settings2, Sparkles, Trash2, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { friendlyApiErrorMessage } from '../api/client'
import { copyRegistrationLink, downloadRegistrationQr } from '../components/RegistrationLinkTools'
import { EventManagementActions } from '../components/EventManagementActions'
import { ActionMenu } from '../components/ActionMenu'
import { useDeleteOpenMic, useOrganizerOpenMics, useOrganizerProfile, useOrganizerSeriesEvents, useUpdateOpenMic } from '../features/organizer'
import type { ColorMode, ThemeId } from '../theme'
import { KioskBackupPinSection } from './KioskBackupPin'
import { HeaderMenu, Modal, ProfileSwitcher, ReadState, SignInButton } from './shared'

export function OrganizerEventsPage({ seriesId, theme, mode }: { seriesId: string; theme: ThemeId; mode: ColorMode }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { context, activeProfile: selected, isOrganizer, isOrganizerPending } = useOrganizerProfile()
  const series = useOrganizerOpenMics(isOrganizer ? selected?.id : undefined, isOrganizer)
  const openMic = series.data?.find((item) => item.id === seriesId)
  const events = useOrganizerSeriesEvents(seriesId, Boolean(isOrganizer && openMic))
  const updateOpenMic = useUpdateOpenMic(seriesId)
  const deleteOpenMic = useDeleteOpenMic(seriesId)
  const [confirmation, setConfirmation] = useState<'publish' | 'pause' | 'resume' | 'delete' | null>(null)

  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><Link className="brand" to="/" aria-label={t('openMicHome')}><span className="brand-mark"><Sparkles size={17} /></span><span>{t("appName")}</span></Link><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
    <section className="dashboard-page">
      <Link className="back-link" to="/dashboard">{t('backToDashboard')}</Link>
      <div className="eyebrow">{t('organizerWorkspace')}</div>
      <h1>{openMic?.name ?? 'Series events'}</h1>
      {isOrganizer && openMic && <div className="dashboard-series-card-actions">
        <ActionMenu label={t('seriesActions')} items={[{ label: t('editSeriesDetails'), icon: <Pencil size={16} />, onClick: () => void navigate({ to: '/dashboard/series/$seriesId/edit', params: { seriesId } }) }, { label: t('newEvent'), icon: <Plus size={16} />, onClick: () => void navigate({ to: '/dashboard/series/$seriesId/events/new', params: { seriesId } }) }, { label: t('copyLink'), icon: <Copy size={16} />, onClick: () => void copyRegistrationLink(`${window.location.origin}/${openMic.current_handle ? `@${openMic.current_handle}` : `open-mics/${openMic.id}`}/register`) }, { label: t('downloadQr'), icon: <QrCode size={16} />, onClick: () => void downloadRegistrationQr(`${window.location.origin}/${openMic.current_handle ? `@${openMic.current_handle}` : `open-mics/${openMic.id}`}/register`, openMic.current_handle ?? openMic.id) }, ...(openMic.status === 'draft' ? [{ label: t('publishSeries'), icon: <Upload size={16} />, onClick: () => setConfirmation('publish') }] : []), ...(openMic.status === 'active' ? [{ label: t('pauseSeries'), icon: <Pause size={16} />, onClick: () => setConfirmation('pause') }] : []), ...(openMic.status === 'paused' ? [{ label: t('resumeSeries'), icon: <Play size={16} />, onClick: () => setConfirmation('resume') }, { label: t('deleteSeries'), icon: <Trash2 size={16} />, onClick: () => setConfirmation('delete') }] : [])]} />
      </div>}
      {confirmation && <Modal title={t('confirmAction')} onClose={() => setConfirmation(null)}><p>{t(confirmation === 'publish' ? 'confirmPublishSeries' : confirmation === 'pause' ? 'confirmPauseSeries' : confirmation === 'resume' ? 'confirmResumeSeries' : 'confirmDeleteSeries')}</p><div className="dashboard-series-card-actions"><button type="button" className="quiet-button" onClick={() => { if (confirmation === 'delete') deleteOpenMic.mutate(undefined, { onSuccess: () => void navigate({ to: '/dashboard' }) }); else updateOpenMic.mutate({ status: confirmation === 'pause' ? 'paused' : 'active' }); setConfirmation(null) }}>{t('confirm')}</button><button type="button" className="link-button" onClick={() => setConfirmation(null)}>{t('cancel')}</button></div></Modal>}
      {isOrganizerPending && <ReadState message={t('loading')} />}
      {!isOrganizerPending && !context.account.data && <ReadState message={t('signInDashboard')} />}
      {!isOrganizerPending && context.account.data && !isOrganizer && <ReadState message={t('selectOrganizer')} />}
      {isOrganizer && series.isPending && <ReadState message="Loading series…" />}
      {isOrganizer && series.isError && <ReadState message={friendlyApiErrorMessage(series.error, 'We could not load your series.')} retry={() => void series.refetch()} />}
      {isOrganizer && openMic && events.isPending && <ReadState message="Loading events…" />}
      {isOrganizer && openMic && events.isError && <ReadState message={friendlyApiErrorMessage(events.error, 'We could not load the events for this series.')} retry={() => void events.refetch()} />}
      {isOrganizer && openMic && events.isSuccess && events.data.length === 0 && <ReadState message={t('noEvents')} />}
      {isOrganizer && openMic && events.data?.map((event) => <article className="dashboard-series-card" key={event.id}><div><span className="panel-label">{event.registrations_closed_at ? t('registrationClosed') : t('events')}</span><h2><Link to="/dashboard/series/$seriesId/events/$eventId/roster" params={{ seriesId, eventId: event.id }}>{event.title}</Link></h2><p><Clock3 size={15} /> {new Date(event.starts_at).toLocaleString()}</p><span className="event-meta"><MapPin size={15} /> {event.venue_name}, {event.city}</span></div><div className="dashboard-series-card-actions"><EventManagementActions openMicId={seriesId} eventId={event.id} running={event.running} navigationItems={[{ label: t('view'), icon: <Eye size={16} />, onClick: () => void navigate({ to: '/events/$eventId', params: { eventId: event.id } }) }, { label: t('edit'), icon: <Pencil size={16} />, onClick: () => void navigate({ to: '/dashboard/series/$seriesId/events/$eventId/edit', params: { seriesId, eventId: event.id } }) }, { label: t('manage'), icon: <Settings2 size={16} />, onClick: () => void navigate({ to: '/dashboard/series/$seriesId/events/$eventId/roster', params: { seriesId, eventId: event.id } }) }, { label: t('copyLink'), icon: <Copy size={16} />, onClick: () => void copyRegistrationLink(`${window.location.origin}/events/${event.id}/register`) }, { label: t('downloadQr'), icon: <QrCode size={16} />, onClick: () => void downloadRegistrationQr(`${window.location.origin}/events/${event.id}/register`, event.public_code) }]} /></div></article>)}
      {isOrganizer && openMic && <KioskBackupPinSection seriesId={seriesId} />}
    </section>
  </main>
}
