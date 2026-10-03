import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export type Event = {
  id: string
  public_code: string
  open_mic_id: string
  title: string
  starts_at: string
  ends_at?: string | null
  time_zone: string
  venue_name: string
  address_line1?: string
  address_line2?: string | null
  postcode?: string | null
  city: string
  country: string
  activities: string[] | null
  tags: string[]
  capacity: number | null
  registrations_closed_at: string | null
  status: 'draft' | 'published'
  phase: 'future' | 'running' | 'past'
  notes: string | null
}

export type OpenMic = {
  id: string
  public_code: string
  owner_profile_id: string
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
  status: 'active' | 'paused' | 'ended' | 'draft'
}

export type Profile = {
  id: string
  current_handle: string | null
  profile_name: string
  profile_kind: string
  bio: string | null
  profile_image_url: string | null
  visibility: string
  show_gig_media?: boolean
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

export function usePublicEvent(id: string | undefined, kioskToken?: string) {
  return useQuery({
    queryKey: [...publicReadKeys.all, 'event', id, kioskToken],
    queryFn: () => api<Event>(`/events/${id}${kioskToken ? `?kiosk_token=${encodeURIComponent(kioskToken)}` : ''}`),
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
    queryFn: () => api<{ current_event: Event | null; current_registration_open: boolean; next_event: Event | null; next_registration_event: Event | null }>(`/open-mics/${openMicId}/next-event`),
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

export function usePublicOwnerOpenMics(ownerProfileId: string | undefined) {
  return useQuery({
    queryKey: [...publicReadKeys.all, 'owner-open-mics', ownerProfileId],
    queryFn: async () => (await api<OpenMicPage>(`/open-mics?owner_profile_id=${encodeURIComponent(ownerProfileId!)}&page_size=100`)).items,
    enabled: Boolean(ownerProfileId),
  })
}

export type HandleResolution = { type: 'profile' | 'open_mic'; id: string }

// The `handles` table is the single source of truth for handle -> entity resolution (see
// docs/6-open-mic-vanity-urls.md); the public /@handle route resolves through this before
// fetching the entity itself, rather than relying on any entity table's own handle matching.
export function useResolveHandle(handle: string | undefined) {
  return useQuery({
    queryKey: [...publicReadKeys.all, 'handle', handle],
    queryFn: () => api<HandleResolution>(`/handles/${handle}`),
    enabled: Boolean(handle),
    retry: false,
  })
}
