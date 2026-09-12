import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { fetchSimulatedAuthConfig, getStoredSimulatedAuthToken, LOCAL_SIMULATED_ROLE_KEY, type SimulatedAuthRole } from '../auth/session'
import { accountKeys, useAccountContext } from '../features/account'

export function ProfileSwitcher() {
  const { t } = useTranslation()
  const context = useAccountContext()
  const queryClient = useQueryClient()
  const [simulatedRoles, setSimulatedRoles] = useState<SimulatedAuthRole[]>([])
  const [localValue, setLocalValue] = useState(() => {
    if (typeof window === 'undefined') return 'public'
    return window.localStorage.getItem(LOCAL_SIMULATED_ROLE_KEY) ?? 'public'
  })
  const profiles = context.profiles.data?.items ?? []

  useEffect(() => {
    void fetchSimulatedAuthConfig().then((config) => setSimulatedRoles(config.enabled ? config.roles : []))
  }, [])

  const selectableProfiles = profiles.length > 0 ? profiles : simulatedRoles.map((role) => ({
    id: role.profileId,
    profile_name: role.profileName,
    profile_kind: role.kind,
  }))
  const effectiveValue = context.account.data?.current_profile_id ?? localValue

  // Group simulated roles by account so the selector shows which profiles share a login.
  const accountGroups = new Map<string, { accountDisplayName: string; roles: typeof simulatedRoles }>()
  for (const role of simulatedRoles) {
    const group = accountGroups.get(role.accountId)
    if (group) group.roles.push(role)
    else accountGroups.set(role.accountId, { accountDisplayName: role.accountDisplayName, roles: [role] })
  }

  useEffect(() => {
    if (effectiveValue === 'public') {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(LOCAL_SIMULATED_ROLE_KEY)
      }
      return
    }
    if (typeof window !== 'undefined' && !window.localStorage.getItem(LOCAL_SIMULATED_ROLE_KEY) && selectableProfiles.some((profile) => profile.id === effectiveValue)) {
      const matchingRole = simulatedRoles.find((role) => role.profileId === effectiveValue)
      if (matchingRole) {
        window.localStorage.setItem(LOCAL_SIMULATED_ROLE_KEY, matchingRole.token)
      }
    }
    setLocalValue(effectiveValue)
  }, [effectiveValue, selectableProfiles, simulatedRoles])

  return <div className="profile-context-controls"><label className="profile-switcher"><span className="sr-only">{t('currentProfile')}</span><select id="profile-switcher-select" value={effectiveValue} onChange={(event) => {
    const selected = event.target.value
    setLocalValue(selected)
    if (selected === 'public') {
      if (typeof window !== 'undefined') window.localStorage.removeItem(LOCAL_SIMULATED_ROLE_KEY)
      void queryClient.invalidateQueries({ queryKey: accountKeys.me })
      return
    }

    const matchingRole = simulatedRoles.find((role) => role.profileId === selected)
    if (matchingRole && matchingRole.token !== getStoredSimulatedAuthToken()) {
      // Switching to a different simulated account/token entirely.
      if (typeof window !== 'undefined') window.localStorage.setItem(LOCAL_SIMULATED_ROLE_KEY, matchingRole.token)
      void queryClient.invalidateQueries({ queryKey: accountKeys.me })
      return
    }

    // Same account (real or simulated): switch which profile is current via the API.
    context.currentProfile.mutate(selected)
  }} aria-label={t('currentProfile')}><option value="public">{t('publicUnauth')}</option>{accountGroups.size > 0
    ? [...accountGroups.values()].map((group) => <optgroup label={group.accountDisplayName} key={group.roles[0].accountId}>{group.roles.map((role) => <option value={role.profileId} key={role.profileId}>{role.profileName} · {role.kind}</option>)}</optgroup>)
    : selectableProfiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.profile_name} · {profile.profile_kind}</option>)}</select></label></div>
}

export function DashboardMenuLink() {
  const { t } = useTranslation()
  const context = useAccountContext()
  return context.account.data ? <a href="/dashboard">{t('dashboard')}</a> : null
}
