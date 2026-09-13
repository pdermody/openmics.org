import { Clock3, MapPin, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { friendlyApiErrorMessage } from '../api/client'
import { RegistrationLinkTools } from '../components/RegistrationLinkTools'
import { useOrganizerOpenMics, useOrganizerProfile, useOrganizerSeriesEvents } from '../features/organizer'
import type { ColorMode, ThemeId } from '../theme'
import { KioskBackupPinSection } from './KioskBackupPin'
import { HeaderMenu, ProfileSwitcher, ReadState, SignInButton } from './shared'

export function OrganizerEventsPage({ seriesId, theme, mode }: { seriesId: string; theme: ThemeId; mode: ColorMode }) {
  const { t } = useTranslation()
  const { context, activeProfile: selected, isOrganizer, isOrganizerPending } = useOrganizerProfile()
  const series = useOrganizerOpenMics(isOrganizer ? selected?.id : undefined, isOrganizer)
  const openMic = series.data?.find((item) => item.id === seriesId)
  const events = useOrganizerSeriesEvents(seriesId, Boolean(isOrganizer && openMic))

  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><a className="brand" href="/" aria-label={t('openMicHome')}><span className="brand-mark"><Sparkles size={17} /></span><span>{t("appName")}</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
    <section className="dashboard-page">
      <a className="back-link" href="/dashboard/series">{t('backToDashboard')}</a>
      <div className="eyebrow">{t('organizerWorkspace')}</div>
      <h1>{openMic?.name ?? 'Series events'}</h1>
      {isOrganizer && openMic && <div className="dashboard-series-card-actions"><a className="quiet-button" href={`/dashboard/series/${seriesId}/edit`}>{t('editSeriesDetails')}</a><a className="quiet-button" href={`/dashboard/series/${seriesId}/events/new`}>{t('newEvent')}</a></div>}
      {isOrganizer && openMic && <RegistrationLinkTools
        url={`${window.location.origin}/${openMic.current_handle ? `@${openMic.current_handle}` : `open-mics/${openMic.id}`}/register`}
        fileName={openMic.current_handle ?? openMic.id}
      />}
      {isOrganizerPending && <ReadState message={t('loading')} />}
      {!isOrganizerPending && !context.account.data && <ReadState message={t('signInDashboard')} />}
      {!isOrganizerPending && context.account.data && !isOrganizer && <ReadState message={t('selectOrganizer')} />}
      {isOrganizer && series.isPending && <ReadState message="Loading series…" />}
      {isOrganizer && series.isError && <ReadState message={friendlyApiErrorMessage(series.error, 'We could not load your series.')} retry={() => void series.refetch()} />}
      {isOrganizer && openMic && events.isPending && <ReadState message="Loading events…" />}
      {isOrganizer && openMic && events.isError && <ReadState message={friendlyApiErrorMessage(events.error, 'We could not load the events for this series.')} retry={() => void events.refetch()} />}
      {isOrganizer && openMic && events.isSuccess && events.data.length === 0 && <ReadState message={t('noEvents')} />}
      {isOrganizer && openMic && events.data?.map((event) => <article className="dashboard-series-card" key={event.id}><div><span className="panel-label">{event.registrations_closed_at ? t('registrationClosed') : t('events')}</span><h2>{event.title}</h2><p><Clock3 size={15} /> {new Date(event.starts_at).toLocaleString()}</p><span className="event-meta"><MapPin size={15} /> {event.venue_name}, {event.city}</span></div><div className="dashboard-series-card-actions"><a className="quiet-button" href={`/dashboard/series/${seriesId}/events/${event.id}/edit`}>{t('edit')}</a><a className="quiet-button" href={`/dashboard/series/${seriesId}/events/${event.id}/roster`}>{t('manageRoster')}</a><a className="quiet-button" href={`/events/${event.public_code}`}>{t('viewEvent')}</a><RegistrationLinkTools url={`${window.location.origin}/events/${event.public_code}/register`} fileName={event.public_code} /></div></article>)}
      {isOrganizer && openMic && <KioskBackupPinSection seriesId={seriesId} />}
    </section>
  </main>
}
