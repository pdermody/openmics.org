import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export type Event = {
  id: string
  public_code: string
  open_mic_id: string
  title: string
  starts_at: string
  time_zone: string
  venue_name: string
  city: string
  country: string
  activities: string[] | null
  tags: string[]
  capacity: number | null
  registrations_closed_at: string | null
  notes: string | null
}

export type OpenMic = {
  id: string
  current_handle: string | null
  name: string
  description: string | null
  venue_name: string
  city: string
  country: string
  activities: string[]
  tags: string[]
  registration_mode: 'pre_only' | 'on_night_only' | 'both' | 'external'
  external_registration_url: string | null
  status: string
}

export type Profile = {
  id: string
  current_handle: string | null
  profile_name: string
  profile_kind: string
  bio: string | null
  profile_image_url: string | null
  visibility: string
}

type OpenMicPage = { items: OpenMic[]; pagination: { page: number; page_size: number; total: number } }

/** Mirrors the API's own registrations-closed check (apps/api/src/registrations/routes.ts). */
export function isRegistrationClosed(event: Pick<Event, 'registrations_closed_at'>): boolean {
  return Boolean(event.registrations_closed_at) && new Date(event.registrations_closed_at!).getTime() <= Date.now()
}

/** Approximate coordinates for the seeded dev cities, so switching to a profile based in a
 * different city (via the profile switcher) can demonstrate "near me" filtering locally. */
const DEV_CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
  dublin: { lat: 53.3498, lng: -6.2603 },
  cork: { lat: 51.8985, lng: -8.4756 },
  galway: { lat: 53.2707, lng: -9.0568 },
  paris: { lat: 48.8566, lng: 2.3522 },
}

export function getCityCoordinates(city: string | null | undefined): { lat: number; lng: number } | undefined {
  if (!city) return undefined
  return DEV_CITY_COORDINATES[city.trim().toLowerCase()]
}

export const publicReadKeys = {
  all: ['public'] as const,
  upcomingEvents: (limit = 6, near?: { lat: number; lng: number; radiusKm?: number }) =>
    [...publicReadKeys.all, 'upcoming-events', limit, near?.lat, near?.lng, near?.radiusKm] as const,
  openMics: (pageSize = 6, near?: { lat: number; lng: number; radiusKm?: number }) =>
    [...publicReadKeys.all, 'open-mics', pageSize, near?.lat, near?.lng, near?.radiusKm] as const,
}

export function useUpcomingEvents(limit = 6, near?: { lat: number; lng: number; radiusKm?: number }) {
  return useQuery({
    queryKey: publicReadKeys.upcomingEvents(limit, near),
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(limit) })
      if (near) {
        params.set('near', `${near.lat},${near.lng}`)
        params.set('radius_km', String(near.radiusKm ?? 50))
      }
      return api<Event[]>(`/events/upcoming?${params.toString()}`)
    },
  })
}

export function usePublicOpenMics(pageSize = 6, near?: { lat: number; lng: number; radiusKm?: number }) {
  return useQuery({
    queryKey: publicReadKeys.openMics(pageSize, near),
    queryFn: async () => {
      const params = new URLSearchParams({ page_size: String(pageSize) })
      if (near) {
        params.set('near', `${near.lat},${near.lng}`)
        params.set('radius_km', String(near.radiusKm ?? 50))
      }
      const response = await api<OpenMicPage>(`/open-mics?${params.toString()}`)
      return response.items
    },
  })
}

export function usePublicEvent(id: string | undefined) {
  return useQuery({
    queryKey: [...publicReadKeys.all, 'event', id],
    queryFn: () => api<Event>(`/events/${id}`),
    enabled: Boolean(id),
  })
}

export function usePublicOpenMic(id: string | undefined) {
  return useQuery({
    queryKey: [...publicReadKeys.all, 'open-mic', id],
    queryFn: () => api<OpenMic>(`/open-mics/${id}`),
    enabled: Boolean(id),
  })
}

export function useNextEvent(openMicId: string | undefined) {
  return useQuery({
    queryKey: [...publicReadKeys.all, 'next-event', openMicId],
    queryFn: () => api<Event>(`/open-mics/${openMicId}/next-event`),
    enabled: Boolean(openMicId),
    retry: false,
  })
}

export function usePublicProfile(id: string | undefined) {
  return useQuery({
    queryKey: [...publicReadKeys.all, 'profile', id],
    queryFn: () => api<Profile>(`/profiles/${id}`),
    enabled: Boolean(id),
  })
}
