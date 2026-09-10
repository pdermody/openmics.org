import { useEffect, useState, type FormEvent } from 'react'
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

export function RegistrationPage({ eventCode, theme, mode }: { eventCode: string } & ThemeProps) {
  const event = usePublicEvent(eventCode)
  const parentOpenMic = usePublicOpenMic(event.data?.open_mic_id)
  const accountContext = useAccountContext()
  const activeProfile = accountContext.profiles.data?.items.find((profile) => profile.id === accountContext.account.data?.current_profile_id)
  const performerProfile = activeProfile?.profile_kind === 'performer' ? activeProfile : undefined
  const needsPerformerProfile = Boolean(accountContext.account.data) && !performerProfile
  const registrationMode = parentOpenMic.data?.registration_mode
  const eventRegistrationClosed = Boolean(event.data) && isRegistrationClosed(event.data!)
  const standardRegistrationDisabled = eventRegistrationClosed || registrationMode === 'on_night_only' || registrationMode === 'external'
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
      setMessage(eventRegistrationClosed
        ? 'Registration is closed for this event.'
        : registrationMode === 'external' ? 'This open mic uses an external registration link.' : 'Registration for this open mic is only available on the night.')
      return
    }
    if (!performerProfile && !performerName.trim()) {
      setState('error')
      setMessage('Please enter the name you would like the organizer to call.')
      return
    }
    if (!editRegistration && !performerProfile && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
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
          contact_email: performerProfile ? undefined : contactEmail,
          performer_city: performerCity || undefined,
          contact_phone: contactPhone || undefined,
          song_names: songNames.split(',').map((song) => song.trim()).filter(Boolean),
          media_consent: mediaConsent,
          submission_channel: 'organic',
          organizer_supervised: false,
        }),
      })
      if (event.data) markEventRegisteredLocally(event.data.id)
      setState('success')
      setMessage(performerProfile ? 'You are registered for this event.' : 'Check your inbox to confirm your registration.')
    } catch (error) {
      setState('error')
      setMessage(registrationErrorMessage(error))
    }
  }

  return (
    <main className="app" data-theme={theme} data-mode={mode}>
      <SiteHeader />
      <section className="registration-page">
        <a className="back-link" href={`/events/${eventCode}`}>← Back to event</a>
        {event.isPending && <ReadState message="Loading registration details…" />}
        {event.isError && <ReadState message="This event could not be loaded." retry={() => void event.refetch()} />}
        {event.data && <>
          <div className="eyebrow">Registration</div>
          <h1>{editRegistration ? `Edit your registration for ${event.data.title}` : `Join ${event.data.title}`}</h1>
          <p className="detail-lede">{event.data.venue_name}, {event.data.city}. We’ll email you a confirmation link before your name appears on the public roster.</p>
          {editState === 'loading' && <ReadState message="Loading your registration…" />}
          {editState === 'error' && <div className="profile-context profile-context-warning" role="alert">This edit link is invalid or has expired. Please use the link from your most recent confirmation email.</div>}
          {verifyState === 'verified' && <div className="profile-context" role="status">Your email is confirmed — your registration is now visible on the roster.</div>}
          {verifyState === 'error' && <div className="profile-context profile-context-warning" role="alert">We could not confirm your email with that link. It may have already been used or expired.</div>}
          {standardRegistrationDisabled && !editRegistration && (
            <div className="profile-context profile-context-warning" role="alert">
              {eventRegistrationClosed
                ? 'Registration is closed for this event.'
                : registrationMode === 'external'
                  ? 'This open mic is using an external registration link, so self-serve signups are disabled here.'
                  : 'This open mic only accepts registrations on the night, so self-serve signups are disabled here.'}
            </div>
          )}
          {needsPerformerProfile && !editRegistration && <div className="profile-context profile-context-warning" role="alert">Switch to one of your performer profiles above to register. Organizer profiles cannot register as the performer, including for their own events.</div>}
          {performerProfile && !editRegistration && <div className="profile-context" role="status">Registering as <strong>{performerProfile.profile_name}</strong> · performer profile</div>}
          {performerProfile && editRegistration && <div className="profile-context" role="status">Performer name and city stay as originally submitted (<strong>{editRegistration.performer_name}</strong>). Switch away from your performer profile above to edit them here.</div>}
          {state === 'success' ? <div className="success-panel" role="status"><strong>{message}</strong>{!editRegistration && !performerProfile && <p>Your place is pending email confirmation.</p>}</div> : (needsPerformerProfile && !editRegistration) || (standardRegistrationDisabled && !editRegistration) || editState === 'loading' ? null : <form className="registration-form" noValidate onSubmit={submit}>
            {(!performerProfile || editRegistration) && <RequiredFieldsNote />}
            {!performerProfile && !editRegistration && <>
              <label><span>Performer name<Required /></span><input required value={performerName} onChange={(input) => setPerformerName(input.target.value)} /></label>
              <label><span>Contact email<Required /></span><input required type="email" value={contactEmail} onChange={(input) => setContactEmail(input.target.value)} /></label>
              <label>City <span className="field-hint">Optional</span><input value={performerCity} onChange={(input) => setPerformerCity(input.target.value)} /></label>
              <label>Phone <span className="field-hint">Optional, for organizer contact</span><input type="tel" value={contactPhone} onChange={(input) => setContactPhone(input.target.value)} /></label>
            </>}
            {editRegistration && !performerProfile && <>
              <label><span>Performer name<Required /></span><input required value={performerName} onChange={(input) => setPerformerName(input.target.value)} /></label>
              <label>City <span className="field-hint">Optional</span><input value={performerCity} onChange={(input) => setPerformerCity(input.target.value)} /></label>
            </>}
            <label>What will you perform? <span className="field-hint">Optional · separate songs with commas</span><input value={songNames} onChange={(input) => setSongNames(input.target.value)} /></label>
            <label className="checkbox-label"><input type="checkbox" checked={mediaConsent} onChange={(input) => setMediaConsent(input.target.checked)} /><span>I’m happy for photos or video of my performance to be shared by the organizer. You can change this later.</span></label>
            {state === 'error' && <p className="form-error" role="alert">{message}</p>}
            <button className="primary-button" type="submit" disabled={state === 'submitting'}>{state === 'submitting' ? 'Sending…' : editRegistration ? 'Save changes' : 'Register for this event'}</button>
          </form>}
        </>}
      </section>
    </main>
  )
}

