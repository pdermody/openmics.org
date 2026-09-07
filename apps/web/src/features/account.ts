import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { getStoredSimulatedAuthToken, isAuthConfigured } from '../auth/session'

export type Account = {
  id: string
  email: string
  display_name: string | null
  city: string | null
  preferred_language: string | null
  current_profile_id: string | null
  is_platform_admin: boolean
  plan: string
}

export type AccountProfile = {
  id: string
  profile_name: string
  profile_kind: string
  current_handle: string | null
  bio: string | null
  phone: string | null
  visibility: string
}

export const accountKeys = {
  me: ['account', 'me'] as const,
  profiles: (accountId: string | undefined) => ['account', 'profiles', accountId] as const,
  permissions: (profileId: string | undefined) => ['account', 'permissions', profileId] as const,
}

type QueryState<T> = {
  data?: T
  isPending: boolean
  isError: boolean
  error?: unknown
}

export function useAccountContext(enabled = true) {
  const queryClient = useQueryClient()
  const simulatedAuthToken = getStoredSimulatedAuthToken()
  const hasAuth = isAuthConfigured || Boolean(import.meta.env.VITE_LOCAL_AUTH_TOKEN) || Boolean(simulatedAuthToken)

  const account = useQuery({
    queryKey: accountKeys.me,
    queryFn: () => api<Account>('/me'),
    enabled: hasAuth && enabled,
    retry: false,
  })
  const profiles = useQuery({
    queryKey: accountKeys.profiles(account.data?.id),
    queryFn: () => api<{ items: AccountProfile[] }>(`/accounts/${account.data!.id}/profiles`),
    enabled: hasAuth && Boolean(account.data?.id),
    retry: false,
  })

  const effectiveAccount: QueryState<Account> = hasAuth ? {
    data: account.data,
    isPending: account.isPending,
    isError: account.isError,
    error: account.error,
  } : {
    data: undefined,
    isPending: false,
    isError: false,
  }

  const effectiveProfiles: QueryState<{ items: AccountProfile[] }> = hasAuth ? {
    data: profiles.data ?? { items: [] },
    isPending: profiles.isPending,
    isError: profiles.isError,
    error: profiles.error,
  } : {
    data: { items: [] },
    isPending: false,
    isError: false,
  }

  const currentProfile = useMutation({
    mutationFn: async (profileId: string) => {
      if (!hasAuth || !account.data?.id) {
        return null
      }
      return api<AccountProfile>(`/accounts/${account.data.id}/current-profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId }),
      })
    },
    onSuccess: (profile) => {
      if (!profile) return
      queryClient.setQueryData<Account>(accountKeys.me, (old) => old ? { ...old, current_profile_id: profile.id } : old)
      queryClient.invalidateQueries({ queryKey: accountKeys.permissions(profile.id) })
    },
  })

  const updateProfile = useMutation({
    mutationFn: (input: { id: string; profile_name: string; bio: string; phone: string; visibility: string }) => api<AccountProfile>(`/profiles/${input.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_name: input.profile_name, bio: input.bio || null, phone: input.phone || null, visibility: input.visibility }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.profiles(account.data?.id) }),
  })

  const selectedProfileId = effectiveAccount.data?.current_profile_id ?? undefined
  const permissions = useQuery({
    queryKey: accountKeys.permissions(selectedProfileId),
    queryFn: () => api<{ permissions: string[] }>(`/me/permissions?profile=${selectedProfileId}`),
    enabled: hasAuth && Boolean(selectedProfileId),
    retry: false,
  })

  const effectivePermissions: QueryState<{ permissions: string[] }> = !hasAuth ? {
    data: { permissions: [] },
    isPending: false,
    isError: false,
  } : {
    data: permissions.data ?? { permissions: [] },
    isPending: permissions.isPending,
    isError: permissions.isError,
    error: permissions.error,
  }

  return { account: effectiveAccount, profiles: effectiveProfiles, currentProfile, permissions: effectivePermissions, updateProfile }
}
