import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
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
  const isOrganizerPending = context.account.isPending || context.profiles.isPending || context.permissions.isPending
  return { context, activeProfile, isOrganizer, isOrganizerPending }
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
  status?: 'active' | 'paused' | 'ended' | 'draft'
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
    mutationFn: (input: Partial<Omit<OpenMicFormInput, 'handle'>>) => api<OpenMicDetail>(`/open-mics/${openMicId}`, {
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

export function useDeleteOpenMic(openMicId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>(`/open-mics/${openMicId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizer', 'open-mics'] })
      queryClient.removeQueries({ queryKey: organizerKeys.openMic(openMicId) })
    },
  })
}

// Kiosk backup PIN: per-series (not per-device), so it works from any device running this
// series' kiosk. The API only ever stores/compares a client-hashed PIN (SHA-256, hex) — see
// hashKioskPin below and docs/decisions.md.
export async function hashKioskPin(pin: string): Promise<string> {
  const bytes = new TextEncoder().encode(pin)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function useKioskBackupPinStatus(openMicId: string | undefined) {
  return useQuery({
    queryKey: [...organizerKeys.openMic(openMicId), 'kiosk-backup-pin'],
    queryFn: () => api<{ configured: boolean }>(`/open-mics/${openMicId}/kiosk-backup-pin`),
    enabled: Boolean(openMicId),
    retry: false,
  })
}

export function useSetKioskBackupPin(openMicId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pinHash: string) => api<{ configured: boolean }>(`/open-mics/${openMicId}/kiosk-backup-pin`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin_hash: pinHash }),
    }),
    onSuccess: (result) => queryClient.setQueryData([...organizerKeys.openMic(openMicId), 'kiosk-backup-pin'], result),
  })
}

export function useVerifyKioskBackupPin(openMicId: string | undefined) {
  return useMutation({
    mutationFn: (pinHash: string) => api<{ valid: boolean }>(`/open-mics/${openMicId}/kiosk-backup-pin/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin_hash: pinHash }),
    }),
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
  registrations_closed_at?: string | null
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

export function useDeleteEvent(openMicId: string | undefined, eventId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>(`/events/${eventId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...organizerKeys.openMics(openMicId), 'events'] })
      queryClient.removeQueries({ queryKey: [...organizerKeys.openMics(openMicId), 'event', eventId] })
    },
  })
}

// Registration closure is event-level state. Clearing registrations_closed_at reopens
// registration without changing any existing registration or performance rows.
export function useSetRegistrationsClosed(openMicId: string | undefined, eventId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (closed: boolean) => api<EventDetail>(`/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrations_closed_at: closed ? new Date().toISOString() : null }),
    }),
    onSuccess: (updated) => queryClient.setQueryData([...organizerKeys.openMics(openMicId), 'event', eventId], updated),
  })
}

