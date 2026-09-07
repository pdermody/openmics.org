import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

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
}

export const accountKeys = {
  me: ['account', 'me'] as const,
  profiles: (accountId: string | undefined) => ['account', 'profiles', accountId] as const,
  permissions: (profileId: string | undefined) => ['account', 'permissions', profileId] as const,
}

export function useAccountContext(enabled = true) {
  const queryClient = useQueryClient()
  const account = useQuery({
    queryKey: accountKeys.me,
    queryFn: () => api<Account>('/me'),
    enabled,
    retry: false,
  })
  const profiles = useQuery({
    queryKey: accountKeys.profiles(account.data?.id),
    queryFn: () => api<{ items: AccountProfile[] }>(`/accounts/${account.data!.id}/profiles`),
    enabled: Boolean(account.data?.id),
    retry: false,
  })
  const currentProfile = useMutation({
    mutationFn: (profileId: string) => api<AccountProfile>(`/accounts/${account.data!.id}/current-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id: profileId }),
    }),
    onSuccess: (profile) => {
      queryClient.setQueryData<Account>(accountKeys.me, (old) => old ? { ...old, current_profile_id: profile.id } : old)
      queryClient.invalidateQueries({ queryKey: accountKeys.permissions(profile.id) })
    },
  })
  const selectedProfileId = account.data?.current_profile_id ?? undefined
  const permissions = useQuery({
    queryKey: accountKeys.permissions(selectedProfileId),
    queryFn: () => api<{ permissions: string[] }>(`/me/permissions?profile=${selectedProfileId}`),
    enabled: Boolean(selectedProfileId),
    retry: false,
  })
  return { account, profiles, currentProfile, permissions }
}
