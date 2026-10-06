import { friendlyApiErrorMessage } from '../api/client'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { Sparkles } from 'lucide-react'
import { usePublicOpenMics, useUpcomingEvents } from '../features/publicReads'
import { useDiscovery } from '../features/discovery'
import { DiscoveryControls } from '../components/location/DiscoveryControls'
import { ClaimableRegistrationsBanner } from './ClaimableRegistrationsBanner'
import type { ThemeProps } from './shared'
import { ReadState, SiteHeader } from './shared'
import { EventCard, SeriesCard } from './public-cards'

export function HomePage({ theme, mode }: ThemeProps) {
  const { t } = useTranslation()
  const discovery = useDiscovery()
  const { near, ready, label } = discovery
  const upcomingEvents = useUpcomingEvents(3, near, ready)
  const openMics = usePublicOpenMics(3, near, ready)
  const roomsHeading = near ? label ? t('roomsNear', { city: label }) : t('roomsNearYou') : t('roomsWorth')
  const seriesHeading = near ? label ? t('seriesNear', { city: label }) : t('seriesNearYou') : t('seriesNearby')
  const emptyArea = { place: label || t('discoveryYourLocation'), distance: near?.radiusKm }

  return (
    <main className="app" data-theme={theme} data-mode={mode}>
      <SiteHeader />
      <div className="home-claimable-banner"><ClaimableRegistrationsBanner /></div>

      <section className="review-hero" id="discover">
        <div className="eyebrow"><Sparkles size={14} /> {t('openMicDiscovery')}</div>
        <div className="hero-grid">
          <div>
            <p className="kicker">{t('homeKicker')}</p>
            <h1>{t('homeTitle')}</h1>
            <p className="hero-copy">{t('homeCopy')}</p>
          </div>
        </div>
        <DiscoveryControls discovery={discovery} />
      </section>

      <section className="content-grid" id="events">
        <div className="section-heading">
          <div><span className="panel-label">{t('thisWeek')}</span><h2>{roomsHeading}</h2></div>
          <Link className="link-button" to="/discover" search={{ tab: 'events', page: 1 }}>{t('discoveryViewAllEvents')}</Link>
        </div>
        {upcomingEvents.isPending && <ReadState message={t('discoveryLoadingEvents')} />}
        {upcomingEvents.isError && <ReadState message={friendlyApiErrorMessage(upcomingEvents.error, 'We could not load upcoming events. Please try again.')} retry={() => void upcomingEvents.refetch()} />}
        {upcomingEvents.isSuccess && upcomingEvents.data.length === 0 && <ReadState message={near ? t('discoveryNoEvents', emptyArea) : t('discoveryNoGeneralEvents')} />}
        {upcomingEvents.data?.slice(0, 3).map((event) => <EventCard event={event} key={event.id} />)}

        <div className="section-heading series-heading">
          <div><span className="panel-label">{t('findYourRoom')}</span><h2>{seriesHeading}</h2></div>
          <Link className="link-button" to="/discover" search={{ tab: 'open-mics', page: 1 }}>{t('discoveryViewAllSeries')}</Link>
        </div>
        {openMics.isPending && <ReadState message={t('discoveryLoadingSeries')} />}
        {openMics.isError && <ReadState message={friendlyApiErrorMessage(openMics.error, 'We could not load open mic series. Please try again.')} retry={() => void openMics.refetch()} />}
        {openMics.isSuccess && openMics.data.length === 0 && <ReadState message={near ? t('discoveryNoSeries', emptyArea) : t('discoveryNoGeneralSeries')} />}
        {openMics.data?.slice(0, 3).map((openMic) => <SeriesCard openMic={openMic} key={openMic.id} />)}
      </section>

    </main>
  )
}
