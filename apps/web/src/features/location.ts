import { useRef, useState } from 'react'
import { z } from 'zod'
import { api, ApiError } from '../api/client'

export type GeocodeCandidate = { label: string; lat: number; lng: number }

/**
 * Shared address + coordinate validation, reused by every form that collects a venue
 * location (OpenMic series, Events, and future forms). Mirrors the backend's DB check
 * constraint and OpenAPI bounds: lat/lng must both be present or both absent, and must
 * fall within valid coordinate ranges.
 */
export const baseLocationFieldsSchema = z.object({
  address_line1: z.string().trim().min(1, 'Address is required'),
  address_line2: z.string().trim().optional(),
  postcode: z.string().trim().optional(),
  city: z.string().trim().min(1, 'City is required'),
  city_id: z.string().nullable().optional(),
  venue_pin_confirmed: z.boolean().optional(),
  country: z
    .string()
    .trim()
    .length(2, 'Use a two-letter country code, e.g. IE')
    .transform((value) => value.toUpperCase()),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
})

export const locationFieldsSchema = baseLocationFieldsSchema.refine(
  (value) => (value.lat === undefined) === (value.lng === undefined),
  { message: 'Latitude and longitude must be set together', path: ['lng'] },
)

/** Variant used where lat/lng are mandatory (e.g. an event's location override). */
export const requiredLocationFieldsSchema = baseLocationFieldsSchema.extend({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})

export type GeocodingReporterEvent =
  | { type: 'rate_limited'; message: string; context?: unknown }
  | { type: 'error'; message: string; context?: unknown }

export type GeocodingReporter = (event: GeocodingReporterEvent) => void

let reporter: GeocodingReporter = (event) => {
  // eslint-disable-next-line no-console
  console.warn(`[geocoding] ${event.type}: ${event.message}`, event.context)
}

/** Swap in a real telemetry sink later (e.g. POST to a server endpoint) without touching call sites. */
export function setGeocodingReporter(next: GeocodingReporter): void {
  reporter = next
}

export function reportGeocodingEvent(event: GeocodingReporterEvent): void {
  reporter(event)
}

export type UseGeocodingResult = {
  candidates: GeocodeCandidate[]
  searching: boolean
  /** Once true (provider/proxy rate-limited us), assist stays off for the rest of the session;
   *  the map/marker and manual lat/lng entry remain fully usable regardless. */
  assistDisabled: boolean
  search: (query: string) => void
  clearCandidates: () => void
  reverseGeocode: (lat: number, lng: number) => Promise<GeocodeCandidate | null>
}

/**
 * Explicit address -> candidate coordinates lookup, backed by the server-side `/geocoding`
 * proxy (never calls the geocoding provider directly from the browser). `search` is only
 * ever called when the user takes an explicit action (clicking "Find on map" or pressing
 * Enter in the search box) — never on every keystroke or on unrelated form-field changes —
 * to keep LocationIQ request volume proportional to deliberate lookups.
 */
export function useGeocoding(): UseGeocodingResult {
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [assistDisabled, setAssistDisabled] = useState(false)
  const requestIdRef = useRef(0)

  function handleFailure(error: unknown, context: unknown, message: string) {
    if (error instanceof ApiError && error.code === 'GEOCODING_RATE_LIMITED') {
      setAssistDisabled(true)
      reportGeocodingEvent({ type: 'rate_limited', message: `${message} Assist disabled for this session.`, context })
    } else if (error instanceof ApiError && error.code === 'GEOCODING_UNAVAILABLE') {
      // No provider configured, or the provider itself is down — same graceful fallback as
      // rate-limiting: turn off assist and surface the "manual entry" notice instead of
      // failing silently.
      setAssistDisabled(true)
      reportGeocodingEvent({ type: 'error', message: `${message} Assist disabled for this session.`, context })
    } else {
      reportGeocodingEvent({ type: 'error', message, context: { ...(context as object), error } })
    }
  }

  function search(query: string) {
    const trimmed = query.trim()
    if (assistDisabled || trimmed.length < 3 || searching) {
      if (!searching) setCandidates([])
      return
    }
    const requestId = ++requestIdRef.current
    setSearching(true)
    void api<{ candidates: GeocodeCandidate[] }>(`/geocoding/search?q=${encodeURIComponent(trimmed)}`)
      .then((result) => {
        if (requestIdRef.current !== requestId) return
        setCandidates(result.candidates)
      })
      .catch((error: unknown) => {
        if (requestIdRef.current !== requestId) return
        setCandidates([])
        handleFailure(error, { query: trimmed }, 'Geocoding search failed.')
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setSearching(false)
      })
  }

  async function reverseGeocode(lat: number, lng: number): Promise<GeocodeCandidate | null> {
    if (assistDisabled) return null
    try {
      const result = await api<{ candidate: GeocodeCandidate | null }>(`/geocoding/reverse?lat=${lat}&lng=${lng}`)
      return result.candidate
    } catch (error) {
      handleFailure(error, { lat, lng }, 'Reverse geocoding failed.')
      return null
    }
  }

  return { candidates, searching, assistDisabled, search, clearCandidates: () => setCandidates([]), reverseGeocode }
}
