import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from '../api/client'
import { server } from './server'

describe('API client', () => {
  it('refreshes a stale token once and retries the original request', async () => {
    let requests = 0
    server.use(http.get('/api/events/demo', ({ request }) => {
      requests += 1
      if (request.headers.get('authorization') === 'Bearer fresh-token') {
        return HttpResponse.json({ id: 'demo' })
      }
      return HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Expired' } }, { status: 401 })
    }))

    const refreshAccessToken = vi.fn().mockResolvedValue('fresh-token')
    const client = createApiClient({
      getAccessToken: () => 'stale-token',
      refreshAccessToken,
      baseUrl: '/api',
    })

    await expect(client<{ id: string }>('/events/demo')).resolves.toEqual({ id: 'demo' })
    expect(requests).toBe(2)
    expect(refreshAccessToken).toHaveBeenCalledOnce()
  })

  it('does not retry when refresh returns the same token', async () => {
    server.use(http.get('/api/events/demo', () => HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Expired' } }, { status: 401 })))

    const client = createApiClient({
      getAccessToken: () => 'stale-token',
      refreshAccessToken: () => Promise.resolve('stale-token'),
      baseUrl: '/api',
    })

    await expect(client('/events/demo')).rejects.toBeInstanceOf(ApiError)
  })

  it('does not replay an unsafe request when refresh fails', async () => {
    let requests = 0
    server.use(http.post('/api/events/demo/registrations', () => {
      requests += 1
      return HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Expired' } }, { status: 401 })
    }))

    const refreshAccessToken = vi.fn().mockRejectedValue(new Error('Refresh failed'))
    const client = createApiClient({
      getAccessToken: () => 'stale-token',
      refreshAccessToken,
      baseUrl: '/api',
    })

    await expect(client('/events/demo/registrations', {
      method: 'POST',
      body: JSON.stringify({ performer_name: 'A performer' }),
    })).rejects.toBeInstanceOf(ApiError)
    expect(requests).toBe(1)
    expect(refreshAccessToken).toHaveBeenCalledOnce()
  })

  it('retries at most once when the refreshed token is also unauthorized', async () => {
    let requests = 0
    server.use(http.get('/api/events/demo', () => {
      requests += 1
      return HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Still expired' } }, { status: 401 })
    }))

    const refreshAccessToken = vi.fn().mockResolvedValue('fresh-token')
    const client = createApiClient({
      getAccessToken: () => 'stale-token',
      refreshAccessToken,
      baseUrl: '/api',
    })

    await expect(client('/events/demo')).rejects.toBeInstanceOf(ApiError)
    expect(requests).toBe(2)
    expect(refreshAccessToken).toHaveBeenCalledOnce()
  })
})