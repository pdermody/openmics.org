import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from '@tanstack/react-router'
import { friendlyApiErrorMessage } from '../api/client'
import { DiscoveryControls } from '../components/location/DiscoveryControls'
import { useDiscovery } from '../features/discovery'
import type { DiscoverySearch } from '../features/discoverySearch'
import { useDiscoveryEvents, useDiscoveryOpenMics } from '../features/publicReads'
import { EventCard, SeriesCard } from './public-cards'
import { ReadState, SiteHeader, type ThemeProps } from './shared'

export function DiscoveryPage({ theme, mode, tab, page }: ThemeProps & DiscoverySearch) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const discovery = useDiscovery()
  const series = useDiscoveryOpenMics(page, discovery.near, discovery.ready && tab === 'open-mics')
  const events = useDiscoveryEvents(page, discovery.near, discovery.ready && tab === 'events')
  const selected = tab === 'events' ? events : series
  const pagination = selected.data?.pagination
  const pageCount = pagination ? Math.ceil(pagination.total / pagination.page_size) : 0
  const pages = Array.from({ length: Math.min(5, pageCount) }, (_, index) =>
    Math.max(1, Math.min(page - 2, pageCount - 4)) + index)
  const emptyArea = { place: discovery.label || t('discoveryYourLocation'), distance: discovery.near?.radiusKm }

  return <main className="app" data-theme={theme} data-mode={mode}>
    <SiteHeader />
    <section className="dashboard-page">
      <Link className="back-link" to="/">{t('backToDiscovery')}</Link>
      <h1>{t('openMicDiscovery')}</h1>
      <DiscoveryControls discovery={{
        ...discovery,
        chooseCity: (city, approximate) => { discovery.chooseCity(city, approximate); void navigate({ to: '/discover', search: { tab, page: 1 }, replace: true }) },
        expand: (radius) => { discovery.expand(radius); void navigate({ to: '/discover', search: { tab, page: 1 }, replace: true }) },
        nearMe: () => { discovery.nearMe(); void navigate({ to: '/discover', search: { tab, page: 1 }, replace: true }) },
      }} />
      <nav className="discovery-tabs" aria-label={t('discoveryResultTypes')}>
        <Link to="/discover" search={{ tab: 'open-mics', page: 1 }} aria-current={tab === 'open-mics' ? 'page' : undefined}>{t('discoverySeriesTab')}</Link>
        <Link to="/discover" search={{ tab: 'events', page: 1 }} aria-current={tab === 'events' ? 'page' : undefined}>{t('discoveryEventsTab')}</Link>
      </nav>
      <section className="content-grid" aria-label={t(tab === 'events' ? 'discoveryEventsTab' : 'discoverySeriesTab')}>
        {selected.isPending && <ReadState message={t('loading')} />}
        {selected.isError && <ReadState message={friendlyApiErrorMessage(selected.error, t('discoveryResultsError'))} retry={() => void selected.refetch()} />}
        {selected.isSuccess && selected.data.items.length === 0 && <ReadState message={pagination?.total
          ? t('discoveryPageEmpty')
          : discovery.near ? t(tab === 'events' ? 'discoveryNoEvents' : 'discoveryNoSeries', emptyArea)
            : t(tab === 'events' ? 'discoveryNoGeneralEvents' : 'discoveryNoGeneralSeries')} />}
        {tab === 'events' ? events.data?.items.map((event) => <EventCard event={event} key={event.id} />)
          : series.data?.items.map((openMic) => <SeriesCard openMic={openMic} key={openMic.id} />)}
      </section>
      {pagination && <p role="status">{t('discoveryTotal', { count: pagination.total })}</p>}
      {(pageCount > 1 || page > 1) && <nav className="discovery-pagination" aria-label={t('discoveryPagination')}>
        {page > 1 && <Link to="/discover" search={{ tab, page: Math.min(page - 1, Math.max(pageCount, 1)) }}>{t('discoveryPrevious')}</Link>}
        {pages[0] > 1 && <Link to="/discover" search={{ tab, page: 1 }}>1</Link>}
        {pages.map((number) => <Link key={number} to="/discover" search={{ tab, page: number }} aria-current={number === page ? 'page' : undefined} aria-label={t('discoveryPageNumber', { number })}>{number}</Link>)}
        {pages[pages.length - 1] < pageCount && <Link to="/discover" search={{ tab, page: pageCount }}>{pageCount}</Link>}
        {page < pageCount && <Link to="/discover" search={{ tab, page: page + 1 }}>{t('discoveryNext')}</Link>}
      </nav>}
    </section>
  </main>
}