// Dedicated start/stop/restart control (Milestone 2 roster redesign). Setting running: false
// (having been true or unset) makes the server auto-mark every still-"registered" performance
// as no_show in the same transaction; setting it back to true never reverses that. See
// docs/decisions.md "Milestone 2 event lifecycle" for the full rule.
export function useSetEventRunning(openMicId: string | undefined, eventId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (running: boolean) => api<EventDetail>(`/events/${eventId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ running }),
    }),
    onMutate: () => {
      if (!eventId) return
      markSelfCausedChange(`roster:${eventId}`)
      markSelfCausedChange(`event:${eventId}`)
    },
    onSuccess: (updated) => {
      queryClient.setQueryData([...organizerKeys.openMics(openMicId), 'event', eventId], updated)
      // Unlike the other roster mutations, this genuinely needs a refetch: the server's bulk
      // no_show side effect touches rows this response doesn't include.
      queryClient.invalidateQueries({ queryKey: rosterKey(eventId) })
    },
  })
}

// --- Event roster (Milestone 2: organizer event operations) ---

// Lifecycle: registered -> present (checked in at the door) -> scheduled (agreed to go next) ->
// performing (on stage) -> performed. no_show/cancelled are manual overrides from any state. Each
// Performance row is its own card; a performer doing another set gets a brand-new Performance row
// (only startable from an existing Performed card) rather than looping this one back.
export type PerformanceStatus =
  | 'registered'
  | 'present'
  | 'scheduled'
  | 'performing'
  | 'performed'
  | 'no_show'
  | 'cancelled'

export type Performance = {
  id: string
  registration_id: string
  name: string
  activity: string | null
  sequence: number
  status: PerformanceStatus
  checked_in_at: string | null
  scheduled_at: string | null
  started_at: string | null
  finished_at: string | null
  notes?: string | null
}

// The board columns, in order, for the "forward" happy-path lifecycle. no_show/cancelled are
// handled separately (as manual overrides available from any of these states), not as columns.
export const PERFORMANCE_BOARD_STATUSES: PerformanceStatus[] = [
  'registered',
  'present',
  'scheduled',
  'performing',
  'performed',
]

export const PERFORMANCE_STATUS_LABELS: Record<PerformanceStatus, string> = {
  registered: 'Registered',
  present: 'Present',
  scheduled: 'Scheduled',
  performing: 'Performing',
  performed: 'Performed',
  no_show: 'No-show',
  cancelled: 'Cancelled',
}

// The single primary action available from each forward status, and the status it transitions to.
// Returns null once a performance has reached a terminal or manually-overridden state.
export function nextPerformanceAction(
  status: PerformanceStatus,
): { label: string; nextStatus: PerformanceStatus } | null {
  switch (status) {
    case 'registered':
      return { label: 'Check in', nextStatus: 'present' }
    case 'present':
      return { label: 'Schedule', nextStatus: 'scheduled' }
    case 'scheduled':
      return { label: 'Start', nextStatus: 'performing' }
    case 'performing':
      return { label: 'Finish', nextStatus: 'performed' }
    default:
      return null
  }
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

// Every roster mutation already returns the exact row it just changed, so there is no need to ever
// re-GET the roster for a change this tab itself made — the mutations below patch the cached
// roster array directly from the mutation response instead of invalidating. A GET is still needed
// when *someone else* (another organizer, the kiosk, another tab) changes something: that arrives
// as a roster SSE notification and triggers a real refetch there. The one exception is
// useSetEventRunning, whose server-side effect (bulk-marking unregistered performers as no_show)
// touches rows the mutation response doesn't include, so it still refetches.
//
// The one wrinkle: Postgres NOTIFY is broadcast to every listener, including the tab that made the
// change, so this tab's own SSE connection will also receive a notification for its own edit a
// moment later. Without help, that would still cause a redundant GET. So each mutation marks its
// target key as "self-caused" in `onMutate` (before the request round-trip, since the NOTIFY can
// race ahead of the HTTP response), and the SSE handler consumes (one-shot) that mark instead of
// invalidating when it sees the matching event — leaving genuinely-external changes to refetch as
// normal.
const selfCausedInvalidateUntil = new Map<string, number>()
const SELF_CAUSED_SUPPRESS_MS = 5000

function markSelfCausedChange(key: string) {
  selfCausedInvalidateUntil.set(key, Date.now() + SELF_CAUSED_SUPPRESS_MS)
}

function consumeSelfCausedChange(key: string): boolean {
  const expiry = selfCausedInvalidateUntil.get(key)
  if (expiry === undefined) return false
  selfCausedInvalidateUntil.delete(key)
  return Date.now() < expiry
}

// Cache-only helpers used by the mutations below to fold a mutation's own response into the
// already-loaded roster array, without ever refetching it.
function upsertPerformanceInCache(queryClient: QueryClient, eventId: string | undefined, performance: Performance) {
  if (!eventId) return
  queryClient.setQueryData<RosterRegistration[]>(rosterKey(eventId), (registrations) => registrations?.map((registration) => {
    if (registration.id !== performance.registration_id) return registration
    const index = registration.performances.findIndex((existing) => existing.id === performance.id)
    const performances = index === -1
      ? [...registration.performances, performance]
      : registration.performances.map((existing, i) => (i === index ? performance : existing))
    return { ...registration, performances }
  }))
}

function removePerformanceFromCache(queryClient: QueryClient, eventId: string | undefined, performanceId: string) {
  if (!eventId) return
  queryClient.setQueryData<RosterRegistration[]>(rosterKey(eventId), (registrations) => registrations?.map((registration) => (
    registration.performances.some((performance) => performance.id === performanceId)
      ? { ...registration, performances: registration.performances.filter((performance) => performance.id !== performanceId) }
      : registration
  )))
}

function patchRegistrationInCache(queryClient: QueryClient, eventId: string | undefined, updated: RosterRegistration) {
  if (!eventId) return
  queryClient.setQueryData<RosterRegistration[]>(rosterKey(eventId), (registrations) => registrations?.map((registration) => (
    // The PATCH response has no `performances` field, so keep whatever's already cached for it.
    registration.id === updated.id ? { ...registration, ...updated, performances: registration.performances } : registration
  )))
}

function removeRegistrationFromCache(queryClient: QueryClient, eventId: string | undefined, registrationId: string) {
  if (!eventId) return
  queryClient.setQueryData<RosterRegistration[]>(rosterKey(eventId), (registrations) => registrations?.filter((registration) => registration.id !== registrationId))
}

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
    onMutate: () => { if (eventId) markSelfCausedChange(`roster:${eventId}`) },
    onSuccess: (created) => upsertPerformanceInCache(queryClient, eventId, created),
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
    onMutate: () => { if (eventId) markSelfCausedChange(`roster:${eventId}`) },
    onSuccess: (updated) => upsertPerformanceInCache(queryClient, eventId, updated),
  })
}

// Fields an organizer is allowed to edit on someone else's registration (mirrors the server's
// updateRegistrationSchema in apps/api/src/registrations/validation.ts).
export type RegistrationEditInput = {
  performer_name?: string
  performer_city?: string
  contact_email?: string
  contact_phone?: string
  song_names?: string[]
  media_consent?: boolean
}

export function useUpdateRegistration(eventId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: RegistrationEditInput & { id: string }) => api<RosterRegistration>(`/registrations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
    onMutate: () => { if (eventId) markSelfCausedChange(`roster:${eventId}`) },
    onSuccess: (updated) => patchRegistrationInCache(queryClient, eventId, updated),
  })
}

