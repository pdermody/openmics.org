import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiBaseUrl } from '../api/client'
import { useAccountContext } from './account'
import type { Event, OpenMic } from './publicReads'

// Single source of truth for "is this signed-in account currently working as an organizer
// profile it actually owns", combining the real permission response with the real profile
// list rather than trusting any locally cached/URL-derived assumption.
export function useOrganizerProfile() {
  const context = useAccountContext()
  const activeProfile = context.profiles.data?.items.find((profile) => profile.id === context.account.data?.current_profile_id)
  const isOrganizer = Boolean(activeProfile?.profile_kind === 'organizer' && context.permissions.data?.permissions.includes('profiles:manage'))
  return { context, activeProfile, isOrganizer }
}

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
      // Uses the authenticated /me/open-mics endpoint (not the public directory /open-mics,
      // which always excludes draft/ended series) so an organizer sees every series they own,
      // including one they just created.
      const response = await api<{ items: OpenMic[] }>(`/me/open-mics?owner_profile_id=${profileId}`)
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
    mutationFn: (input: EventFormInput) => api<EventDetail>(`/events/${eventId}`, {
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

// --- Event roster (Milestone 2: organizer event operations) ---

export type PerformanceStatus = 'registered' | 'performed' | 'no_show' | 'cancelled'

export type Performance = {
  id: string
  registration_id: string
  name: string
  activity: string | null
  sequence: number
  status: PerformanceStatus
  notes?: string | null
}

export type RosterRegistration = {
  id: string
  event_id: string
  profile_id: string | null
  performer_name: string
  performer_city: string | null
  contact_email: string | null
  contact_phone: string | null
  song_names: string[]
  submission_channel: string
  organizer_supervised: boolean
  media_consent: boolean
  email_verified_at: string | null
  verification_method: string | null
  visibility_state: 'valid' | 'pending'
  claimed_by_account_id: string | null
  claimed_at: string | null
  adopted_profile_id: string | null
  created_at: string
  updated_at: string
  performances: Performance[]
}

const rosterKey = (eventId: string | undefined) => ['organizer', 'event-roster', eventId] as const

export function useEventRoster(eventId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: rosterKey(eventId),
    queryFn: () => api<RosterRegistration[]>(`/events/${eventId}/registrations`),
    enabled: Boolean(eventId) && enabled,
    retry: false,
  })
}

export type PerformanceInput = {
  registration_id: string
  name: string
  activity?: string
  sequence?: number
  status?: PerformanceStatus
  notes?: string | null
}

export function useCreatePerformance(eventId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: PerformanceInput) => api<Performance>('/performances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rosterKey(eventId) }),
  })
}

export function useUpdatePerformance(eventId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<Omit<PerformanceInput, 'registration_id'>> & { id: string }) => api<Performance>(`/performances/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rosterKey(eventId) }),
  })
}

export function useDeletePerformance(eventId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/performances/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rosterKey(eventId) }),
  })
}

const ROSTER_STREAM_EVENTS = [
  'registration.created',
  'registration.updated',
  'performance.created',
  'performance.updated',
  'performance.deleted',
  'performance.reordered',
] as const

export type RosterStreamStatus = 'connecting' | 'live' | 'reconnecting'

// Opens the roster SSE stream (Milestone 2 item 4) so an open roster page picks up changes made
// elsewhere (another organizer, the kiosk) without polling. NOTIFY payloads carry only an event
// name + id, never row data, so every event just invalidates the roster query and lets react-query
// refetch — this avoids ever merging partial/stale pushed data into an in-progress organizer edit.
// EventSource can't send an Authorization header, so a short-lived stream_token is exchanged first;
// reconnects (network blips, laptop sleep) use exponential backoff capped at 30s, and any
// `resync_required` event (always sent when a reconnect carries Last-Event-ID, since the server
// keeps no replay log) is handled identically to the other events, i.e. a plain refetch. The
// returned status lets the roster page surface reconnect/retry state to the organizer, per plan.
export function useRosterLiveUpdates(eventId: string | undefined, enabled: boolean): RosterStreamStatus {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<RosterStreamStatus>('connecting')

  useEffect(() => {
    if (!eventId || !enabled) return
    let cancelled = false
    let source: EventSource | undefined
    let backoffMs = 1000
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined
    let hasConnectedOnce = false

    function scheduleReconnect() {
      if (cancelled) return
      setStatus('reconnecting')
      reconnectTimer = setTimeout(() => void connect(), backoffMs)
      backoffMs = Math.min(backoffMs * 2, 30_000)
    }

    async function connect() {
      if (cancelled) return
      try {
        const { stream_token: streamToken } = await api<{ stream_token: string; expires_at: string }>(
          `/events/${eventId}/roster/stream-token`,
          { method: 'POST' },
        )
        if (cancelled) return
        const url = `${apiBaseUrl}/events/${eventId}/roster/stream?stream_token=${encodeURIComponent(streamToken)}`
        source = new EventSource(url)
        source.addEventListener('open', () => {
          backoffMs = 1000
          hasConnectedOnce = true
          setStatus('live')
        })
        const refetchRoster = () => void queryClient.invalidateQueries({ queryKey: rosterKey(eventId) })
        source.addEventListener('resync_required', refetchRoster)
        for (const eventName of ROSTER_STREAM_EVENTS) source.addEventListener(eventName, refetchRoster)
        source.onerror = () => {
          source?.close()
          if (hasConnectedOnce) refetchRoster() // a dropped connection may have missed events; catch up once, then resume live-tailing
          scheduleReconnect()
        }
      } catch {
        scheduleReconnect()
      }
    }

    void connect()
    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      source?.close()
    }
  }, [eventId, enabled, queryClient])

  return status
}

// --- Kiosk registration (Milestone 2: organizer-supervised, on-the-night sign-up) ---

export type KioskRegistrationInput = {
  performer_name: string
  performer_city?: string
  contact_phone?: string
  song_names?: string[]
  media_consent?: boolean
}

export function useKioskRegistration(eventId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: KioskRegistrationInput) => api(`/events/${eventId}/registrations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, submission_channel: 'kiosk', organizer_supervised: true }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: rosterKey(eventId) }),
  })
}
