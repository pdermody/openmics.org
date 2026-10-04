import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Clock3, MapPin, Users } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { ApiError, api } from '../api/client'
import { useAccountContext } from '../features/account'
import { markEventRegisteredLocally } from '../features/guestRegistrations'
import { isRegistrationClosed, usePublicEvent, usePublicOpenMic } from '../features/publicReads'
import type { ThemeProps } from './shared'
import { ReadState, Required, RequiredFieldsNote, SiteHeader } from './shared'

type Registration = {
  id: string
  event_id: string
  performer_name: string
  performer_city: string | null
  contact_phone: string | null
  song_names: string[]
  media_consent: boolean
  email_verified_at: string | null
}

function registrationErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'We could not complete your registration. Please try again.'
  const fieldErrors = (error.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors
  if (fieldErrors?.contact_email?.length) return 'Please enter a valid email address, such as you@example.com.'
  if (fieldErrors?.performer_name?.length) return 'Please enter the name you would like the organizer to call.'
  if (error.code === 'REGISTRATIONS_CLOSED') return 'Registration is closed for this event.'
  if (error.code === 'REGISTRATION_UNAVAILABLE') return 'Registration is not available for this event.'
  if (error.code === 'CAPACITY_EXCEEDED') return 'This event is full, but you can check back for cancellations.'
  if (error.code === 'DUPLICATE_REGISTRATION') return 'This email already has a registration for this event.'
  return 'Please check your details and try again.'
}

/** Strips the one-time edit/verify tokens from the URL after they've been exchanged. */
function stripMagicLinkParams() {
  const url = new URL(window.location.href)
  url.searchParams.delete('token')
  url.searchParams.delete('verify')
  window.history.replaceState({}, '', `${url.pathname}${url.search}`)
}

/** Only the (non-secret) registration id is persisted — the actual session lives in the HttpOnly edit-session cookie. */
function editSessionStorageKey(eventCode: string) {
  return `openmic_edit_registration_id_${eventCode}`
}

function kioskTokenStorageKey(eventCode: string) {
  return `openmic_kiosk_token_${eventCode}`
}

// The kiosk QR carries a presence token; keep it for this tab only and drop it from the visible URL.
function takeKioskToken(eventCode: string): string | undefined {
  if (typeof window === 'undefined') return undefined
  const url = new URL(window.location.href)
  const fromUrl = url.searchParams.get('kiosk')
  if (fromUrl) {
    window.sessionStorage.setItem(kioskTokenStorageKey(eventCode), fromUrl)
    url.searchParams.delete('kiosk')
    window.history.replaceState({}, '', `${url.pathname}${url.search}`)
    return fromUrl
  }
  return window.sessionStorage.getItem(kioskTokenStorageKey(eventCode)) ?? undefined
}

function formatEventDateTime(startsAt: string, timeZone: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone, timeZoneName: 'short',
    }).format(new Date(startsAt))
  } catch {
    return new Date(startsAt).toLocaleString()
  }
}

