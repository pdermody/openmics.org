import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { friendlyApiErrorMessage } from '../api/client'
import { useNextEvent } from '../features/publicReads'
import type { ThemeProps } from './shared'
import { ReadState, SiteHeader } from './shared'

export function DurableRegistrationPage({ openMicId, theme, mode }: { openMicId: string } & ThemeProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const nextEvent = useNextEvent(openMicId)

  useEffect(() => {
    if (nextEvent.data) void navigate({ to: '/events/$eventId/register', params: { eventId: nextEvent.data.id }, replace: true })
  }, [nextEvent.data, navigate])

  return <main className="app" data-theme={theme} data-mode={mode}>
    <SiteHeader />
    <section className="registration-page">
      {nextEvent.isPending && <ReadState message={t('loading')} />}
      {nextEvent.isError && <ReadState message={friendlyApiErrorMessage(nextEvent.error, t('noUpcoming'))} retry={() => void nextEvent.refetch()} />}
      {nextEvent.data && <ReadState message={t('loading')} />}
    </section>
  </main>
}