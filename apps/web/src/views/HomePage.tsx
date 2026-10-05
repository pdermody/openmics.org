import { friendlyApiErrorMessage } from '../api/client'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { LocateFixed, Sparkles } from 'lucide-react'
import { useAccountContext } from '../features/account'
import { getCityCoordinates, usePublicOpenMics, useUpcomingEvents } from '../features/publicReads'
import { useBrowserLocation } from '../hooks/geolocation'
import { ClaimableRegistrationsBanner } from './ClaimableRegistrationsBanner'
import type { ThemeProps } from './shared'
import { ReadState, SiteHeader } from './shared'
import { EventCard, SeriesCard } from './public-cards'

export function HomePage({ theme, mode }: ThemeProps) {
  const { t } = useTranslation()
  const accountContext = useAccountContext()
  const browserLocation = useBrowserLocation()
  const savedCity = getCityCoordinates(accountContext.account.data?.city)
  const near = browserLocation.coords ?? savedCity
  const locationReady = browserLocation.permissionState !== 'unknown'
    && (browserLocation.permissionState !== 'granted' || Boolean(browserLocation.coords))
  const publicReadsEnabled = !accountContext.account.isPending && locationReady
  const upcomingEvents = useUpcomingEvents(6, near, publicReadsEnabled)
  const openMics = usePublicOpenMics(6, near, publicReadsEnabled)
  const showLocationOptIn = browserLocation.permissionState === 'prompt' || browserLocation.permissionState === 'unknown'
  const showAddCityHint = !near && !showLocationOptIn && Boolean(accountContext.account.data)
  const roomsHeading = browserLocation.coords ? t('roomsNearYou') : savedCity ? t('roomsNear', { city: accountContext.account.data?.city }) : t('roomsWorth')
  const seriesHeading = browserLocation.coords ? t('seriesNearYou') : savedCity ? t('seriesNear', { city: accountContext.account.data?.city }) : t('seriesNearby')

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
        {showLocationOptIn && (
          <button type="button" className="quiet-button location-button" onClick={browserLocation.requestLocation}>
            <LocateFixed size={16} />
            {t('useMyLocation')}
          </button>
        )}
        {showAddCityHint && <p className="field-hint"><Link to="/account">{t('addCityHint')}</Link></p>}
      </section>

      <section className="content-grid" id="events">
        <div className="section-heading">
          <div><span className="panel-label">{t('thisWeek')}</span><h2>{roomsHeading}</h2></div>
        </div>
        {upcomingEvents.isPending && <ReadState message="Finding upcoming rooms…" />}
        {upcomingEvents.isError && <ReadState message={friendlyApiErrorMessage(upcomingEvents.error, 'We could not load upcoming events. Please try again.')} retry={() => void upcomingEvents.refetch()} />}
        {upcomingEvents.isSuccess && upcomingEvents.data.length === 0 && <ReadState message={t('noUpcoming')} />}
        {upcomingEvents.data?.slice(0, 3).map((event) => <EventCard event={event} key={event.id} />)}

        <div className="section-heading series-heading">
          <div><span className="panel-label">{t('findYourRoom')}</span><h2>{seriesHeading}</h2></div>
        </div>
        {openMics.isPending && <ReadState message="Finding open mic series…" />}
        {openMics.isError && <ReadState message={friendlyApiErrorMessage(openMics.error, 'We could not load open mic series. Please try again.')} retry={() => void openMics.refetch()} />}
        {openMics.isSuccess && openMics.data.length === 0 && <ReadState message={t('noSeries')} />}
        {openMics.data?.slice(0, 3).map((openMic) => <SeriesCard openMic={openMic} key={openMic.id} />)}
      </section>

    </main>
  )
}
