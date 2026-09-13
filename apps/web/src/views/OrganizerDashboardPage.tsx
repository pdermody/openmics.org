import { useState } from 'react'
import { Clock3, Copy, Eye, MapPin, Pause, Pencil, Play, QrCode, Settings2, Sparkles, Trash2, Upload } from 'lucide-react'
import { EventManagementActions } from '../components/EventManagementActions'
import { ActionMenu } from '../components/ActionMenu'
import { copyRegistrationLink, downloadRegistrationQr } from '../components/RegistrationLinkTools'
import { useTranslation } from 'react-i18next'
import { useDeleteOpenMic, useOrganizerOpenMics, useOrganizerProfile, useOrganizerSeriesEvents, useUpdateOpenMic } from '../features/organizer'
import type { OpenMic } from '../features/publicReads'
import type { ColorMode, ThemeId } from '../theme'
import { ClaimableRegistrationsBanner } from './ClaimableRegistrationsBanner'
import { HeaderMenu, Modal, ProfileSwitcher, ReadState, SignInButton } from './shared'

function OrganizerDashboardSeriesCard({ openMic }: { openMic: OpenMic }) {
  const { t } = useTranslation()
  const events = useOrganizerSeriesEvents(openMic.id, true)
  const updateOpenMic = useUpdateOpenMic(openMic.id)
  const deleteOpenMic = useDeleteOpenMic(openMic.id)
  const [confirmation, setConfirmation] = useState<'publish' | 'pause' | 'resume' | 'delete' | null>(null)
  const upcomingEvents = events.data?.filter((event) => new Date(event.starts_at).getTime() >= Date.now()).slice(0, 3) ?? []

  return <article className="dashboard-series-card dashboard-series-card-expanded">
    <div className="dashboard-series-card-header">
      <div>
        <span className="panel-label">{openMic.status}</span>
        <h2><a href={`/dashboard/series/${openMic.id}`}>{openMic.name}</a></h2>
        <p>{openMic.description ?? t('noDescription')}</p>
        <span className="event-meta"><MapPin size={15} /> {openMic.venue_name}, {openMic.city}</span>
      </div>
      <div className="dashboard-series-card-actions">
        <ActionMenu label={t('seriesActions')} items={[
          { label: t('view'), icon: <Eye size={16} />, onClick: () => { window.location.href = `/open-mics/${openMic.current_handle ?? openMic.id}` } },
          { label: t('edit'), icon: <Pencil size={16} />, onClick: () => { window.location.href = `/dashboard/series/${openMic.id}/edit` } },
          { label: t('manage'), icon: <Settings2 size={16} />, onClick: () => { window.location.href = `/dashboard/series/${openMic.id}` } },
          { label: t('copyLink'), icon: <Copy size={16} />, onClick: () => void copyRegistrationLink(`${window.location.origin}/${openMic.current_handle ? `@${openMic.current_handle}` : `open-mics/${openMic.id}`}/register`) },
          { label: t('downloadQr'), icon: <QrCode size={16} />, onClick: () => void downloadRegistrationQr(`${window.location.origin}/${openMic.current_handle ? `@${openMic.current_handle}` : `open-mics/${openMic.id}`}/register`, openMic.current_handle ?? openMic.id) },
          ...(openMic.status === 'draft' ? [{ label: t('publishSeries'), icon: <Upload size={16} />, onClick: () => setConfirmation('publish') }] : []),
          ...(openMic.status === 'active' ? [{ label: t('pauseSeries'), icon: <Pause size={16} />, onClick: () => setConfirmation('pause') }] : []),
          ...(openMic.status === 'paused' ? [{ label: t('resumeSeries'), icon: <Play size={16} />, onClick: () => setConfirmation('resume') }, { label: t('deleteSeries'), icon: <Trash2 size={16} />, onClick: () => setConfirmation('delete') }] : []),
        ]} />
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
      {events.isSuccess && upcomingEvents.length === 0 && <ReadState message={t('noEvents')} />}
      {upcomingEvents.map((event) => <article className="dashboard-event-card" key={event.id}>
        <div>
          <h3><a href={`/dashboard/series/${openMic.id}/events/${event.id}/roster`}>{event.title}</a></h3>
          <p className="event-meta"><Clock3 size={15} /> {new Date(event.starts_at).toLocaleString()}</p>
          <p className="event-meta"><MapPin size={15} /> {event.venue_name}, {event.city}</p>
        </div>
        <div className="dashboard-series-card-actions">
          <EventManagementActions
            openMicId={openMic.id}
            eventId={event.id}
            running={event.running}
            navigationItems={[
              { label: t('view'), icon: <Eye size={16} />, onClick: () => { window.location.href = `/events/${event.public_code}` } },
              { label: t('edit'), icon: <Pencil size={16} />, onClick: () => { window.location.href = `/dashboard/series/${openMic.id}/events/${event.id}/edit` } },
              { label: t('manage'), icon: <Settings2 size={16} />, onClick: () => { window.location.href = `/dashboard/series/${openMic.id}/events/${event.id}/roster` } },
              { label: t('copyLink'), icon: <Copy size={16} />, onClick: () => void copyRegistrationLink(`${window.location.origin}/events/${event.id}/register`) },
              { label: t('downloadQr'), icon: <QrCode size={16} />, onClick: () => void downloadRegistrationQr(`${window.location.origin}/events/${event.id}/register`, event.public_code) },
            ]}
          />
        </div>
      </article>)}
    </div>
  </article>
}

export function OrganizerDashboardPage({ theme, mode }: { theme: ThemeId; mode: ColorMode }) {
  const { t } = useTranslation()
  const { context, activeProfile: selected, isOrganizer, isOrganizerPending } = useOrganizerProfile()
  const openMics = useOrganizerOpenMics(selected?.id, isOrganizer)
  const hasNoOpenMics = isOrganizer && !openMics.isPending && (openMics.data?.length ?? 0) === 0

  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><a className="brand" href="/" aria-label={t('openMicHome')}><span className="brand-mark"><Sparkles size={17} /></span><span>{t("appName")}</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
    <section className="dashboard-page">
      <div className="eyebrow">{t('dashboard')}</div>
      <h1>{t('dashboardTitle')}</h1>
      {isOrganizerPending && <ReadState message={t('loading')} />}
      {!isOrganizerPending && !context.account.data && <ReadState message={t('signInDashboard')} />}
      <ClaimableRegistrationsBanner />
      {!isOrganizerPending && context.account.data && !isOrganizer && <ReadState message={t('selectOrganizer')} />}
      {isOrganizer && selected && <>
        <p className="detail-lede">{t('workingAs', { name: selected.profile_name })}</p>
        {hasNoOpenMics && <div className="dashboard-card"><span className="panel-label">{t('getStarted')}</span><h2>{t('setupFirst')}</h2><p>{t('noSeriesYet')}</p><a className="quiet-button" href="/dashboard/series/new">{t('setupFirstLink')}</a></div>}
        <div className="dashboard-series-list">
          {openMics.isPending && <ReadState message={t('loading')} />}
          {openMics.isError && <ReadState message={t('seriesLoadError')} retry={() => void openMics.refetch()} />}
          {openMics.isSuccess && openMics.data.map((openMic) => <OrganizerDashboardSeriesCard key={openMic.id} openMic={openMic} />)}
        </div>
      </>}
    </section>
  </main>
}
