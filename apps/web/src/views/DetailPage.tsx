import { Link, useLocation } from '@tanstack/react-router'
import { Clock3, Image, MapPin, Pencil, Settings2 } from 'lucide-react'
import { friendlyApiErrorMessage } from '../api/client'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAccountContext } from '../features/account'
import { useMyRegisteredEventIds } from '../features/myRegistrations'
import { isRegistrationClosed, useNextEvent, usePublicEvent, usePublicOpenMic, usePublicOwnerOpenMics, usePublicProfile } from '../features/publicReads'
import { profileKindMeta } from '../features/profileKinds'
import { PublicDetailTabs } from '../components/PublicDetailTabs'
import { PublicDetailsLink } from '../components/PublicDetailsLink'
import { AttendanceWarning } from '../components/AttendanceWarning'
import { entryFee, eventTimeRange } from '../features/publicDetails'
import type { ThemeProps } from './shared'
import { ReadState, SiteHeader, SocialButton } from './shared'

function focusProfileSwitcher() {
  const select = document.getElementById('profile-switcher-select') as (HTMLSelectElement & { showPicker?: () => void }) | null
  if (!select) return
  select.focus()
  try { select.showPicker?.() } catch { /* showPicker requires a user gesture in some browsers; focus is enough of a fallback */ }
}

