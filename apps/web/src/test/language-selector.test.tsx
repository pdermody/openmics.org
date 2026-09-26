import { http, HttpResponse } from 'msw'
import { userEvent } from '@testing-library/user-event'
import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { LANGUAGE_STORAGE_KEY, i18n, resolveInitialLanguage } from '../i18n'
import { LanguageSelector } from '../views/shared'
import { renderWithProviders } from './render'
import { server } from './server'

afterEach(async () => {
  window.localStorage.clear()
  await act(async () => { await i18n.changeLanguage('en') })
  document.documentElement.lang = 'en'
})

describe('LanguageSelector', () => {
  it('resolves the browser language when no explicit language is persisted', () => {
    expect(resolveInitialLanguage(null, ['fr-FR', 'es-MX'])).toBe('es')
    expect(resolveInitialLanguage(null, ['de-DE'])).toBe('en')
    expect(resolveInitialLanguage('en', ['es-MX'])).toBe('en')
  })

  it('changes the UI language and persists it locally for anonymous visitors', async () => {
    const user = userEvent.setup()
    server.use(http.get('/api/me', () => HttpResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Not signed in' } }, { status: 401 })))
    renderWithProviders(<LanguageSelector />)

    await user.click(screen.getByRole('button', { name: 'Language' }))
    await user.click(screen.getByRole('menuitem', { name: 'Español' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Idioma' })).toHaveTextContent('Español'))
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('es')
    expect(document.documentElement.lang).toBe('es')
  })

  it('persists the selected language to the signed-in account', async () => {
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    let accountPatch: Record<string, unknown> | undefined
    server.use(
      http.get('/api/me', () => HttpResponse.json({
        id: 'account-1', email: 'organizer@example.test', display_name: 'Organizer', city: null,
        preferred_language: 'en', current_profile_id: null, is_platform_admin: false, plan: 'free',
      })),
      http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: [] })),
      http.patch('/api/accounts/account-1', async ({ request }) => {
        accountPatch = await request.json() as Record<string, unknown>
        return HttpResponse.json({ preferred_language: accountPatch.preferred_language })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<LanguageSelector />)

    await user.click(await screen.findByRole('button', { name: 'Language' }))
    await user.click(screen.getByRole('menuitem', { name: 'Español' }))

    await waitFor(() => expect(accountPatch).toEqual({ preferred_language: 'es' }))
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('es')
  })

  it('restores the signed-in account preference over local storage', async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en')
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    server.use(http.get('/api/me', () => HttpResponse.json({
      id: 'account-1', email: 'organizer@example.test', display_name: 'Organizer', city: null,
      preferred_language: 'es', current_profile_id: null, is_platform_admin: false, plan: 'free',
    })), http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: [] })))

    renderWithProviders(<LanguageSelector />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Idioma' })).toHaveTextContent('Español'))
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('es')
  })
})