import { Sparkles } from 'lucide-react'
import { useAccountContext } from '../features/account'
import type { ColorMode, ThemeId } from '../theme'
import { HeaderMenu, ProfileSwitcher, ReadState, SignInButton } from './shared'

export function OrganizerDashboardPage({ theme, mode }: { theme: ThemeId; mode: ColorMode }) {
  const context = useAccountContext()
  const selected = context.profiles.data?.items.find((profile) => profile.id === context.account.data?.current_profile_id)
  const isOrganizer = selected?.profile_kind === 'organizer' && context.permissions.data?.permissions.includes('profiles:manage')

  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><a className="brand" href="/" aria-label="Open Mic home"><span className="brand-mark"><Sparkles size={17} /></span><span>open mic</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
    <section className="dashboard-page">
      <div className="eyebrow">Organizer workspace</div>
      <h1>Make the room ready.</h1>
      {!context.account.data && <ReadState message="Sign in to open your organizer workspace." />}
      {context.account.data && !isOrganizer && <ReadState message="Select an organizer profile to manage open mic series and events." />}
      {isOrganizer && <>
        <p className="detail-lede">You are working as <strong>{selected.profile_name}</strong>. Your next actions will be scoped to this organizer profile.</p>
        <div className="dashboard-grid">
          <article className="dashboard-card"><span className="panel-label">Series</span><h2>Open mic series</h2><p>Create and maintain the rooms your audience returns to.</p><a className="quiet-button" href="/dashboard/series">Manage series</a></article>
          <article className="dashboard-card"><span className="panel-label">Tonight</span><h2>Event operations</h2><p>Keep the roster, running order, and registration status close at hand.</p><button className="quiet-button" type="button">View operations</button></article>
        </div>
      </>}
    </section>
  </main>
}
