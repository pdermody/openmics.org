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
})