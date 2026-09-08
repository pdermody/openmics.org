import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAccountContext } from './account'
import { getLocallyRegisteredEventIds } from './guestRegistrations'

/** Combines the current performer profile's server-tracked registrations with this browser's
 * locally-tracked guest registrations, so any page showing events can flag "already registered". */
export function useMyRegisteredEventIds(): Set<string> {
  const context = useAccountContext()
  const activeProfile = context.profiles.data?.items.find((profile) => profile.id === context.account.data?.current_profile_id)
  const performerProfile = activeProfile?.profile_kind === 'performer' ? activeProfile : undefined

  const registrations = useQuery({
    queryKey: ['me', 'registrations', performerProfile?.id],
    queryFn: () => api<{ event_id: string }[]>(`/me/registrations?profile=${performerProfile!.id}`),
    enabled: Boolean(performerProfile),
    retry: false,
  })

  const remoteIds = registrations.data?.map((registration) => registration.event_id) ?? []
  return new Set([...remoteIds, ...getLocallyRegisteredEventIds()])
}
