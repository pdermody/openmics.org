import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Event, OpenMic } from './publicReads'

export type OpenMicDetail = OpenMic & {
  owner_profile_id: string
  address_line1: string
  address_line2: string | null
  postcode: string | null
  country: string
  lat: number | null
  lng: number | null
  time_zone: string
  website: string | null
  contact_email: string | null
  schedule_summary: string | null
  schedule_details: string | null
  originals_only: boolean
  amplification_available: boolean
  age_policy: 'adults_only' | 'children_only' | 'both'
  entry_fee_amount: number | null
  entry_fee_currency: string | null
  entry_fee_note: string | null
}

export type OpenMicFormInput = {
  name: string
  description?: string
  venue_name: string
  address_line1: string
  address_line2?: string
  postcode?: string
  city: string
  country: string
  lat?: number
  lng?: number
  time_zone: string
  website?: string
  contact_email?: string
  schedule_summary?: string
  schedule_details?: string
  originals_only?: boolean
  amplification_available?: boolean
  age_policy?: 'adults_only' | 'children_only' | 'both'
  activities: string[]
  tags?: string[]
  registration_mode?: 'pre_only' | 'on_night_only' | 'both' | 'external'
  external_registration_url?: string
  entry_fee_amount?: number
  entry_fee_currency?: string
  entry_fee_note?: string
  handle?: string
}

export const organizerKeys = {
  openMics: (profileId: string | undefined) => ['organizer', 'open-mics', profileId] as const,
  openMic: (id: string | undefined) => ['organizer', 'open-mic', id] as const,
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

export function useOpenMicDetail(id: string | undefined) {
  return useQuery({
    queryKey: organizerKeys.openMic(id),
    queryFn: () => api<OpenMicDetail>(`/open-mics/${id}`),
    enabled: Boolean(id),
    retry: false,
  })
}

export function useCreateOpenMic(profileId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: OpenMicFormInput) => api<OpenMicDetail>('/open-mics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Current-Profile': profileId ?? '' },
      body: JSON.stringify(input),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: organizerKeys.openMics(profileId) }),
  })
}

export function useUpdateOpenMic(openMicId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<OpenMicFormInput, 'handle'>) => api<OpenMicDetail>(`/open-mics/${openMicId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    onSuccess: (updated) => {
      queryClient.setQueryData(organizerKeys.openMic(openMicId), updated)
      queryClient.invalidateQueries({ queryKey: organizerKeys.openMics(updated.owner_profile_id) })
    },
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

export type EventDetail = Event & {
  ends_at: string | null
  running: boolean
  registrations_closed_at: string | null
  address_line1: string
  address_line2: string | null
  postcode: string | null
  country: string
  lat: number | null
  lng: number | null
  notes: string | null
  entry_fee_amount: number | null
  entry_fee_currency: string | null
  entry_fee_note: string | null
}

export type EventFormInput = {
  title: string
  starts_at: string
  ends_at?: string
  time_zone: string
  registrations_closed_at?: string
  capacity?: number
  venue_name?: string
  address_line1?: string
  address_line2?: string
  postcode?: string
  city?: string
  country?: string
  lat?: number
  lng?: number
  activities?: string[]
  tags?: string[]
  notes?: string
  entry_fee_amount?: number
  entry_fee_currency?: string
  entry_fee_note?: string
}

export function useEventDetail(openMicId: string | undefined, eventId: string | undefined) {
  return useQuery({
    queryKey: [...organizerKeys.openMics(openMicId), 'event', eventId],
    queryFn: () => api<EventDetail>(`/open-mics/${openMicId}/events/${eventId}`),
    enabled: Boolean(openMicId) && Boolean(eventId),
    retry: false,
  })
}

export function useCreateEvent(openMicId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: EventFormInput) => api<EventDetail>(`/open-mics/${openMicId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...organizerKeys.openMics(openMicId), 'events'] }),
  })
}

export function useUpdateEvent(openMicId: string | undefined, eventId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: EventFormInput) => api<EventDetail>(`/open-mics/${openMicId}/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    onSuccess: (updated) => {
      queryClient.setQueryData([...organizerKeys.openMics(openMicId), 'event', eventId], updated)
      queryClient.invalidateQueries({ queryKey: [...organizerKeys.openMics(openMicId), 'events'] })
    },
  })
}
