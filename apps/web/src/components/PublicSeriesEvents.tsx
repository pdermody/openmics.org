import { useEffect, useRef } from 'react'
import { Link } from '@tanstack/react-router'
import { Clock3, MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePublicSeriesEvents, type PublicEventsFilters } from '../features/publicReads'
import { ReadState } from '../views/shared'

export function PublicSeriesEvents({ id, canCopyEvents = false, filters, onChange }: {
  id: string; canCopyEvents?: boolean; filters: PublicEventsFilters; onChange: (changes: Partial<PublicEventsFilters>, replace?: boolean) => void
}) {
  const { t, i18n } = useTranslation()
  const events = usePublicSeriesEvents(id, filters)
  const heading = useRef<HTMLHeadingElement>(null)
  const pages = Math.max(1, Math.ceil((events.data?.pagination.total ?? 0) / 10))
  useEffect(() => {
    if (events.isSuccess && filters.page > pages) onChange({ page: pages }, true)
  }, [events.isSuccess, filters.page, pages, onChange])
  const change = (changes: Partial<PublicEventsFilters>) => onChange({ ...changes, page: 1 })
  const page = (value: number) => {
    onChange({ page: value })
    heading.current?.focus({ preventScroll: true })
    heading.current?.scrollIntoView({ block: 'start' })
  }
  return <section className="public-series-events" aria-labelledby={`events-heading-${id}`}>
    <h2 id={`events-heading-${id}`} ref={heading} tabIndex={-1}>{t('browseEvents')}</h2>
    <div className="event-browse-controls">
      <div role="group" aria-label={t('browseEventPeriod')}>
        {(['upcoming', 'past'] as const).map((period) => <button key={period} className="filter-chip" type="button"
          aria-pressed={filters.period === period} onClick={() => change({ period })}>
          {t(period === 'upcoming' ? 'browseUpcoming' : 'browsePast')}
        </button>)}
      </div>
      <label>{t('browseYear')} <select value={filters.year ?? ''} onChange={(event) => change({ year: Number(event.target.value) || undefined, month: undefined })}>
        <option value="">{t('browseAllYears')}</option>
        {[...new Set([...(events.data?.available_years ?? []), ...(filters.year ? [filters.year] : [])])].sort((a, b) => b - a)
          .map((year) => <option key={year} value={year}>{year}</option>)}
      </select></label>
      <label>{t('browseMonth')} <select disabled={!filters.year} value={filters.month ?? ''} onChange={(event) => change({ month: Number(event.target.value) || undefined })}>
        <option value="">{t('browseAllMonths')}</option>
        {Array.from({ length: 12 }, (_, index) => <option key={index} value={index + 1}>
          {new Intl.DateTimeFormat(i18n.language, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2020, index, 1)))}
        </option>)}
      </select></label>
      {(filters.year || filters.month) && <button className="link-button" type="button" onClick={() => change({ year: undefined, month: undefined })}>{t('browseClearFilters')}</button>}
    </div>
    {events.isPending && <ReadState message={t('loading')} />}
    {events.isError && <ReadState message={t('browseEventsError')} retry={() => void events.refetch()} />}
    {events.isSuccess && events.data.items.length === 0 && <p role="status">{t(filters.year ? 'browseNoMatches' : filters.period === 'upcoming' ? 'browseNoUpcoming' : 'browseNoPast')}</p>}
    {events.data?.items.map((event) => <article className="dashboard-series-card public-event-card" key={event.id}>
      <div>
        {event.phase === 'running' && <strong className="panel-label">{t('browseHappeningNow')}</strong>}
        <h3><Link to="/events/$eventId" params={{ eventId: event.id }}>{event.title}</Link></h3>
        <p><Clock3 size={15} aria-hidden="true" /> <time dateTime={event.starts_at}>
          {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: event.time_zone }).format(new Date(event.starts_at))}
        </time></p>
        <span className="event-meta"><MapPin size={15} aria-hidden="true" /> {event.venue_name}, {event.city}</span>
      </div>
      {canCopyEvents && <Link className="quiet-button" to="/dashboard/series/$seriesId/events/new" params={{ seriesId: id }}
        aria-label={t('eventCopyActionLabel', { title: event.title })}
        search={{ sourceEventId: event.id, copySchedule: true }}>{t('eventCopyAction')}</Link>}
    </article>)}
    {events.isSuccess && events.data.pagination.total > 0 && <nav className="event-pagination" aria-label={t('browseEventPages')}>
      <button type="button" className="quiet-button" disabled={filters.page <= 1} onClick={() => page(filters.page - 1)}>{t('browsePrevious')}</button>
      <span role="status">{t('browsePageOf', { page: filters.page, pages })}</span>
      <button type="button" className="quiet-button" disabled={filters.page >= pages} onClick={() => page(filters.page + 1)}>{t('browseNext')}</button>
    </nav>}
  </section>
}