export function DetailPage({ kind, id, theme, mode }: { kind: 'event' | 'open-mic' | 'profile'; id: string } & ThemeProps) {
  const { t, i18n } = useTranslation()
  const routeLocation = useLocation()
  const event = usePublicEvent(kind === 'event' ? id : undefined)
  const openMic = usePublicOpenMic(kind === 'open-mic' ? id : undefined)
  const nextEvent = useNextEvent(kind === 'open-mic' ? id : undefined)
  const profile = usePublicProfile(kind === 'profile' ? id : undefined)
  const profileKind = profileKindMeta(profile.data?.profile_kind)
  const isOrganizerProfile = kind === 'profile' && profile.data?.profile_kind === 'organizer'
  const organizerOpenMics = usePublicOwnerOpenMics(isOrganizerProfile ? profile.data?.id : undefined)
  const parentOpenMic = usePublicOpenMic(kind === 'event' ? event.data?.open_mic_id : undefined)
  const accountContext = useAccountContext()
  const activeProfile = accountContext.profiles.data?.items.find((profileItem) => profileItem.id === accountContext.account.data?.current_profile_id)
  // Owner actions require the ACTIVE profile to own the series — checking `.some()` across
  // all account profiles leaked them to performer profiles sharing the account (403 on use).
  const ownsOpenMic = Boolean(openMic.data && activeProfile?.id === openMic.data?.owner_profile_id)
  const canCreateSeriesEvents = ownsOpenMic
    && activeProfile?.profile_kind === 'organizer'
    && accountContext.permissions.data?.permissions.includes('profiles:manage')
  const ownsEvent = Boolean(parentOpenMic.data && activeProfile?.id === parentOpenMic.data?.owner_profile_id)
  const eventGalleryAccessPending = parentOpenMic.isPending
    || accountContext.account.isPending
    || accountContext.profiles.isPending
    || accountContext.permissions.isPending
  const needsPerformerProfile = Boolean(accountContext.account.data) && activeProfile?.profile_kind !== 'performer'
  const registeredEventIds = useMyRegisteredEventIds()
  const isRegisteredForEvent = kind === 'event' && Boolean(event.data) && registeredEventIds.has(event.data!.id)
  const nextRegistrableEvent = nextEvent.data?.next_registration_event
  const highlightedEvent = nextEvent.data?.current_event ?? nextEvent.data?.next_event
  const isRegisteredForNextEvent = kind === 'open-mic' && Boolean(nextRegistrableEvent) && registeredEventIds.has(nextRegistrableEvent!.id)
  const loading = kind === 'event' ? event.isPending : kind === 'open-mic' ? openMic.isPending : profile.isPending
  const error = kind === 'event' ? event.isError : kind === 'open-mic' ? openMic.isError : profile.isError
  const title = event.data?.title ?? openMic.data?.name ?? profile.data?.profile_name
  const errorObject = kind === 'event' ? event.error : kind === 'open-mic' ? openMic.error : profile.error
  const retry = () => void (kind === 'event' ? event.refetch() : kind === 'open-mic' ? openMic.refetch() : profile.refetch())
  const registrationMode = kind === 'event' ? parentOpenMic.data?.registration_mode : openMic.data?.registration_mode
  const eventRegistrationClosed = kind === 'event' && Boolean(event.data) && isRegistrationClosed(event.data!)
  const eventRegistrationAvailable = parentOpenMic.data?.status === 'active'
    && event.data?.status === 'published'
    && event.data?.phase !== 'past'
    && ['pre_only', 'both'].includes(registrationMode ?? '')
    && !eventRegistrationClosed
  const registrationDisabled = kind === 'event' && !eventRegistrationAvailable
  const registrationDisabledLabel = eventRegistrationClosed
    ? 'Registration closed'
    : registrationMode === 'external'
      ? 'External registration'
      : 'Registration unavailable'

  // Media gallery deep-link state (design §12): ?media=<id> opens the lightbox on top of
  // this page; ?mediaUnavailable=<id> (redirected stale deep-link) shows a toast. These
  // are mount-time seeds read straight from the URL so the page also works under the
  // bare test router.
  const [search] = useState(() => new URLSearchParams(window.location.search))
  const [mediaUnavailableNotice, setMediaUnavailableNotice] = useState<string | null>(null)
  useEffect(() => {
    const unavailable = search.get('mediaUnavailable')
    if (unavailable) {
      setMediaUnavailableNotice(unavailable)
      const url = new URL(window.location.href)
      url.searchParams.delete('mediaUnavailable')
      window.history.replaceState(window.history.state, '', url.toString())
    }
  }, [search])
  const showProfileGallery = kind === 'profile' && profile.data?.profile_kind === 'performer' && profile.data.show_gig_media !== false
  const publicResource = kind === 'event' ? event.data : openMic.data
  const publicHandle = kind === 'event' ? event.data?.open_mic_handle : openMic.data?.current_handle
  useEffect(() => {
    if (title) document.title = `${title} | OpenMics.org`
  }, [title])
  useEffect(() => {
    const restoration = routeLocation.state.restorePublicLanding
    if (!publicResource || restoration?.resource !== `${kind}:${publicResource.id}`) return
    window.scrollTo({ top: restoration.scrollY, behavior: 'instant' })
    document.getElementById(restoration.focusId)?.focus({ preventScroll: true })
  }, [routeLocation.state.restorePublicLanding, publicResource, kind])

  return (
    <main className="app" data-theme={theme} data-mode={mode}>
      <SiteHeader />
      <section className="detail-page">
        <Link className="back-link" to="/">{t('backToDiscovery')}</Link>
          {loading && <ReadState message={t('loading')} />}
        {error && <ReadState message={friendlyApiErrorMessage(errorObject, 'This page could not be loaded. Please try again.')} retry={retry} />}
        {!loading && !error && title && <>
          <div className="eyebrow">{kind === 'event' ? t('eventDetail') : kind === 'open-mic' ? t('seriesDetail') : t(profileKind?.titleKey ?? 'publicProfile')}</div>
          <h1>{title}</h1>
          <p className={`detail-lede${kind !== 'profile' ? ' public-landing-preview' : ''}`}>{event.data?.public_information ?? openMic.data?.description ?? profile.data?.bio}</p>
          {publicResource && kind !== 'profile' && (event.data?.public_information || openMic.data?.description) && <PublicDetailsLink kind={kind} id={publicResource.id} handle={publicHandle} section="about">{t('publicReadMore')}</PublicDetailsLink>}
          <div className="detail-facts">
            {event.data && <span><Clock3 size={16} /> {eventTimeRange(event.data, i18n.language, t)}</span>}
            {openMic.data?.schedule_summary && <span><Clock3 size={16} /> {openMic.data.schedule_summary}</span>}
            {publicResource && <span>{entryFee(publicResource, i18n.language, t)}</span>}
            {publicResource?.activities && <span>{publicResource.activities.map((activity) => t(`activity${activity.charAt(0).toUpperCase()}${activity.slice(1)}`)).join(', ')}</span>}
            {registrationMode && <span>{t(`publicRegistration_${registrationMode}`)}</span>}
            {(openMic.data ?? parentOpenMic.data)?.originals_only && <span>{t('originalsOnly')}</span>}
            {(openMic.data ?? parentOpenMic.data)?.age_policy && <span>{t(`publicAge_${(openMic.data ?? parentOpenMic.data)!.age_policy}`)}</span>}
            {profileKind && <span><profileKind.icon size={16} aria-hidden="true" /> {t(profileKind.labelKey)}</span>}
            {publicResource?.tags.map((tag) => <span key={tag}>{tag}</span>)}
            {publicResource && <span className="detail-venue"><MapPin size={16} aria-hidden="true" /> {publicResource.venue_name}, {publicResource.city}</span>}
            {publicResource && kind !== 'profile' && <PublicDetailsLink kind={kind} id={publicResource.id} handle={publicHandle}>{t('moreDetails')}</PublicDetailsLink>}
          </div>
          {event.data && <AttendanceWarning eventId={event.data.id} phase={event.data.phase} />}
          {kind === 'open-mic' && highlightedEvent && <article className="series-next-event">
            <AttendanceWarning eventId={highlightedEvent.id} phase={highlightedEvent.phase} />
            <strong>{t(highlightedEvent.phase === 'running' ? 'browseHappeningNow' : 'browseNextEvent')}</strong>
            <h2><Link to="/events/$eventId" params={{ eventId: highlightedEvent.id }}>{highlightedEvent.title}</Link></h2>
            <p><time dateTime={highlightedEvent.starts_at}>
              {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: highlightedEvent.time_zone }).format(new Date(highlightedEvent.starts_at))}
            </time> · {highlightedEvent.venue_name}, {highlightedEvent.city}</p>
            {nextRegistrableEvent && <div className="detail-actions">
              {isRegisteredForNextEvent ? (
                <span className="profile-context" role="status">{t('registeredNext')}</span>
              ) : needsPerformerProfile ? (
                <button className="primary-button" type="button" onClick={focusProfileSwitcher}>
                  Switch to a performer profile to register
                </button>
              ) : (
                <Link className="primary-button" to="/open-mics/$openMicId/register" params={{ openMicId: openMic.data?.public_code ?? id }}>{t('registerForAnyEvent')}</Link>
              )}
            </div>}
            {canCreateSeriesEvents && <Link className="quiet-button" to="/dashboard/series/$seriesId/events/new" params={{ seriesId: openMic.data!.id }}
              aria-label={t('eventCopyActionLabel', { title: highlightedEvent.title })}
              search={{ sourceEventId: highlightedEvent.id, copySchedule: true }}>
              {t('eventCopyAction')}
            </Link>}
          </article>}
          <div className="detail-actions">
            {kind === 'open-mic' && ownsOpenMic && <>
              <Link className="quiet-button icon-button" to="/dashboard/series/$seriesId/edit" params={{ seriesId: openMic.data?.id ?? '' }} aria-label={t('edit')} title={t('edit')}><Pencil size={17} /></Link>
              <Link className="quiet-button icon-button" to="/dashboard/series/$seriesId" params={{ seriesId: openMic.data?.id ?? '' }} aria-label={t('manage')} title={t('manage')}><Settings2 size={17} /></Link>
              <Link className="quiet-button icon-button" to="/dashboard/series/$seriesId/media" params={{ seriesId: openMic.data?.id ?? '' }} aria-label={t('mediaManageLink')} title={t('mediaManageLink')}><Image size={17} /></Link>
              {canCreateSeriesEvents && <Link className="quiet-button" to="/dashboard/series/$seriesId/events/new" params={{ seriesId: openMic.data?.id ?? '' }} search={{ sourceEventId: undefined, copySchedule: false }}>{t('newEvent')}</Link>}
            </>}
            {kind === 'event' && ownsEvent && <>
              <Link className="quiet-button icon-button" to="/dashboard/series/$seriesId/events/$eventId/edit" params={{ seriesId: parentOpenMic.data?.id ?? '', eventId: event.data?.id ?? '' }} aria-label={t('edit')} title={t('edit')}><Pencil size={17} /></Link>
              <Link className="quiet-button icon-button" to="/dashboard/series/$seriesId/events/$eventId/roster" params={{ seriesId: parentOpenMic.data?.id ?? '', eventId: event.data?.id ?? '' }} aria-label={t('manage')} title={t('manage')}><Settings2 size={17} /></Link>
              <Link className="quiet-button icon-button" to="/dashboard/series/$seriesId/events/$eventId/media" params={{ seriesId: parentOpenMic.data?.id ?? '', eventId: event.data?.id ?? '' }} aria-label={t('mediaManageLink')} title={t('mediaManageLink')}><Image size={17} /></Link>
            </>}
            {kind === 'event' && (
              isRegisteredForEvent ? (
                <>
                  <span className="profile-context" role="status">{t('registeredEvent')}</span>
                  {!registrationDisabled && <Link className="link-button" to="/events/$eventId/register" params={{ eventId: event.data?.public_code ?? '' }}>{t('registerAnotherPerformer')}</Link>}
                </>
              ) : registrationDisabled ? (
                <button className="primary-button" type="button" disabled aria-disabled="true">
                  {registrationDisabledLabel}
                </button>
              ) : needsPerformerProfile ? (
                <button className="primary-button" type="button" onClick={focusProfileSwitcher}>
                  Switch to a performer profile to register
                </button>
              ) : (
                <Link className="primary-button" to="/events/$eventId/register" params={{ eventId: event.data?.public_code ?? '' }}>{t('register')}</Link>
              )
            )}
            {kind === 'profile' && !isOrganizerProfile && <button className="primary-button" type="button">{t('followProfile')}</button>}
            {!isOrganizerProfile && <><SocialButton label="React" icon="heart" /><SocialButton label="Comment" icon="message" /></>}
          </div>
          {isOrganizerProfile && <section aria-labelledby="organizer-series-heading">
            <h2 id="organizer-series-heading">{t('organizerSeries')}</h2>
            {organizerOpenMics.isPending && <ReadState message={t('loading')} />}
            {organizerOpenMics.data?.length === 0 && <p className="field-hint">{t('noOrganizerSeries')}</p>}
            {organizerOpenMics.data && organizerOpenMics.data.length > 0 && <ul className="organizer-series-list">
              {organizerOpenMics.data.map((openMic) => <li key={openMic.id}>
                <Link to="/open-mics/$openMicId" params={{ openMicId: openMic.current_handle ?? openMic.id }}>{openMic.name}</Link>
                <span className="field-hint"> · {openMic.venue_name}, {openMic.city}</span>
              </li>)}
            </ul>}
          </section>}
          {kind === 'event' && !registrationDisabled && needsPerformerProfile && (
            <p className="field-hint">{t('organizerCannotPerform')}</p>
          )}
          {mediaUnavailableNotice && <p className="media-unavailable-toast" role="status">{t('mediaUnavailableNotice')}</p>}
          {kind === 'event' && event.data && eventGalleryAccessPending && <ReadState message={t('loading')} />}
          {kind === 'event' && event.data && parentOpenMic.isError && (
            <ReadState message={friendlyApiErrorMessage(parentOpenMic.error, 'This page could not be loaded. Please try again.')} retry={() => void parentOpenMic.refetch()} />
          )}
          {kind === 'event' && event.data && parentOpenMic.isSuccess && (
            <PublicDetailTabs key={event.data.id} scope={{ kind: 'event', id: event.data.id }} publicView={!ownsEvent} />
          )}
          {kind === 'open-mic' && openMic.data && (
            <PublicDetailTabs key={openMic.data.id} scope={{ kind: 'open-mic', id: openMic.data.id }} canCopyEvents={canCreateSeriesEvents} />
          )}
          {showProfileGallery && profile.data && (
            <section aria-label={t('mediaGalleryHeading')}>
              <h2>{t('mediaProfileGalleryHeading')}</h2>
              <PublicDetailTabs key={profile.data.id} scope={{ kind: 'profile', id: profile.data.id }} />
            </section>
          )}
        </>}
      </section>
    </main>
  )
}
