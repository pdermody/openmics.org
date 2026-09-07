import { getAccessToken } from '../auth/session'

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
  locale?: () => string
}

export function createApiClient(options: ApiClientOptions = {}) {
  const baseUrl = options.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '/api'

  return async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    headers.set('Accept-Language', options.locale?.() ?? navigator.language ?? 'en')

    const token = await options.getAccessToken?.()
    if (token) headers.set('Authorization', `Bearer ${token}`)

    const response = await fetch(`${baseUrl}${path}`, { ...init, headers })
    const body = (await response.json().catch(() => undefined)) as T | ApiErrorPayload | undefined
    if (!response.ok) {
      const payload = body as ApiErrorPayload | undefined
      if (payload?.error) throw new ApiError(response.status, payload)
      throw new Error(`Request failed with status ${response.status}`)
    }
    return body as T
  }
}

export const api = createApiClient({ getAccessToken })
