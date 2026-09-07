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

export const publicReadKeys = {
  all: ['public'] as const,
  upcomingEvents: (limit = 6) => [...publicReadKeys.all, 'upcoming-events', limit] as const,
  openMics: (pageSize = 6) => [...publicReadKeys.all, 'open-mics', pageSize] as const,
}

export function useUpcomingEvents(limit = 6) {
  return useQuery({
    queryKey: publicReadKeys.upcomingEvents(limit),
    queryFn: () => api<Event[]>(`/events/upcoming?limit=${limit}`),
  })
}

export function usePublicOpenMics(pageSize = 6) {
  return useQuery({
    queryKey: publicReadKeys.openMics(pageSize),
    queryFn: async () => {
      const response = await api<OpenMicPage>(`/open-mics?page_size=${pageSize}`)
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

export function usePublicProfile(id: string | undefined) {
  return useQuery({
    queryKey: [...publicReadKeys.all, 'profile', id],
    queryFn: () => api<Profile>(`/profiles/${id}`),
    enabled: Boolean(id),
  })
}
