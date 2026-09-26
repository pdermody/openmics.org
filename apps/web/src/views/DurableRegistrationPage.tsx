import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { friendlyApiErrorMessage } from '../api/client'
import { useNextEvent } from '../features/publicReads'
import type { ThemeProps } from './shared'
import { ReadState, SiteHeader } from './shared'

export function DurableRegistrationPage({ openMicId, theme, mode }: { openMicId: string } & ThemeProps) {
  const { t } = useTranslation()
  const nextEvent = useNextEvent(openMicId)
  const currentEvent = nextEvent.data?.current_event
  const currentRegistrationOpen = nextEvent.data?.current_registration_open ?? false
  const nextEventInSeries = nextEvent.data?.next_event
  const futureEvent = nextEvent.data?.next_registration_event
  const nextRegistrationOpen = Boolean(nextEventInSeries && futureEvent?.id === nextEventInSeries.id)

  return <main className="app" data-theme={theme} data-mode={mode}>
    <SiteHeader />
    <section className="registration-page">
      {nextEvent.isPending && <ReadState message={t('loading')} />}
      {nextEvent.isError && <ReadState message={friendlyApiErrorMessage(nextEvent.error, t('noUpcoming'))} retry={() => void nextEvent.refetch()} />}
      {currentEvent && currentRegistrationOpen && <section className="registration-event-summary">
        <h1>{t('durableCurrentEventTitle')}</h1>
        <p>{t('durableCurrentEventMessage', { title: currentEvent.title })}</p>
        <Link className="primary-button" to="/events/$eventId/register" params={{ eventId: currentEvent.id }}>{t('registerForThisEvent')}</Link>
      </section>}
      {currentEvent && !currentRegistrationOpen && <section className="registration-event-summary">
        <h1>{t('durableCurrentClosedTitle')}</h1>
        <p>{t('durableCurrentClosedMessage', { title: currentEvent.title })}</p>
        {futureEvent && <Link className="primary-button" to="/events/$eventId/register" params={{ eventId: futureEvent.id }}>{t('durableFutureEventAction', { title: futureEvent.title })}</Link>}
      </section>}
      {!currentEvent && nextEventInSeries && <section className="registration-event-summary">
        <h1>{t(nextRegistrationOpen ? 'durableFutureEventTitle' : 'durableNextClosedTitle')}</h1>
        <p>{t(nextRegistrationOpen ? 'durableFutureEventMessage' : 'durableNextClosedMessage', { title: nextEventInSeries.title })}</p>
        {futureEvent && <Link className="primary-button" to="/events/$eventId/register" params={{ eventId: futureEvent.id }}>{t('durableFutureEventAction', { title: futureEvent.title })}</Link>}
      </section>}
      {nextEvent.data && !currentEvent && !nextEventInSeries && <ReadState message={t('noUpcoming')} />}
    </section>
  </main>
}