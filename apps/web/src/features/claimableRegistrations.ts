import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

export type ClaimableRegistration = {
  id: string
  event_id: string
  performer_name: string
  contact_email: string | null
  song_names: string[]
  created_at: string
}

export const claimableRegistrationsKeys = {
  list: ['registrations', 'claimable'] as const,
}

export function useClaimableRegistrations(enabled: boolean) {
  return useQuery({
    queryKey: claimableRegistrationsKeys.list,
    queryFn: () => api<ClaimableRegistration[]>('/me/claimable-registrations'),
    enabled,
    retry: false,
  })
}

export function useClaimRegistration() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { registrationId: string; adoptedProfileId?: string }) => api(`/registrations/${input.registrationId}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adopted_profile_id: input.adoptedProfileId ?? null, sync_public_fields: Boolean(input.adoptedProfileId) }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: claimableRegistrationsKeys.list }),
  })
}
