import { Clock3, MapPin, Sparkles } from 'lucide-react'
import { friendlyApiErrorMessage } from '../api/client'
import { useAccountContext } from '../features/account'
import { useOrganizerOpenMics, useOrganizerSeriesEvents } from '../features/organizer'
import type { ColorMode, ThemeId } from '../theme'
import { HeaderMenu, ProfileSwitcher, ReadState, SignInButton } from './shared'

export function OrganizerEventsPage({ seriesId, theme, mode }: { seriesId: string; theme: ThemeId; mode: ColorMode }) {
  const context = useAccountContext()
  const selected = context.profiles.data?.items.find((profile) => profile.id === context.account.data?.current_profile_id)
  const isOrganizer = selected?.profile_kind === 'organizer' && context.permissions.data?.permissions.includes('profiles:manage')
  const series = useOrganizerOpenMics(isOrganizer ? selected.id : undefined, isOrganizer)
  const openMic = series.data?.find((item) => item.id === seriesId)
  const events = useOrganizerSeriesEvents(seriesId, Boolean(isOrganizer && openMic))

  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><a className="brand" href="/" aria-label="Open Mic home"><span className="brand-mark"><Sparkles size={17} /></span><span>open mic</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
    <section className="dashboard-page">
      <a className="back-link" href="/dashboard/series">← Back to series</a>
      <div className="eyebrow">Organizer workspace</div>
      <h1>{openMic?.name ?? 'Series events'}</h1>
      {isOrganizer && openMic && <div className="dashboard-series-card-actions"><a className="quiet-button" href={`/dashboard/series/${seriesId}/edit`}>Edit series details</a><a className="quiet-button" href={`/dashboard/series/${seriesId}/events/new`}>New event</a></div>}
      {!context.account.data && <ReadState message="Sign in to manage event operations." />}
      {context.account.data && !isOrganizer && <ReadState message="Select an organizer profile to manage event operations." />}
      {isOrganizer && series.isPending && <ReadState message="Loading series…" />}
      {isOrganizer && series.isError && <ReadState message={friendlyApiErrorMessage(series.error, 'We could not load your series.')} retry={() => void series.refetch()} />}
      {isOrganizer && openMic && events.isPending && <ReadState message="Loading events…" />}
      {isOrganizer && openMic && events.isError && <ReadState message={friendlyApiErrorMessage(events.error, 'We could not load the events for this series.')} retry={() => void events.refetch()} />}
      {isOrganizer && openMic && events.isSuccess && events.data.length === 0 && <ReadState message="This series does not have any events yet." />}
      {isOrganizer && openMic && events.data?.map((event) => <article className="dashboard-series-card" key={event.id}><div><span className="panel-label">{event.registrations_closed_at ? 'Registration closed' : 'Upcoming event'}</span><h2>{event.title}</h2><p><Clock3 size={15} /> {new Date(event.starts_at).toLocaleString()}</p><span className="event-meta"><MapPin size={15} /> {event.venue_name}, {event.city}</span></div><div className="dashboard-series-card-actions"><a className="quiet-button" href={`/dashboard/series/${seriesId}/events/${event.id}/edit`}>Edit</a><a className="quiet-button" href={`/events/${event.public_code}`}>View event</a></div></article>)}
    </section>
  </main>
}
