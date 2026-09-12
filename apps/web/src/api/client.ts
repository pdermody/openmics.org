import { getAccessToken, refreshAccessToken } from '../auth/session'
import { i18n } from '../i18n'

export type ApiErrorPayload = {
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.error.message)
    this.name = 'ApiError'
    this.status = status
    this.code = payload.error.code
    this.details = payload.error.details
  }
}

export function friendlyApiErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!(error instanceof ApiError)) return fallback
  switch (error.code) {
    case 'NOT_FOUND':
      return 'We could not find that page or event. It may have been removed or is no longer public.'
    case 'UNAUTHORIZED':
      return 'Please sign in to continue.'
    case 'FORBIDDEN':
      return 'You do not have permission to view or change this.'
    case 'REGISTRATIONS_CLOSED':
      return 'Registration is closed for this event.'
    case 'CAPACITY_EXCEEDED':
      return 'This event is full. Please check back in case a place opens up.'
    case 'DUPLICATE_REGISTRATION':
      return 'This email already has a registration for this event.'
    case 'GONE':
      return 'This page is no longer available.'
    case 'VALIDATION_ERROR':
      return 'Some details need attention before we can continue.'
    default:
      return error.message || fallback
  }
}

export type ApiClientOptions = {
  baseUrl?: string
  getAccessToken?: () => Promise<string | undefined> | string | undefined
  refreshAccessToken?: () => Promise<string | undefined>
  locale?: () => string
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '/api'

  async function send(path: string, init: RequestInit, token: string | undefined) {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    headers.set('Accept-Language', options.locale?.() ?? i18n.language ?? navigator.language ?? 'en')
    if (token) headers.set('Authorization', `Bearer ${token}`)

    const response = await fetch(`${baseUrl}${path}`, { ...init, headers })
    const body = await response.json().catch(() => undefined)
    return { response, body }
  }

  return async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await options.getAccessToken?.()
    let { response, body } = await send(path, init, token)

    // One-shot 401 retry: force a fresh token and replay the exact same request once. A failed
    // or unavailable refresh (no new token) must not replay the request — especially for unsafe
    // methods (POST/PATCH/DELETE) — so it just falls through to the original 401 error below.
    if (response.status === 401 && options.refreshAccessToken) {
      const refreshedToken = await options.refreshAccessToken().catch(() => undefined)
      if (refreshedToken && refreshedToken !== token) {
        ({ response, body } = await send(path, init, refreshedToken))
      }
    }

    if (!response.ok) {
      const payload = body as ApiErrorPayload | undefined
      if (payload?.error) throw new ApiError(response.status, payload)
      throw new Error(`Request failed with status ${response.status}`)
    }
    return body as T
  }
}

export const api = createApiClient({ getAccessToken, refreshAccessToken })

// EventSource (used for the roster SSE stream) needs a full URL string, not the wrapped
// fetch-based `api()` client, so the same base-URL resolution is exposed separately here.
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? '/api'
