const STORAGE_KEY = 'openmic_registered_event_ids'

/** Tracks event ids the current browser has registered for as a guest, so "already registered" status
 * survives across pages without needing an account. Authenticated performer-profile registrations are
 * tracked server-side instead (see features/myRegistrations.ts). */
export function getLocallyRegisteredEventIds(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

export function markEventRegisteredLocally(eventId: string) {
  if (typeof window === 'undefined') return
  const ids = getLocallyRegisteredEventIds()
  ids.add(eventId)
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]))
}
