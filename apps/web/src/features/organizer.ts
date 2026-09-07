import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Event, OpenMic } from './publicReads'

export const organizerKeys = {
  openMics: (profileId: string | undefined) => ['organizer', 'open-mics', profileId] as const,
}

export function useOrganizerOpenMics(profileId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: organizerKeys.openMics(profileId),
    queryFn: async () => {
      const response = await api<{ items: OpenMic[] }>(`/open-mics?owner_profile_id=${profileId}&page_size=100`)
      return response.items
    },
    enabled: Boolean(profileId) && enabled,
    retry: false,
  })
}

export function useOrganizerSeriesEvents(seriesId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...organizerKeys.openMics(seriesId), 'events'],
    queryFn: () => api<Event[]>(`/open-mics/${seriesId}/events`),
    enabled: Boolean(seriesId) && enabled,
    retry: false,
  })
}
