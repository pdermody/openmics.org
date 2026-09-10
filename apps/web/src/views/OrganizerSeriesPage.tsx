import { MapPin, Sparkles } from 'lucide-react'
import { useOrganizerOpenMics, useOrganizerProfile } from '../features/organizer'
import type { ColorMode, ThemeId } from '../theme'
import { HeaderMenu, ProfileSwitcher, ReadState, SignInButton } from './shared'

export function OrganizerSeriesPage({ theme, mode }: { theme: ThemeId; mode: ColorMode }) {
  const { context, activeProfile: selected, isOrganizer } = useOrganizerProfile()
  const series = useOrganizerOpenMics(isOrganizer ? selected?.id : undefined, isOrganizer)

  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><a className="brand" href="/" aria-label="Open Mic home"><span className="brand-mark"><Sparkles size={17} /></span><span>open mic</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
    <section className="dashboard-page">
      <a className="back-link" href="/dashboard">← Back to dashboard</a>
      <div className="eyebrow">Organizer workspace</div>
      <h1>Open mic series</h1>
      {!context.account.data && <ReadState message="Sign in to manage your open mic series." />}
      {context.account.data && !isOrganizer && <ReadState message="Select an organizer profile to manage open mic series." />}
      {isOrganizer && <a className="quiet-button" href="/dashboard/series/new">Create series</a>}
      {isOrganizer && series.isPending && <ReadState message="Loading your open mic series…" />}
      {isOrganizer && series.isError && <ReadState message="We could not load your open mic series." retry={() => void series.refetch()} />}
      {isOrganizer && series.isSuccess && series.data.length === 0 && <ReadState message="You do not have any open mic series yet." />}
      {isOrganizer && series.data?.map((openMic) => <article className="dashboard-series-card" key={openMic.id}><div><span className="panel-label">{openMic.status}</span><h2>{openMic.name}</h2><p>{openMic.description ?? 'No description yet.'}</p><span className="event-meta"><MapPin size={15} /> {openMic.venue_name}, {openMic.city}</span></div><div className="dashboard-series-card-actions"><a className="quiet-button" href={`/dashboard/series/${openMic.id}/edit`}>Edit</a><a className="quiet-button" href={`/dashboard/series/${openMic.id}`}>View events</a></div></article>)}
    </section>
  </main>
}
