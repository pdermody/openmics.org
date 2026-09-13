import { friendlyApiErrorMessage } from '../api/client'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import { useAccountContext } from '../features/account'
import { getCityCoordinates, usePublicOpenMics, useUpcomingEvents } from '../features/publicReads'
import type { ThemeProps } from './shared'
import { ReadState, SiteHeader } from './shared'
import { EventCard, SeriesCard } from './public-cards'

export function HomePage({ theme, mode }: ThemeProps) {
  const { t } = useTranslation()
  const accountContext = useAccountContext()
  const near = getCityCoordinates(accountContext.account.data?.city)
  const upcomingEvents = useUpcomingEvents(6, near)
  const openMics = usePublicOpenMics(6, near)

  return (
    <main className="app" data-theme={theme} data-mode={mode}>
      <SiteHeader />

      <section className="review-hero" id="discover">
        <div className="eyebrow"><Sparkles size={14} /> {t('openMicDiscovery')}</div>
        <div className="hero-grid">
          <div>
            <p className="kicker">{t('homeKicker')}</p>
            <h1>{t('homeTitle')}</h1>
            <p className="hero-copy">{t('homeCopy')}</p>
          </div>
        </div>
      </section>

      <section className="content-grid" id="events">
        <div className="section-heading">
          <div><span className="panel-label">{t('thisWeek')}</span><h2>{near ? t('roomsNear', { city: accountContext.account.data?.city }) : t('roomsWorth')}</h2></div>
        </div>
        {upcomingEvents.isPending && <ReadState message="Finding upcoming rooms…" />}
        {upcomingEvents.isError && <ReadState message={friendlyApiErrorMessage(upcomingEvents.error, 'We could not load upcoming events. Please try again.')} retry={() => void upcomingEvents.refetch()} />}
        {upcomingEvents.isSuccess && upcomingEvents.data.length === 0 && <ReadState message={t('noUpcoming')} />}
        {upcomingEvents.data?.slice(0, 3).map((event) => <EventCard event={event} key={event.id} />)}

        <div className="section-heading series-heading">
          <div><span className="panel-label">{t('findYourRoom')}</span><h2>{near ? t('seriesNear', { city: accountContext.account.data?.city }) : t('seriesNearby')}</h2></div>
        </div>
        {openMics.isPending && <ReadState message="Finding open mic series…" />}
        {openMics.isError && <ReadState message={friendlyApiErrorMessage(openMics.error, 'We could not load open mic series. Please try again.')} retry={() => void openMics.refetch()} />}
        {openMics.isSuccess && openMics.data.length === 0 && <ReadState message={t('noSeries')} />}
        {openMics.data?.slice(0, 3).map((openMic) => <SeriesCard openMic={openMic} key={openMic.id} />)}
      </section>

    </main>
  )
}
