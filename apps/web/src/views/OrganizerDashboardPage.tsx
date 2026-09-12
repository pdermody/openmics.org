import { Sparkles } from 'lucide-react'
import { useOrganizerOpenMics, useOrganizerProfile } from '../features/organizer'
import type { ColorMode, ThemeId } from '../theme'
import { ClaimableRegistrationsBanner } from './ClaimableRegistrationsBanner'
import { HeaderMenu, ProfileSwitcher, ReadState, SignInButton } from './shared'

export function OrganizerDashboardPage({ theme, mode }: { theme: ThemeId; mode: ColorMode }) {
  const { context, activeProfile: selected, isOrganizer } = useOrganizerProfile()
  const openMics = useOrganizerOpenMics(selected?.id, isOrganizer)
  const hasNoOpenMics = isOrganizer && !openMics.isPending && (openMics.data?.length ?? 0) === 0

  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><a className="brand" href="/" aria-label="Open Mic home"><span className="brand-mark"><Sparkles size={17} /></span><span>open mic</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
    <section className="dashboard-page">
      <div className="eyebrow">Dashboard</div>
      <h1>Make the room ready.</h1>
      {!context.account.data && <ReadState message="Sign in to open your dashboard." />}
      <ClaimableRegistrationsBanner />
      {context.account.data && !isOrganizer && <ReadState message="Select an organizer profile to manage open mic series and events." />}
      {isOrganizer && selected && <>
        <p className="detail-lede">You are working as <strong>{selected.profile_name}</strong>. Your next actions will be scoped to this organizer profile.</p>
        {hasNoOpenMics && <div className="dashboard-card"><span className="panel-label">Get started</span><h2>Set up your first open mic</h2><p>You don’t have any open mic series yet. Create one to start scheduling events and taking registrations.</p><a className="quiet-button" href="/dashboard/series/new">Set up your first open mic</a></div>}
        <div className="dashboard-grid">
          <article className="dashboard-card"><span className="panel-label">Series</span><h2>Open mic series</h2><p>Create and maintain the rooms your audience returns to.</p><a className="quiet-button" href="/dashboard/series">Manage series</a></article>
          <article className="dashboard-card"><span className="panel-label">Tonight</span><h2>Event operations</h2><p>Keep the roster, running order, and registration status close at hand.</p><a className="quiet-button" href="/dashboard/series">View operations</a></article>
        </div>
      </>}
    </section>
  </main>
}
