import { Link } from '@tanstack/react-router'
import { Clock3, Eye, MapPin, Pencil, Settings2 } from 'lucide-react'
import { friendlyApiErrorMessage } from '../api/client'
import { useTranslation } from 'react-i18next'
import { useAccountContext } from '../features/account'
import { useMyRegisteredEventIds } from '../features/myRegistrations'
import { isRegistrationClosed, useNextEvent, usePublicEvent, usePublicOpenMic, usePublicOwnerOpenMics, usePublicProfile } from '../features/publicReads'
import { profileKindMeta } from '../features/profileKinds'
import type { ThemeProps } from './shared'
import { ReadState, SiteHeader, SocialButton } from './shared'

function focusProfileSwitcher() {
  const select = document.getElementById('profile-switcher-select') as (HTMLSelectElement & { showPicker?: () => void }) | null
  if (!select) return
  select.focus()
  try { select.showPicker?.() } catch { /* showPicker requires a user gesture in some browsers; focus is enough of a fallback */ }
}

export function DetailPage({ kind, id, theme, mode }: { kind: 'event' | 'open-mic' | 'profile'; id: string } & ThemeProps) {
  const { t } = useTranslation()
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
  const ownsOpenMic = Boolean(openMic.data && accountContext.profiles.data?.items.some((profileItem) => profileItem.id === openMic.data?.owner_profile_id))
  const ownsEvent = Boolean(parentOpenMic.data && accountContext.profiles.data?.items.some((profileItem) => profileItem.id === parentOpenMic.data?.owner_profile_id))
  const needsPerformerProfile = Boolean(accountContext.account.data) && activeProfile?.profile_kind !== 'performer'
  const registeredEventIds = useMyRegisteredEventIds()
  const isRegisteredForEvent = kind === 'event' && Boolean(event.data) && registeredEventIds.has(event.data!.id)
  const nextRegistrableEvent = nextEvent.data?.next_registration_event
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
          <p className="detail-lede">{event.data?.notes ?? openMic.data?.description ?? profile.data?.bio ?? 'A welcoming room for new voices.'}</p>
          <div className="detail-facts">
            {(event.data || openMic.data) && <span><MapPin size={16} /> {event.data?.venue_name ?? openMic.data?.venue_name}, {event.data?.city ?? openMic.data?.city}</span>}
            {event.data?.starts_at && <span><Clock3 size={16} /> {new Date(event.data.starts_at).toLocaleString()}</span>}
            {profileKind && <span><profileKind.icon size={16} aria-hidden="true" /> {t(profileKind.labelKey)}</span>}
          </div>
          <div className="detail-actions">
            {kind === 'open-mic' && ownsOpenMic && <>
              <Link className="quiet-button icon-button" to="/open-mics/$openMicId" params={{ openMicId: openMic.data?.current_handle ?? openMic.data?.id ?? '' }} aria-label={t('view')} title={t('view')}><Eye size={17} /></Link>
              <Link className="quiet-button icon-button" to="/dashboard/series/$seriesId/edit" params={{ seriesId: openMic.data?.id ?? '' }} aria-label={t('edit')} title={t('edit')}><Pencil size={17} /></Link>
              <Link className="quiet-button icon-button" to="/dashboard/series/$seriesId" params={{ seriesId: openMic.data?.id ?? '' }} aria-label={t('manage')} title={t('manage')}><Settings2 size={17} /></Link>
            </>}
            {kind === 'event' && ownsEvent && <>
              <Link className="quiet-button icon-button" to="/events/$eventId" params={{ eventId: event.data?.public_code ?? '' }} aria-label={t('view')} title={t('view')}><Eye size={17} /></Link>
              <Link className="quiet-button icon-button" to="/dashboard/series/$seriesId/events/$eventId/edit" params={{ seriesId: parentOpenMic.data?.id ?? '', eventId: event.data?.id ?? '' }} aria-label={t('edit')} title={t('edit')}><Pencil size={17} /></Link>
              <Link className="quiet-button icon-button" to="/dashboard/series/$seriesId/events/$eventId/roster" params={{ seriesId: parentOpenMic.data?.id ?? '', eventId: event.data?.id ?? '' }} aria-label={t('manage')} title={t('manage')}><Settings2 size={17} /></Link>
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
            {kind === 'open-mic' && (
              isRegisteredForNextEvent ? (
                <span className="profile-context" role="status">{t('registeredNext')}</span>
              ) : needsPerformerProfile ? (
                <button className="primary-button" type="button" onClick={focusProfileSwitcher}>
                  Switch to a performer profile to register
                </button>
              ) : (
                <Link className="primary-button" to="/open-mics/$openMicId/register" params={{ openMicId: openMic.data?.public_code ?? id }}>{t('viewRegistration')}</Link>
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
        </>}
      </section>
    </main>
  )
}
