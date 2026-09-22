import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, LayoutDashboard, Settings } from 'lucide-react'
import { fetchSimulatedAuthConfig, getAuthenticatedUser, getStoredSimulatedAuthToken, LOCAL_SIMULATED_ROLE_KEY, type SimulatedAuthRole } from '../auth/session'
import { accountKeys, useAccountContext } from '../features/account'
import { MenuItem, MenuSeparator, MenuSubContent, MenuSubRoot, MenuSubTrigger } from '../components/radix-menu'

export function ProfileSwitcher() {
  const { t } = useTranslation()
  const context = useAccountContext()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [simulatedRoles, setSimulatedRoles] = useState<SimulatedAuthRole[]>([])
  const [authGateReady, setAuthGateReady] = useState(false)
  const [cognitoUserPresent, setCognitoUserPresent] = useState(false)
  const [localValue, setLocalValue] = useState(() => {
    if (typeof window === 'undefined') return 'public'
    return window.localStorage.getItem(LOCAL_SIMULATED_ROLE_KEY) ?? 'public'
  })
  const profiles = context.profiles.data?.items ?? []

  useEffect(() => {
    void Promise.all([fetchSimulatedAuthConfig(), getAuthenticatedUser()]).then(([config, user]) => {
      setSimulatedRoles(config.enabled ? config.roles : [])
      setCognitoUserPresent(Boolean(user))
      setAuthGateReady(true)
    })
  }, [])

  const attachedProfileIds = new Set(profiles.map((profile) => profile.id))
  const storedToken = getStoredSimulatedAuthToken()
  const isSimulatedSession = Boolean(storedToken && simulatedRoles.some((role) => role.token === storedToken))
  const accountProfiles = isSimulatedSession ? [] : profiles
  const devProfiles = cognitoUserPresent
    ? []
    : isSimulatedSession
    ? simulatedRoles
    : simulatedRoles.filter((role) => !attachedProfileIds.has(role.profileId))
  const selectableProfiles = accountProfiles.length > 0 ? accountProfiles : devProfiles.map((role) => ({
    id: role.profileId,
    profile_name: role.profileName,
    profile_kind: role.kind,
  }))
  const effectiveValue = context.account.data?.current_profile_id ?? localValue

  useEffect(() => {
    if (!authGateReady) return
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
  }, [authGateReady, effectiveValue, selectableProfiles, simulatedRoles])

  if (!authGateReady) return null

  function selectProfile(selected: string) {
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
      queryClient.clear()
      void navigate({ to: '/dashboard' })
      return
    }

    // Same account (real or simulated): switch which profile is current via the API.
    context.currentProfile.mutate(selected)
  }

  return <MenuSubRoot>
    <MenuSubTrigger><span>{t('profiles')}</span><ChevronRight size={15} aria-hidden="true" /></MenuSubTrigger>
    <MenuSubContent>
      {devProfiles.length > 0 && <MenuItem onSelect={() => selectProfile('public')}>{effectiveValue === 'public' && <Check size={15} aria-hidden="true" />}{t('publicUnauth')}</MenuItem>}
      {accountProfiles.map((profile) => <MenuItem key={profile.id} onSelect={() => selectProfile(profile.id)}>{effectiveValue === profile.id && <Check size={15} aria-hidden="true" />}{profile.profile_name} · {profile.profile_kind}</MenuItem>)}
      {devProfiles.length > 0 && <MenuSeparator />}
      {devProfiles.map((role) => <MenuItem key={role.profileId} onSelect={() => selectProfile(role.profileId)}>{effectiveValue === role.profileId && <Check size={15} aria-hidden="true" />}[DEV] {role.profileName} · {role.kind} · {role.accountDisplayName}</MenuItem>)}
      {context.profiles.isPending && <MenuItem disabled onSelect={() => undefined}>{t('loadingProfiles')}</MenuItem>}
      {context.profiles.isError && <MenuItem disabled onSelect={() => undefined}>{t('profilesLoadError')}</MenuItem>}
      {!context.profiles.isPending && !context.profiles.isError && accountProfiles.length === 0 && devProfiles.length === 0 && <MenuItem disabled onSelect={() => undefined}>{t('noProfiles')}</MenuItem>}
      {context.account.data && <><MenuSeparator /><MenuItem onSelect={() => void navigate({ to: '/profiles/manage' })}><Settings size={15} aria-hidden="true" />{t('manageProfiles')}</MenuItem></>}
    </MenuSubContent>
  </MenuSubRoot>
}

export function CurrentProfileLabel() {
  const { t } = useTranslation()
  const context = useAccountContext()
  if (!context.account.data) return null
  const profile = context.profiles.data?.items.find((item) => item.id === context.account.data?.current_profile_id)
  return <span className="current-profile-label">{profile?.profile_name ?? t('publicUnauth')}</span>
}

export function DashboardMenuLink() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const context = useAccountContext()
  const activeProfile = context.profiles.data?.items.find((profile) => profile.id === context.account.data?.current_profile_id)
  const canManageDashboard = activeProfile?.profile_kind === 'organizer' && context.permissions.data?.permissions.includes('profiles:manage')
  return canManageDashboard ? <MenuItem onSelect={() => void navigate({ to: '/dashboard' })}><LayoutDashboard size={15} aria-hidden="true" />{t('dashboard')}</MenuItem> : null
}