export function RegistrationPage({ eventCode, theme, mode }: { eventCode: string } & ThemeProps) {
  const { t, i18n } = useTranslation()
  const [kioskToken] = useState(() => takeKioskToken(eventCode))
  const kioskMode = Boolean(kioskToken)
  const event = usePublicEvent(eventCode, kioskToken)
  const parentOpenMic = usePublicOpenMic(event.data?.open_mic_id)
  const accountContext = useAccountContext()
  const activeProfile = accountContext.profiles.data?.items.find((profile) => profile.id === accountContext.account.data?.current_profile_id)
  const performerProfile = activeProfile?.profile_kind === 'performer' ? activeProfile : undefined
  const needsPerformerProfile = Boolean(accountContext.account.data) && !performerProfile
  const registrationMode = parentOpenMic.data?.registration_mode
  const eventRegistrationClosed = Boolean(event.data) && isRegistrationClosed(event.data!)
  const standardRegistrationDisabled = !kioskMode && (eventRegistrationClosed
    || parentOpenMic.data?.status !== 'active'
    || event.data?.status !== 'published'
    || event.data?.phase === 'past'
    || !['pre_only', 'both'].includes(registrationMode ?? ''))
  const registrationUnavailableMessage = eventRegistrationClosed
    ? 'Registration is closed for this event.'
    : event.data?.phase === 'past'
      ? 'Registration is no longer available for this event.'
      : parentOpenMic.data?.status !== 'active' || event.data?.status !== 'published'
        ? 'Registration is not available for this event.'
        : registrationMode === 'external'
          ? 'This open mic is using an external registration link, so self-serve signups are disabled here.'
          : 'Online registration is not available for this open mic.'
  const [performerName, setPerformerName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [performerCity, setPerformerCity] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [songNames, setSongNames] = useState('')
  const [mediaConsent, setMediaConsent] = useState(true)
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [editRegistration, setEditRegistration] = useState<Registration | null>(null)
  const [editState, setEditState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [verifyState, setVerifyState] = useState<'idle' | 'verified' | 'error'>('idle')

  // Consume a one-time magic link (?token=<edit>&verify=<verification>) once, then strip it from the URL.
  // On later visits (token already stripped), resume the edit using the stored registration id — the
  // HttpOnly edit-session cookie set during the token exchange is what actually authorizes the request.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const editToken = params.get('token')
    const verifyToken = params.get('verify')
    const storageKey = editSessionStorageKey(eventCode)

    function applyRegistration(current: Registration) {
      markEventRegisteredLocally(current.event_id)
      setEditRegistration(current)
      setEditState('loaded')
      setPerformerName(current.performer_name)
      setPerformerCity(current.performer_city ?? '')
      setContactPhone(current.contact_phone ?? '')
      setSongNames(current.song_names.join(', '))
      setMediaConsent(current.media_consent)
    }

    if (!editToken) {
      const storedRegistrationId = window.localStorage.getItem(storageKey)
      if (!storedRegistrationId) return
      setEditState('loading')
      void api<Registration>(`/registrations/${storedRegistrationId}`)
        .then(applyRegistration)
        .catch(() => {
          window.localStorage.removeItem(storageKey)
          setEditState('idle')
        })
      return
    }

    setEditState('loading')
    void (async () => {
      try {
        const registration = await api<Registration>(`/registrations/edit?token=${encodeURIComponent(editToken)}`)
        let current = registration
        if (verifyToken && !registration.email_verified_at) {
          try {
            current = await api<Registration>(`/registrations/${registration.id}/verify-email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: verifyToken }),
            })
            setVerifyState('verified')
          } catch {
            setVerifyState('error')
          }
        }
        window.localStorage.setItem(storageKey, current.id)
        applyRegistration(current)
      } catch {
        setEditState('error')
      } finally {
        stripMagicLinkParams()
      }
    })()
  }, [eventCode])

  async function submit(eventObject: FormEvent<HTMLFormElement>) {
    eventObject.preventDefault()
    if (standardRegistrationDisabled) {
      setState('error')
      setMessage(registrationUnavailableMessage)
      return
    }
    if (!performerProfile && !performerName.trim()) {
      setState('error')
      setMessage('Please enter the name you would like the organizer to call.')
      return
    }
    if (!editRegistration && !performerProfile && (!kioskMode || contactEmail) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      setState('error')
      setMessage('Please enter a valid email address, such as you@example.com.')
      return
    }
    setState('submitting')
    try {
      if (editRegistration) {
        await api(`/registrations/${editRegistration.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            performer_name: performerName,
            performer_city: performerCity || undefined,
            song_names: songNames.split(',').map((song) => song.trim()).filter(Boolean),
            media_consent: mediaConsent,
          }),
        })
        setState('success')
        setMessage('Your registration has been updated.')
        return
      }
      await api(`/events/${eventCode}/registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: performerProfile?.id,
          performer_name: performerProfile?.profile_name ?? performerName,
          contact_email: performerProfile || !contactEmail ? undefined : contactEmail,
          performer_city: performerCity || undefined,
          contact_phone: contactPhone || undefined,
          song_names: songNames.split(',').map((song) => song.trim()).filter(Boolean),
          media_consent: mediaConsent,
          submission_channel: kioskMode ? 'kiosk_qr' : 'organic',
          organizer_supervised: false,
          ...(kioskToken ? { kiosk_token: kioskToken } : {}),
        }),
      })
      if (event.data) markEventRegisteredLocally(event.data.id)
      setState('success')
      setMessage(kioskMode ? t('kioskQrSignedUp') : performerProfile ? 'You are registered for this event.' : 'Check your inbox to confirm your registration.')
    } catch (error) {
      setState('error')
      setMessage(error instanceof ApiError && error.code === 'KIOSK_TOKEN_INVALID' ? t('kioskQrExpired') : registrationErrorMessage(error))
    }
  }

  return (
    <main className="app" data-theme={theme} data-mode={mode}>
      <SiteHeader />
      <section className="registration-page">
        <Link className="back-link" to="/events/$eventId" params={{ eventId: eventCode }}>{t('backToEvent')}</Link>
        {event.isPending && <ReadState message={t('loading')} />}
        {event.isError && <ReadState message={t('eventLoadError')} retry={() => void event.refetch()} />}
        {event.data && <>
          <div className="eyebrow">{t('registration')}</div>
          <h1>{editRegistration ? t('editRegistrationTitle', { title: event.data.title }) : t('joinTitle', { title: event.data.title })}</h1>
          <div className="registration-event-summary" aria-label={t('eventDetails')}>
            {parentOpenMic.data && <p className="registration-series-name">{parentOpenMic.data.name}</p>}
            <p className="registration-event-fact"><CalendarDays size={17} aria-hidden="true" /><strong>{formatEventDateTime(event.data.starts_at, event.data.time_zone, i18n.language)}</strong></p>
            <p className="registration-event-fact"><MapPin size={17} aria-hidden="true" /><span>{event.data.venue_name}, {event.data.city}, {event.data.country}</span></p>
            {event.data.capacity && <p className="registration-event-fact"><Users size={17} aria-hidden="true" /><span>{t('eventCapacity', { count: event.data.capacity })}</span></p>}
            <p className="registration-event-fact"><Clock3 size={17} aria-hidden="true" /><span>{kioskMode ? t('registrationOpen') : eventRegistrationClosed ? t('registrationClosed') : registrationMode === 'on_night_only' ? t('onNightRegistration') : t('registrationOpen')}</span></p>
          </div>
          <p className="detail-lede">{kioskMode ? t('kioskQrIntro') : t('registrationLead')}</p>
          {editState === 'loading' && <ReadState message={t('loadingRegistration')} />}
          {editState === 'error' && <div className="profile-context profile-context-warning" role="alert">{t('invalidEditLink')}</div>}
          {verifyState === 'verified' && <div className="profile-context" role="status">{t('emailConfirmed')}</div>}
          {verifyState === 'error' && <div className="profile-context profile-context-warning" role="alert">{t('emailConfirmFailed')}</div>}
          {standardRegistrationDisabled && !editRegistration && (
            <div className="profile-context profile-context-warning" role="alert">
              {registrationUnavailableMessage}
            </div>
          )}
          {needsPerformerProfile && !editRegistration && <div className="profile-context profile-context-warning" role="alert">{t('switchPerformerWarning')}</div>}
          {performerProfile && !editRegistration && <div className="profile-context" role="status">{t('registeringAs')} <strong>{performerProfile.profile_name}</strong> · {t('performerProfile')}</div>}
          {performerProfile && editRegistration && <div className="profile-context" role="status">{t('performerFieldsStay', { name: editRegistration.performer_name })}</div>}
          {state === 'success' ? <div className="success-panel" role="status"><strong>{message}</strong>{!editRegistration && !performerProfile && !kioskMode && <p>{t('pendingEmailConfirmation')}</p>}</div> : (needsPerformerProfile && !editRegistration) || (standardRegistrationDisabled && !editRegistration) || editState === 'loading' ? null : <form className="registration-form" noValidate onSubmit={submit}>
            {(!performerProfile || editRegistration) && <RequiredFieldsNote />}
            {!performerProfile && !editRegistration && <>
              <label><span>{t('performerName')}<Required /></span><input required value={performerName} onChange={(input) => setPerformerName(input.target.value)} /></label>
              <label><span>{t('contactEmail')}{!kioskMode && <Required />}</span>{kioskMode && <span className="field-hint">{t('kioskEmailHint')}</span>}<input required={!kioskMode} type="email" value={contactEmail} onChange={(input) => setContactEmail(input.target.value)} /></label>
              <label>{t('city')} <span className="field-hint">{t('optional')}</span><input value={performerCity} onChange={(input) => setPerformerCity(input.target.value)} /></label>
              <label>{t('phone')} <span className="field-hint">{t('phoneOptional')}</span><input type="tel" value={contactPhone} onChange={(input) => setContactPhone(input.target.value)} /></label>
            </>}
            {editRegistration && !performerProfile && <>
              <label><span>{t('performerName')}<Required /></span><input required value={performerName} onChange={(input) => setPerformerName(input.target.value)} /></label>
              <label>{t('city')} <span className="field-hint">{t('optional')}</span><input value={performerCity} onChange={(input) => setPerformerCity(input.target.value)} /></label>
            </>}
            <label>{t('performanceSongs')} <span className="field-hint">{t('performanceHint')}</span><input value={songNames} onChange={(input) => setSongNames(input.target.value)} /></label>
            <label className="checkbox-label"><input type="checkbox" checked={mediaConsent} onChange={(input) => setMediaConsent(input.target.checked)} /><span>{t('mediaConsentFull')}</span></label>
            {state === 'error' && <p className="form-error" role="alert">{message}</p>}
            <button className="primary-button" type="submit" disabled={state === 'submitting'}>{state === 'submitting' ? t('sending') : editRegistration ? t('saveChanges') : t('register')}</button>
          </form>}
        </>}
      </section>
    </main>
  )
}
