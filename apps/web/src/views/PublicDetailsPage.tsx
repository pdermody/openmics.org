import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { ArrowUpRight, CalendarDays, ClipboardList, Mic2, Music2, Ticket, MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isRegistrationClosed, useNextEvent, usePublicEvent, usePublicOpenMic } from '../features/publicReads'
import { entryFee, eventTimeRange, isOpenMicsWebsite } from '../features/publicDetails'
import { PublicLocation } from '../components/location/PublicLocation'
import { AttendanceWarning } from '../components/AttendanceWarning'
import { friendlyApiErrorMessage } from '../api/client'
import { gallerySearchSchema } from '../features/gallerySearch'
import type { ThemeProps } from './shared'
import { ReadState, SiteHeader } from './shared'

export function PublicDetailsPage({ kind, id, expectedSeriesId, theme, mode }: {
  kind: 'event' | 'open-mic'; id: string; expectedSeriesId?: string
} & ThemeProps) {
  const { t, i18n } = useTranslation()
  const event = usePublicEvent(kind === 'event' ? id : undefined)
  const series = usePublicOpenMic(kind === 'open-mic' ? id : event.data?.open_mic_id)
  const next = useNextEvent(kind === 'open-mic' ? series.data?.id : undefined)
  const resource = kind === 'event' ? event.data : series.data
  const title = kind === 'event' ? event.data?.title : series.data?.name
  const location = useLocation()
  const navigate = useNavigate()
  const returnState = location.state.publicDetailsReturn
  const validReturn = resource && returnState?.resource === `${kind}:${resource.id}` ? returnState : undefined
  const search = gallerySearchSchema(Object.fromEntries(new URLSearchParams(validReturn?.search)))
  const backState = { restorePublicLanding: validReturn, detailGallerySeed: validReturn?.gallerySeed }
  const handle = series.data?.current_handle
  const mismatch = kind === 'event' && expectedSeriesId && event.data && event.data.open_mic_id !== expectedSeriesId
  const registrationOpen = event.data && event.data.phase !== 'past' && !isRegistrationClosed(event.data)
    && ['pre_only', 'both'].includes(series.data?.registration_mode ?? '')
  const nextEvent = next.data?.current_event ?? next.data?.next_event

  useEffect(() => {
    if (!title || !resource || mismatch) return
    document.title = `${t('moreDetails')} - ${title} | OpenMics.org`
    const target = document.getElementById(location.hash || 'public-details-title')
    target?.focus({ preventScroll: true })
    if (location.hash) target?.scrollIntoView({ behavior: 'instant' })
  }, [title, resource, mismatch, location.hash, t])

  useEffect(() => {
    if (!resource || !handle || mismatch || !location.pathname.endsWith('/details')) return
    if (kind === 'event') {
      const canonical = `/@${handle}/events/${resource.id}/details`
      if (location.pathname !== canonical) void navigate({ to: '/@{$handle}/events/$eventId/details', params: { handle, eventId: resource.id }, hash: location.hash, state: location.state, replace: true })
    } else if (location.pathname !== `/@${handle}/details`) {
      void navigate({ to: '/@{$handle}/details', params: { handle }, hash: location.hash, state: location.state, replace: true })
    }
  }, [resource, handle, kind, mismatch, location.pathname, location.hash, location.state, navigate])

  const pending = (kind === 'event' ? event.isPending : series.isPending) || (kind === 'event' && series.isPending)
  const error = kind === 'event' && event.isError ? event.error : series.error
  return <main className="app" data-theme={theme} data-mode={mode}>
    <SiteHeader />
    <section className="detail-page public-details-page">
      {kind === 'event' ? handle
        ? <Link className="back-link" to="/@{$handle}/events/$eventId" params={{ handle, eventId: resource?.id ?? id }} search={search} state={backState}>{t('backToEventLanding')}</Link>
        : <Link className="back-link" to="/events/$eventId" params={{ eventId: resource?.id ?? id }} search={search} state={backState}>{t('backToEventLanding')}</Link>
        : handle ? <Link className="back-link" to="/@{$handle}" params={{ handle }} search={search} state={backState}>{t('backToOpenMicLanding')}</Link>
          : <Link className="back-link" to="/open-mics/$openMicId" params={{ openMicId: resource?.id ?? id }} search={search} state={backState}>{t('backToOpenMicLanding')}</Link>}
      {pending && <ReadState message={t('loading')} />}
      {(error || mismatch) && <ReadState message={mismatch ? t('publicDetailsUnavailable') : friendlyApiErrorMessage(error, t('publicDetailsUnavailable'))} retry={mismatch ? undefined : () => { void event.refetch(); void series.refetch() }} />}
      {!pending && !error && !mismatch && resource && <>
        <header className="public-details-hero">
          <p className="public-details-kicker"><Mic2 size={18} aria-hidden="true" />{t('detailsNightAtGlance')}</p>
          <h1 id="public-details-title" tabIndex={-1} aria-label={`${t('moreDetails')} - ${title}`}><span className="public-details-title-label">{t('moreDetails')}</span>{title}</h1>
          <p className="public-details-venue"><MapPin size={18} aria-hidden="true" />{resource.venue_name} · {resource.city}</p>
        </header>
        <div className="public-details-layout">
        <div className="public-details-story">
        <section className="public-details-introduction" aria-labelledby="about"><h2 id="about" tabIndex={-1}>{t('detailsWhatToExpect')}</h2>
          {kind === 'open-mic' && series.data?.description && <p className="public-detail-text public-details-description">{series.data.description}</p>}
          {resource.public_information && <div className="public-details-note">
            <h3>{t(kind === 'event' ? 'eventInformation' : 'detailsVisitorInformation')}</h3>
            <p className="public-detail-text">{resource.public_information}</p>
          </div>}
          {!resource.public_information && !(kind === 'open-mic' && series.data?.description) && <p className="field-hint">{t('detailsNoIntroduction')}</p>}
        </section>
        <section className="public-details-group" aria-labelledby="details-vibe"><h2 id="details-vibe"><Music2 size={22} aria-hidden="true" />{t('detailsTheVibe')}</h2>
          <h3 className="public-details-small-label">{t('activities')}</h3>
          <div className="public-details-badges">{resource.activities?.length
            ? resource.activities.map((activity) => <span key={activity}>{t(`activity${activity.charAt(0).toUpperCase()}${activity.slice(1)}`)}</span>)
            : <p className="field-hint">{t('publicNotSpecified')}</p>}</div>
          {resource.tags.length > 0 && <><h3 className="public-details-small-label">{t('tags')}</h3><div className="public-details-badges">{resource.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></>}
        </section>
        <section className="public-details-group" aria-labelledby="details-stage"><h2 id="details-stage"><Mic2 size={22} aria-hidden="true" />{t('detailsTakingStage')}</h2>
          {event.data && <p className="public-details-small-label">{t('openMicPolicies')}</p>}
          <ul className="public-details-policies">
            <li>{series.data?.originals_only === undefined ? t('publicNotSpecified') : t(series.data.originals_only ? 'originalsOnly' : 'originalsAndCovers')}</li>
            <li>{series.data?.amplification_available === undefined ? t('publicNotSpecified') : t(series.data.amplification_available ? 'amplificationAvailable' : 'amplificationNotProvided')}</li>
            <li>{series.data?.age_policy ? t(`publicAge_${series.data.age_policy}`) : t('publicNotSpecified')}</li>
          </ul>
        </section>
        {event.data && series.data && <Link className="public-details-related" to="/open-mics/$openMicId" params={{ openMicId: series.data.current_handle ?? series.data.id }}>{series.data.name}<ArrowUpRight size={18} aria-hidden="true" /></Link>}
        </div>
        <aside className="public-details-visit" aria-labelledby="details-visit-title">
        <h2 id="details-visit-title" className="public-details-visit-title">{t('detailsBeforeYouGo')}</h2>
        <section className="public-details-visit-section"><h3><CalendarDays size={18} aria-hidden="true" />{t(kind === 'event' ? 'publicWhen' : 'publicSchedule')}</h3>
          {event.data ? <p>{eventTimeRange(event.data, i18n.language, t)}</p> : <>
            <p>{series.data?.schedule_summary || t('scheduleNotSpecified')}</p>
            {series.data?.schedule_details && <p className="public-detail-text">{series.data.schedule_details}</p>}
            {series.data?.time_zone && <p>{series.data.time_zone}</p>}
            {next.isError && <ReadState message={friendlyApiErrorMessage(next.error, t('publicDetailsUnavailable'))} retry={() => void next.refetch()} />}
            {nextEvent && <Link to="/events/$eventId" params={{ eventId: nextEvent.id }}>{nextEvent.title}</Link>}
          </>}
        </section>
        <section className="public-details-visit-section"><h3><Ticket size={18} aria-hidden="true" />{t('detailsEntry')}</h3><p className="public-details-fee">{entryFee(resource, i18n.language, t)}</p></section>
        <section className="public-details-visit-section"><h3><ClipboardList size={18} aria-hidden="true" />{t('publicRegistration')}</h3><p>{t(`publicRegistration_${series.data?.registration_mode}`)}</p>
          {series.data?.registration_mode === 'external' && series.data.external_registration_url && (!event.data || (event.data.phase !== 'past' && !isRegistrationClosed(event.data))) && <a href={series.data.external_registration_url} target="_blank" rel="noopener noreferrer">{t('externalRegistrationAction')}</a>}
          {event.data && <AttendanceWarning eventId={event.data.id} phase={event.data.phase} />}
          {kind === 'open-mic' && next.data?.next_registration_event && ['pre_only', 'both'].includes(series.data?.registration_mode ?? '') && <Link className="quiet-button" to="/open-mics/$openMicId/register" params={{ openMicId: series.data?.public_code ?? id }}>{t('registerForAnyEvent')}</Link>}
          {registrationOpen && event.data && <Link className="quiet-button" to="/events/$eventId/register" params={{ eventId: event.data.public_code }}>{t('register')}</Link>}
          {event.data && isRegistrationClosed(event.data) && <p>{t('registrationClosed')}</p>}
          {event.data?.phase === 'past' && <p>{t('publicRegistrationUnavailable')}</p>}
        </section>
        {series.data?.website && !isOpenMicsWebsite(series.data.website) && <a className="public-details-related" href={series.data.website} target="_blank" rel="noopener noreferrer">{t(event.data ? 'openMicWebsite' : 'website')}<ArrowUpRight size={18} aria-hidden="true" /></a>}
        <div className="public-details-destination"><p className="public-details-small-label">{t('detailsGettingThere')}</p>
        <PublicLocation location={resource} />
        </div>
        </aside>
        </div>
      </>}
    </section>
  </main>
}
