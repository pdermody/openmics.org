import { useAccountContext } from '../features/account'

export function ProfileSwitcher() {
  const context = useAccountContext()
  if (!context.account.data || context.profiles.isPending || context.profiles.data?.items.length === 0) return <div className="profile-slot" aria-hidden="true" />
  const profiles = context.profiles.data?.items ?? []
  return <div className="profile-context-controls"><label className="profile-switcher"><span className="sr-only">Current profile</span><select value={context.account.data.current_profile_id ?? ''} onChange={(event) => context.currentProfile.mutate(event.target.value)} aria-label="Current profile"><option value="" disabled>Select profile</option>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.profile_name} · {profile.profile_kind}</option>)}</select></label></div>
}

export function DashboardMenuLink() {
  const context = useAccountContext()
  const selected = context.profiles.data?.items.find((profile) => profile.id === context.account.data?.current_profile_id)
  const canManage = selected?.profile_kind === 'organizer' && context.permissions.data?.permissions.includes('profiles:manage')
  return canManage ? <a href="/dashboard">Dashboard</a> : null
}