// Organizer-only "Delete" roster action — soft-deletes the registration entirely (server enforces
// a 30-day recovery window, same as events/performances). Only offered from the Registered column.
export function useDeleteRegistration(eventId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/registrations/${id}`, { method: 'DELETE' }),
    onMutate: () => { if (eventId) markSelfCausedChange(`roster:${eventId}`) },
    onSuccess: (_data, id) => removeRegistrationFromCache(queryClient, eventId, id),
  })
}

// A card is a registration+performance pair — see performances DELETE route (server-side): deleting
// a registration's only remaining performance also soft-deletes the registration itself, since
// there'd be nothing left to show and the performer would need to register again for a future set.
// Any other performance means this was just "delete this one set" and the registration stays.
export function useDeletePerformance(eventId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/performances/${id}`, { method: 'DELETE' }),
    onMutate: () => { if (eventId) markSelfCausedChange(`roster:${eventId}`) },
    onSuccess: (_data, id) => {
      const registrations = queryClient.getQueryData<RosterRegistration[]>(rosterKey(eventId))
      const owner = registrations?.find((registration) => registration.performances.some((performance) => performance.id === id))
      if (owner && owner.performances.length === 1) removeRegistrationFromCache(queryClient, eventId, owner.id)
      else removePerformanceFromCache(queryClient, eventId, id)
    },
  })
}

const ROSTER_STREAM_EVENTS = [
  'registration.created',
  'registration.updated',
  'registration.deleted',
  'performance.created',
  'performance.updated',
  'performance.deleted',
  'performance.reordered',
] as const

// A stopped/restarted event doesn't touch any registration/performance row directly, so it needs
// its own notification name and its own query invalidation (the EventDetail query, where
// `running` lives, not just the roster query).
const EVENT_STREAM_EVENTS = ['event.updated'] as const

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
export function useRosterLiveUpdates(openMicId: string | undefined, eventId: string | undefined, enabled: boolean): RosterStreamStatus {
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
        const invalidateRoster = () => void queryClient.invalidateQueries({ queryKey: rosterKey(eventId) })
        // Registration/performance events that this same tab just caused are already reflected by
        // the mutation's own onSuccess invalidate; skip the redundant second fetch for those, but
        // always refetch unconditionally for resync/reconnect paths, since those exist precisely to
        // catch up on changes this tab might not know about yet.
        const refetchRoster = () => {
          if (consumeSelfCausedChange(`roster:${eventId}`)) return
          invalidateRoster()
        }
        const refetchEvent = () => {
          refetchRoster()
          if (openMicId) {
            const eventKey = [...organizerKeys.openMics(openMicId), 'event', eventId]
            if (consumeSelfCausedChange(`event:${eventId}`)) return
            void queryClient.invalidateQueries({ queryKey: eventKey })
          }
        }
        source.addEventListener('resync_required', invalidateRoster)
        for (const eventName of ROSTER_STREAM_EVENTS) source.addEventListener(eventName, refetchRoster)
        for (const eventName of EVENT_STREAM_EVENTS) source.addEventListener(eventName, refetchEvent)
        source.onerror = () => {
          source?.close()
          if (hasConnectedOnce) invalidateRoster() // a dropped connection may have missed events; catch up once, then resume live-tailing
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
  }, [openMicId, eventId, enabled, queryClient])

  return status
}

// --- Kiosk registration (Milestone 2: organizer-supervised, on-the-night sign-up) ---

export type KioskRegistrationInput = {
  performer_name: string
  performer_city?: string
  contact_email?: string
  contact_phone?: string
  song_names?: string[]
  bio?: string
  media_consent?: boolean
  reminders_opt_in?: boolean
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
