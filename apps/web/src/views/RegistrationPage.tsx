import { useState, type FormEvent } from 'react'
import { ApiError, api } from '../api/client'
import { useAccountContext } from '../features/account'
import { usePublicEvent, usePublicOpenMic } from '../features/publicReads'
import type { ThemeProps } from './shared'
import { ReadState, SiteHeader } from './shared'

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

export function RegistrationPage({ eventCode, theme, mode }: { eventCode: string } & ThemeProps) {
  const event = usePublicEvent(eventCode)
  const parentOpenMic = usePublicOpenMic(event.data?.open_mic_id)
  const accountContext = useAccountContext()
  const activeProfile = accountContext.profiles.data?.items.find((profile) => profile.id === accountContext.account.data?.current_profile_id)
  const performerProfile = activeProfile?.profile_kind === 'performer' ? activeProfile : undefined
  const needsPerformerProfile = Boolean(accountContext.account.data) && !performerProfile
  const registrationMode = parentOpenMic.data?.registration_mode
  const standardRegistrationDisabled = registrationMode === 'on_night_only' || registrationMode === 'external'
  const [performerName, setPerformerName] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [performerCity, setPerformerCity] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [songNames, setSongNames] = useState('')
  const [mediaConsent, setMediaConsent] = useState(true)
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function submit(eventObject: FormEvent<HTMLFormElement>) {
    eventObject.preventDefault()
    if (standardRegistrationDisabled) {
      setState('error')
      setMessage(registrationMode === 'external' ? 'This open mic uses an external registration link.' : 'Registration for this open mic is only available on the night.')
      return
    }
    if (!performerProfile && !performerName.trim()) {
      setState('error')
      setMessage('Please enter the name you would like the organizer to call.')
      return
    }
    if (!performerProfile && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      setState('error')
      setMessage('Please enter a valid email address, such as you@example.com.')
      return
    }
    setState('submitting')
    try {
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
      setState('success')
      setMessage('Check your inbox to confirm your registration.')
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
          <h1>Join {event.data.title}</h1>
          <p className="detail-lede">{event.data.venue_name}, {event.data.city}. We’ll email you a confirmation link before your name appears on the public roster.</p>
          {standardRegistrationDisabled && (
            <div className="profile-context profile-context-warning" role="alert">
              {registrationMode === 'external'
                ? 'This open mic is using an external registration link, so self-serve signups are disabled here.'
                : 'This open mic only accepts registrations on the night, so self-serve signups are disabled here.'}
            </div>
          )}
          {needsPerformerProfile && <div className="profile-context profile-context-warning" role="alert">Switch to one of your performer profiles above to register. Organizer profiles cannot register as the performer, including for their own events.</div>}
          {performerProfile && <div className="profile-context" role="status">Registering as <strong>{performerProfile.profile_name}</strong> · performer profile</div>}
          {state === 'success' ? <div className="success-panel" role="status"><strong>{message}</strong><p>Your place is pending email confirmation.</p></div> : needsPerformerProfile || standardRegistrationDisabled ? null : <form className="registration-form" noValidate onSubmit={submit}>
            {!performerProfile && <>
              <label>Performer name<input required value={performerName} onChange={(input) => setPerformerName(input.target.value)} /></label>
              <label>Contact email<input required type="email" value={contactEmail} onChange={(input) => setContactEmail(input.target.value)} /></label>
              <label>City <span className="field-hint">Optional</span><input value={performerCity} onChange={(input) => setPerformerCity(input.target.value)} /></label>
              <label>Phone <span className="field-hint">Optional, for organizer contact</span><input type="tel" value={contactPhone} onChange={(input) => setContactPhone(input.target.value)} /></label>
            </>}
            <label>What will you perform? <span className="field-hint">Optional · separate songs with commas</span><input value={songNames} onChange={(input) => setSongNames(input.target.value)} /></label>
            <label className="checkbox-label"><input type="checkbox" checked={mediaConsent} onChange={(input) => setMediaConsent(input.target.checked)} /><span>I’m happy for photos or video of my performance to be shared by the organizer. You can change this later.</span></label>
            {state === 'error' && <p className="form-error" role="alert">{message}</p>}
            <button className="primary-button" type="submit" disabled={state === 'submitting'}>{state === 'submitting' ? 'Sending…' : 'Register for this event'}</button>
          </form>}
        </>}
      </section>
    </main>
  )
}
