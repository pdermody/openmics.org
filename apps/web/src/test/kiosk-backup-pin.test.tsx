import { http, HttpResponse } from 'msw'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KioskBackupPinSection } from '../views/KioskBackupPin'
import { renderWithProviders } from './render'
import { server } from './server'

describe('KioskBackupPinSection', () => {
  it('reveals the saved PIN only on request and clears it when hidden or edited', async () => {
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    let revealRequests = 0
    server.use(
      http.get('/api/open-mics/series-1/kiosk-backup-pin', () => HttpResponse.json({ configured: true })),
      http.post('/api/open-mics/series-1/kiosk-backup-pin/reveal', () => {
        revealRequests += 1
        return HttpResponse.json({ pin: '2468' }, { headers: { 'Cache-Control': 'no-store' } })
      }),
    )

    renderWithProviders(<KioskBackupPinSection seriesId="series-1" />)
    const showButton = await screen.findByRole('button', { name: 'Show saved PIN' })
    expect(revealRequests).toBe(0)
    expect(screen.queryByText('2468')).not.toBeInTheDocument()

    fireEvent.click(showButton)
    expect(await screen.findByText('2468')).toBeInTheDocument()
    expect(revealRequests).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Change backup PIN' }))
    expect(screen.getByText('2468')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide saved PIN' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hide saved PIN' }))
    expect(screen.queryByText('2468')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show saved PIN' }))
    expect(await screen.findByText('2468')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('2468')).toBeInTheDocument()
  })

  it('shows a recoverable error without displaying a PIN when reveal fails', async () => {
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    server.use(
      http.get('/api/open-mics/series-1/kiosk-backup-pin', () => HttpResponse.json({ configured: true })),
      http.post('/api/open-mics/series-1/kiosk-backup-pin/reveal', () => HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, { status: 500 })),
    )

    renderWithProviders(<KioskBackupPinSection seriesId="series-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show saved PIN' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reveal the backup PIN. Please try again.')
    expect(screen.queryByText('2468')).not.toBeInTheDocument()
  })

  it('clears the old revealed PIN after a replacement is saved', async () => {
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    server.use(
      http.get('/api/open-mics/series-1/kiosk-backup-pin', () => HttpResponse.json({ configured: true })),
      http.post('/api/open-mics/series-1/kiosk-backup-pin/reveal', () => HttpResponse.json({ pin: '2468' }, { headers: { 'Cache-Control': 'no-store' } })),
      http.put('/api/open-mics/series-1/kiosk-backup-pin', () => HttpResponse.json({ configured: true })),
    )

    renderWithProviders(<KioskBackupPinSection seriesId="series-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show saved PIN' }))
    expect(await screen.findByText('2468')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Change backup PIN' }))

    const pinInputs = Array.from(document.querySelectorAll<HTMLInputElement>('.kiosk-form input[type="password"]'))
    fireEvent.change(pinInputs[0], { target: { value: '1357' } })
    fireEvent.change(pinInputs[1], { target: { value: '1357' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save backup PIN' }))

    expect(await screen.findByText(/Backup PIN saved/)).toBeInTheDocument()
    expect(screen.queryByText('2468')).not.toBeInTheDocument()
  })

  it('shows or masks both PIN fields and submits the plaintext PIN', async () => {
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    let savedPayload: unknown
    server.use(
      http.get('/api/open-mics/series-1/kiosk-backup-pin', () => HttpResponse.json({ configured: false })),
      http.put('/api/open-mics/series-1/kiosk-backup-pin', async ({ request }) => {
        savedPayload = await request.json()
        return HttpResponse.json({ configured: true })
      }),
    )

    renderWithProviders(<KioskBackupPinSection seriesId="series-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Set backup PIN' }))

    const pinInputs = Array.from(document.querySelectorAll<HTMLInputElement>('.kiosk-form input[type="password"]'))
    expect(pinInputs).toHaveLength(2)
    expect(pinInputs[0]).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: 'Show Kiosk backup PIN' }))
    expect(pinInputs[0]).toHaveAttribute('type', 'text')
    expect(pinInputs[1]).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: 'Show Confirm backup PIN' }))
    expect(pinInputs[1]).toHaveAttribute('type', 'text')
    fireEvent.click(screen.getByRole('button', { name: 'Hide Kiosk backup PIN' }))
    expect(pinInputs[0]).toHaveAttribute('type', 'password')

    fireEvent.change(pinInputs[0], { target: { value: '2468' } })
    fireEvent.change(pinInputs[1], { target: { value: '2468' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save backup PIN' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Backup PIN saved')
    expect(savedPayload).toEqual({ pin: '2468' })
  })

  it('omits the required-fields note when embedded in the edit form', async () => {
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    server.use(http.get('/api/open-mics/series-1/kiosk-backup-pin', () => HttpResponse.json({ configured: false })))
    const { container } = renderWithProviders(<KioskBackupPinSection seriesId="series-1" embedded />)
    fireEvent.click(await screen.findByRole('button', { name: 'Set backup PIN' }))
    expect(container.querySelector('.kiosk-backup-pin-required-note')).not.toBeInTheDocument()
  })

  it('keeps the required-fields note in the view-series PIN form with space after the description', async () => {
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    server.use(http.get('/api/open-mics/series-1/kiosk-backup-pin', () => HttpResponse.json({ configured: false })))
    const { container } = renderWithProviders(<KioskBackupPinSection seriesId="series-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Set backup PIN' }))
    const description = container.querySelector('.kiosk-backup-pin-panel > .field-hint')
    const note = container.querySelector('.kiosk-backup-pin-required-note')
    expect(note).toBeInTheDocument()
    expect(description?.nextElementSibling).toBe(container.querySelector('.kiosk-backup-pin-actions'))
  })
})