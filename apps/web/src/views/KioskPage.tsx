import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'
import { ApiError, friendlyApiErrorMessage } from '../api/client'
import { hashKioskPin, useEventDetail, useKioskBackupPinStatus, useKioskRegistration, useOrganizerProfile, useSetKioskBackupPin, useVerifyKioskBackupPin } from '../features/organizer'
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

// Kiosk lock/exit flow: 'loading' while checking whether this series already has a backup PIN
// configured server-side, 'setup-backup' if it doesn't yet (organizer must set one before kiosk
// mode can start), 'choose-pin' lets the organizer pick their own fresh one-time PIN for this
// session (held only in memory — never persisted or sent anywhere), 'active' is the fullscreen
// kiosk form, and 'exit-gate' requires either PIN before releasing fullscreen and returning to
// the roster page.
type KioskLockPhase = 'loading' | 'setup-backup' | 'choose-pin' | 'active' | 'exit-gate'

function KioskLock({
  seriesId,
  eventId,
  rootRef,
  children,
}: {
  seriesId: string
  eventId: string
  rootRef: React.RefObject<HTMLDivElement | null>
  children: (requestExit: () => void) => React.ReactNode
}) {
  const { t } = useTranslation()
  const backupPinStatus = useKioskBackupPinStatus(seriesId)
  const setBackupPin = useSetKioskBackupPin(seriesId)
  const verifyBackupPin = useVerifyKioskBackupPin(seriesId)

  const [phase, setPhase] = useState<KioskLockPhase>('loading')
  const [oneTimePin, setOneTimePin] = useState('')
  const [backupPinDraft, setBackupPinDraft] = useState('')
  const [backupPinConfirm, setBackupPinConfirm] = useState('')
  const [oneTimePinDraft, setOneTimePinDraft] = useState('')
  const [oneTimePinConfirm, setOneTimePinConfirm] = useState('')
  const [exitPinEntry, setExitPinEntry] = useState('')
  const [error, setError] = useState('')

  // Derived (not effect-driven): once the server tells us whether a backup PIN already exists for
  // this series, render straight into whichever flow applies. `phase` itself only ever moves past
  // 'loading' via explicit user actions below (saveBackupPin, etc.), so there's no state-in-effect
  // synchronization needed here.
  const effectivePhase: KioskLockPhase = phase === 'loading' && backupPinStatus.isSuccess
    ? (backupPinStatus.data.configured ? 'choose-pin' : 'setup-backup')
    : phase

  // If a bystander exits fullscreen without going through the "Exit kiosk" PIN gate (e.g. the Esc
  // key), fall back to the same PIN gate rather than silently revealing the roster underneath.
  useEffect(() => {
    function onFullscreenChange() {
      if (!document.fullscreenElement) setPhase((current) => (current === 'active' ? 'exit-gate' : current))
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  async function saveBackupPin(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault()
    setError('')
    if (backupPinDraft.trim().length < 4) { setError('Backup PIN must be at least 4 digits.'); return }
    if (backupPinDraft !== backupPinConfirm) { setError('Backup PINs do not match.'); return }
    try {
      const hash = await hashKioskPin(backupPinDraft.trim())
      await setBackupPin.mutateAsync(hash)
      setBackupPinDraft('')
      setBackupPinConfirm('')
      setPhase('choose-pin')
    } catch {
      setError('Could not save the backup PIN. Please try again.')
    }
  }

  async function startKiosk(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault()
    setError('')
    if (oneTimePinDraft.trim().length < 4) { setError('One-time PIN must be at least 4 digits.'); return }
    if (oneTimePinDraft !== oneTimePinConfirm) { setError('One-time PINs do not match.'); return }
    setOneTimePin(oneTimePinDraft.trim())
    setOneTimePinDraft('')
    setOneTimePinConfirm('')
    setPhase('active')
    try { await rootRef.current?.requestFullscreen() } catch { /* fullscreen is best-effort; kiosk still works windowed */ }
  }

  async function submitExitPin(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault()
    setError('')
    const entered = exitPinEntry.trim()
    if (entered.length === 0) { setError('Incorrect PIN.'); return }
    if (entered === oneTimePin) {
      setExitPinEntry('')
      if (document.fullscreenElement) { try { await document.exitFullscreen() } catch { /* already released */ } }
      window.location.href = `/dashboard/series/${seriesId}/events/${eventId}/roster`
      return
    }
    try {
      const hash = await hashKioskPin(entered)
      const result = await verifyBackupPin.mutateAsync(hash)
      if (!result.valid) { setError('Incorrect PIN.'); return }
      setExitPinEntry('')
      if (document.fullscreenElement) { try { await document.exitFullscreen() } catch { /* already released */ } }
      window.location.href = `/dashboard/series/${seriesId}/events/${eventId}/roster`
    } catch {
      setError('Could not check that PIN. Please try again.')
    }
  }

  if (effectivePhase === 'loading' && backupPinStatus.isError) return <div className="kiosk-lock-screen">
    <ReadState message={friendlyApiErrorMessage(backupPinStatus.error, 'We could not load this kiosk\'s settings.')} retry={() => void backupPinStatus.refetch()} />
    <a className="back-link" href={`/dashboard/series/${seriesId}/events/${eventId}/roster`}>← Back to roster</a>
  </div>

  if (effectivePhase === 'loading') return <div className="kiosk-lock-screen"><ReadState message="Loading kiosk settings…" /></div>

  if (effectivePhase === 'setup-backup') return <div className="kiosk-lock-screen">
    <h1>{t('setUpKiosk')}</h1>
    <p>{t('kioskBackupIntro')}</p>
    <form className="kiosk-form" noValidate onSubmit={(formEvent) => void saveBackupPin(formEvent)}>
      <RequiredFieldsNote />
      <label><span>{t('backupPin')}<Required /></span><input type="password" inputMode="numeric" minLength={4} required value={backupPinDraft} onChange={(input) => setBackupPinDraft(input.target.value)} /></label>
      <label><span>{t('confirmBackupPin')}<Required /></span><input type="password" inputMode="numeric" minLength={4} required value={backupPinConfirm} onChange={(input) => setBackupPinConfirm(input.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button kiosk-submit" type="submit" disabled={setBackupPin.isPending}>{t('saveBackupPin')}</button>
    </form>
    <a className="back-link" href={`/dashboard/series/${seriesId}/events/${eventId}/roster`}>← Back to roster</a>
  </div>

  if (effectivePhase === 'choose-pin') return <div className="kiosk-lock-screen">
    <h1>{t('chooseExitPin')}</h1>
    <p>{t('kioskSessionIntro')}</p>
    <form className="kiosk-form" noValidate onSubmit={(formEvent) => void startKiosk(formEvent)}>
      <RequiredFieldsNote />
      <label><span>{t('oneTimePin')}<Required /></span><input type="password" inputMode="numeric" minLength={4} required autoFocus value={oneTimePinDraft} onChange={(input) => setOneTimePinDraft(input.target.value)} /></label>
      <label><span>{t('confirmOneTimePin')}<Required /></span><input type="password" inputMode="numeric" minLength={4} required value={oneTimePinConfirm} onChange={(input) => setOneTimePinConfirm(input.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button kiosk-submit" type="submit">{t('startKiosk')}</button>
    </form>
    <button className="link-button" type="button" onClick={() => setPhase('setup-backup')}>{t('changeBackupPin')}</button>
    <a className="back-link" href={`/dashboard/series/${seriesId}/events/${eventId}/roster`}>← Back to roster</a>
  </div>

  if (effectivePhase === 'exit-gate') return <div className="kiosk-lock-screen kiosk-exit-gate">
    <h1>{t('enterExitPin')}</h1>
    <form className="kiosk-form" noValidate onSubmit={(formEvent) => void submitExitPin(formEvent)}>
      <label><span>{t('oneTimeOrBackupPin')}<Required /></span><input type="password" inputMode="numeric" autoFocus required value={exitPinEntry} onChange={(input) => setExitPinEntry(input.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary-button kiosk-submit" type="submit" disabled={verifyBackupPin.isPending}>{t('unlock')}</button>
    </form>
  </div>

  // phase === 'active'
  return <>{children(() => setPhase('exit-gate'))}</>
}

// A dedicated high-contrast, large-touch-target page an organizer hands to performers (or
// runs themselves) at the door: no account/email required from the performer, and the form
// resets itself right after each successful entry so the next performer can sign up quickly.
export function KioskPage({ seriesId, eventId, theme, mode }: { seriesId: string; eventId: string; theme: ThemeId; mode: ColorMode }) {
  const { t } = useTranslation()
  const { context, isOrganizer } = useOrganizerProfile()
  const event = useEventDetail(seriesId, eventId)
  const kioskRegistration = useKioskRegistration(eventId)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const confirmationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const rootRef = useRef<HTMLDivElement>(null)

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

  if (!isOrganizer) return <main className="app kiosk-page" data-theme={theme} data-mode={mode}>
    <header className="topbar kiosk-topbar"><span className="brand" aria-label={t('openMicHome')}><span className="brand-mark"><Sparkles size={17} /></span><span>open mic kiosk</span></span></header>
    <section className="kiosk-body">
      <a className="back-link" href={`/dashboard/series/${seriesId}/events/${eventId}/roster`}>← Back to roster</a>
      {!context.account.data && <ReadState message={t('signInKiosk')} />}
      {context.account.data && <ReadState message="Select an organizer profile to run the kiosk." />}
    </section>
  </main>

  return <div ref={rootRef} className="app kiosk-page" data-theme={theme} data-mode={mode}>
    <KioskLock seriesId={seriesId} eventId={eventId} rootRef={rootRef}>
      {(requestExit) => <>
        <header className="topbar kiosk-topbar"><span className="brand" aria-label={t('openMicHome')}><span className="brand-mark"><Sparkles size={17} /></span><span>open mic kiosk</span></span></header>
        <section className="kiosk-body">
          <h1>{event.data?.title ?? 'Event kiosk'}</h1>

          {event.isPending && <ReadState message="Loading event…" />}
          {event.isError && <ReadState message={friendlyApiErrorMessage(event.error, 'We could not load this event.')} retry={() => void event.refetch()} />}

          {event.data && eventClosed && <div className="profile-context profile-context-warning" role="alert">
            Registration is closed for this event.
          </div>}

          {event.data && !eventClosed && <form className="kiosk-form" noValidate onSubmit={submit}>
            <RequiredFieldsNote />
            <label><span>{t('performerName')}<Required /></span><input ref={nameInputRef} autoFocus required value={performerName} onChange={(input) => setPerformerName(input.target.value)} /></label>
            <label>{t('cityLabel')} <span className="field-hint">{t('optional')}</span><input value={performerCity} onChange={(input) => setPerformerCity(input.target.value)} /></label>
            <label>{t('phoneLabel')} <span className="field-hint">{t('optional')}</span><input type="tel" value={contactPhone} onChange={(input) => setContactPhone(input.target.value)} /></label>
            <label>{t('performancePrompt')} <span className="field-hint">{t('performanceHint')}</span><input value={songNames} onChange={(input) => setSongNames(input.target.value)} /></label>
            <label className="checkbox-label kiosk-checkbox-label"><input type="checkbox" checked={mediaConsent} onChange={(input) => setMediaConsent(input.target.checked)} /><span>{t('mediaConsentPrompt')}</span></label>
            {kioskRegistration.isError && <p className="form-error" role="alert">{kioskErrorMessage(kioskRegistration.error)}</p>}
            {confirmation && <p className="kiosk-success" role="status">{confirmation} ✓</p>}
            <button className="primary-button kiosk-submit" type="submit" disabled={kioskRegistration.isPending}>{kioskRegistration.isPending ? t('loading') : t('addRoster')}</button>
          </form>}
          {event.data && <button type="button" className="link-button kiosk-exit-button" onClick={requestExit}>{t('exitKiosk')}</button>}
        </section>
      </>}
    </KioskLock>
  </div>
}


