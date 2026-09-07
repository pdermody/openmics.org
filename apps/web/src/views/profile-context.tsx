import { useState } from 'react'
import { useAccountContext } from '../features/account'

const demoProfiles = [
  { id: 'demo-organizer', profile_name: 'Organizer Demo', profile_kind: 'organizer' },
  { id: 'demo-performer', profile_name: 'Performer Demo', profile_kind: 'performer' },
] as const

export function ProfileSwitcher() {
  const context = useAccountContext()
  const [localValue, setLocalValue] = useState('public')
  const profiles = context.profiles.data?.items ?? []
  const selectableProfiles = profiles.length > 0 ? profiles : demoProfiles
  const value = context.account.data?.current_profile_id ?? localValue

  return <div className="profile-context-controls"><label className="profile-switcher"><span className="sr-only">Current profile</span><select value={value} onChange={(event) => {
    const selected = event.target.value
    setLocalValue(selected)
    if (selected === 'public') return
    if (context.account.data && selected !== 'demo-organizer' && selected !== 'demo-performer') {
      context.currentProfile.mutate(selected)
    }
  }} aria-label="Current profile"><option value="public">Public / unauth</option>{selectableProfiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.profile_name} · {profile.profile_kind}</option>)}</select></label></div>
}

export function DashboardMenuLink() {
  const context = useAccountContext()
  const selected = context.profiles.data?.items.find((profile) => profile.id === context.account.data?.current_profile_id)
  const canManage = selected?.profile_kind === 'organizer' && context.permissions.data?.permissions.includes('profiles:manage')
  return canManage ? <a href="/dashboard">Dashboard</a> : null
}
