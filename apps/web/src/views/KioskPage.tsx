import { useRef, useState, type FormEvent } from 'react'
import { Sparkles } from 'lucide-react'
import { ApiError, friendlyApiErrorMessage } from '../api/client'
import { useEventDetail, useKioskRegistration, useOrganizerProfile } from '../features/organizer'
import { isRegistrationClosed } from '../features/publicReads'
import type { ColorMode, ThemeId } from '../theme'
import { ReadState, Required, RequiredFieldsNote } from './shared'

const CONFIRMATION_DISPLAY_MS = 2500

function kioskErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'REGISTRATIONS_CLOSED') return 'Registration is closed for this event.'
    if (error.code === 'CAPACITY_EXCEEDED') return 'This event is full — no more spots available.'
    if (error.code === 'DUPLICATE_REGISTRATION') return 'That performer is already on the roster for this event.'
    if (error.code === 'FORBIDDEN') return 'Only this event\'s organizer can record kiosk sign-ups.'
    const fieldErrors = (error.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors
    if (fieldErrors?.performer_name?.length) return 'Please enter the performer\'s name.'
  }
  return friendlyApiErrorMessage(error, 'We could not record that sign-up. Please try again.')
}

// A dedicated high-contrast, large-touch-target page an organizer hands to performers (or
// runs themselves) at the door: no account/email required from the performer, and the form
// resets itself right after each successful entry so the next performer can sign up quickly.
export function KioskPage({ seriesId, eventId, theme, mode }: { seriesId: string; eventId: string; theme: ThemeId; mode: ColorMode }) {
  const { context, isOrganizer } = useOrganizerProfile()
  const event = useEventDetail(seriesId, eventId)
  const kioskRegistration = useKioskRegistration(eventId)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const confirmationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const [performerName, setPerformerName] = useState('')
  const [performerCity, setPerformerCity] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [songNames, setSongNames] = useState('')
  const [mediaConsent, setMediaConsent] = useState(true)
  const [confirmation, setConfirmation] = useState('')

  const eventClosed = Boolean(event.data) && isRegistrationClosed(event.data!)

  function resetForm() {
    setPerformerName('')
    setPerformerCity('')
    setContactPhone('')
    setSongNames('')
    setMediaConsent(true)
    nameInputRef.current?.focus()
  }

  function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault()
    if (!performerName.trim()) return
    const submittedName = performerName.trim()
    kioskRegistration.mutate(
      {
        performer_name: submittedName,
        performer_city: performerCity.trim() || undefined,
        contact_phone: contactPhone.trim() || undefined,
        song_names: songNames.split(',').map((song) => song.trim()).filter(Boolean),
        media_consent: mediaConsent,
      },
      {
        onSuccess: () => {
          resetForm()
          setConfirmation(`${submittedName} added to the roster`)
          clearTimeout(confirmationTimer.current)
          confirmationTimer.current = setTimeout(() => setConfirmation(''), CONFIRMATION_DISPLAY_MS)
        },
      },
    )
  }

  return <main className="app kiosk-page" data-theme={theme} data-mode={mode}>
    <header className="topbar kiosk-topbar"><span className="brand"><span className="brand-mark"><Sparkles size={17} /></span><span>open mic kiosk</span></span></header>
    <section className="kiosk-body">
      <a className="back-link" href={`/dashboard/series/${seriesId}/events/${eventId}/roster`}>← Back to roster</a>
      <h1>{event.data?.title ?? 'Event kiosk'}</h1>

      {!context.account.data && <ReadState message="Sign in as this event's organizer to run the kiosk." />}
      {context.account.data && !isOrganizer && <ReadState message="Select an organizer profile to run the kiosk." />}
      {isOrganizer && event.isPending && <ReadState message="Loading event…" />}
      {isOrganizer && event.isError && <ReadState message={friendlyApiErrorMessage(event.error, 'We could not load this event.')} retry={() => void event.refetch()} />}

      {isOrganizer && event.data && eventClosed && <div className="profile-context profile-context-warning" role="alert">
        Registration is closed for this event.
      </div>}

      {isOrganizer && event.data && !eventClosed && <form className="kiosk-form" noValidate onSubmit={submit}>
        <RequiredFieldsNote />
        <label><span>Performer name<Required /></span><input ref={nameInputRef} autoFocus required value={performerName} onChange={(input) => setPerformerName(input.target.value)} /></label>
        <label>City <span className="field-hint">Optional</span><input value={performerCity} onChange={(input) => setPerformerCity(input.target.value)} /></label>
        <label>Phone <span className="field-hint">Optional</span><input type="tel" value={contactPhone} onChange={(input) => setContactPhone(input.target.value)} /></label>
        <label>What will you perform? <span className="field-hint">Optional · separate songs with commas</span><input value={songNames} onChange={(input) => setSongNames(input.target.value)} /></label>
        <label className="checkbox-label kiosk-checkbox-label"><input type="checkbox" checked={mediaConsent} onChange={(input) => setMediaConsent(input.target.checked)} /><span>Happy for photos or video to be shared by the organizer</span></label>
        {kioskRegistration.isError && <p className="form-error" role="alert">{kioskErrorMessage(kioskRegistration.error)}</p>}
        {confirmation && <p className="kiosk-success" role="status">{confirmation} ✓</p>}
        <button className="primary-button kiosk-submit" type="submit" disabled={kioskRegistration.isPending}>{kioskRegistration.isPending ? 'Adding…' : 'Add to roster'}</button>
      </form>}
    </section>
  </main>
}

