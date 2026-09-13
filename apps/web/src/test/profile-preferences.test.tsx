import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ColorMode, ThemeId } from '../theme'
import { ThemePage } from '../views/ThemePage'
import { renderWithProviders } from './render'
import { server } from './server'

describe('profile preferences', () => {
  it('applies the active profile theme and color mode from the account response', async () => {
    window.localStorage.setItem('openmic-simulated-auth-token', 'organizer-token')
    server.use(
      http.get('/api/me', () => HttpResponse.json({
        id: 'account-1', email: 'organizer@example.test', display_name: 'Organizer', city: null,
        preferred_language: 'en', current_profile_id: 'profile-1', is_platform_admin: false, plan: 'free',
      })),
      http.get('/api/accounts/account-1/profiles', () => HttpResponse.json({ items: [{
        id: 'profile-1', profile_name: 'Organizer', profile_kind: 'organizer', current_handle: null,
        bio: null, phone: null, visibility: 'public', theme_name: 'civic', color_mode: 'dark',
      }] })),
      http.get('/api/me/permissions', () => HttpResponse.json({ permissions: ['profiles:manage'] })),
      http.get('/api/dev/simulated-auth/config', () => HttpResponse.json({ enabled: false, roles: [] })),
    )

    function ThemeHarness() {
      const [theme, setTheme] = useState<ThemeId>('venue')
      const [mode, setMode] = useState<ColorMode>('light')
      return <ThemePage theme={theme} mode={mode} setTheme={(nextTheme: ThemeId) => setTheme(nextTheme)} setMode={(nextMode: ColorMode) => setMode(nextMode)} />
    }

    renderWithProviders(<ThemeHarness />)

    await waitFor(() => expect(screen.getByRole('button', { name: /day set/i })).toHaveClass('selected'))
    expect(screen.getByRole('button', { name: 'Dark' })).toHaveClass('selected')
  })
})