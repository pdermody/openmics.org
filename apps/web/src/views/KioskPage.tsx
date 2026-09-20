import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, MapPin, Sparkles } from 'lucide-react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ApiError, friendlyApiErrorMessage } from '../api/client'
import { RegistrationLinkTools } from '../components/RegistrationLinkTools'
import { hashKioskPin, useEventDetail, useKioskBackupPinStatus, useKioskRegistration, useOrganizerProfile, useSetKioskBackupPin, useVerifyKioskBackupPin } from '../features/organizer'
import { isRegistrationClosed } from '../features/publicReads'
import type { ColorMode, ThemeId } from '../theme'
import { Modal, ReadState, Required, RequiredFieldsNote } from './shared'

const CONFIRMATION_DISPLAY_MS = 2500

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

// Kiosk lock flow: the series PIN is always server-backed. It is configured once by the
// organizer and reused to exit every kiosk session on every device.
type KioskLockPhase = 'loading' | 'setup-backup' | 'active' | 'exit-gate'

export function PinCombinationInput({ onComplete, disabled = false }: { onComplete: (pin: string) => void; disabled?: boolean }) {
  const [digits, setDigits] = useState(['', '', '', ''])
  const inputs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    if (!disabled) inputs.current[0]?.focus()
  }, [disabled])

  function resetInput() {
    setDigits(['', '', '', ''])
    window.setTimeout(() => inputs.current[0]?.focus(), 0)
  }

  function updateDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1)
    if (!digit) return
    const next = [...digits]
    next[index] = digit
    setDigits(next)
    if (index < 3) inputs.current[index + 1]?.focus()
    else {
      onComplete(next.join(''))
      resetInput()
    }
  }

  function handleKeyDown(index: number, event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Backspace') return
    event.preventDefault()
    if (digits[index]) {
      const next = [...digits]
      next[index] = ''
      setDigits(next)
      return
    }
    if (index > 0) {
      const next = [...digits]
      next[index - 1] = ''
      setDigits(next)
      inputs.current[index - 1]?.focus()
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4)
    if (!pasted) return
    event.preventDefault()
    const next = [...digits]
    pasted.split('').forEach((digit, index) => { next[index] = digit })
    setDigits(next)
    const lastIndex = pasted.length - 1
    if (pasted.length === 4) {
      onComplete(next.join(''))
      resetInput()
    }
    else inputs.current[lastIndex + 1]?.focus()
  }

  return <div className="pin-combination" role="group" aria-label="4 digit PIN">
    {digits.map((digit, index) => <input
      key={index}
      ref={(input) => { inputs.current[index] = input }}
      type="password"
      inputMode="numeric"
      pattern="[0-9]"
      maxLength={1}
      autoComplete={index === 0 ? 'one-time-code' : 'off'}
      aria-label={`PIN digit ${index + 1}`}
      value={digit}
      disabled={disabled}
      autoFocus={index === 0}
      onChange={(event) => updateDigit(index, event.target.value)}
      onKeyDown={(event) => handleKeyDown(index, event)}
      onPaste={handlePaste}
    />)}
  </div>
}

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
  const navigate = useNavigate()
  const backupPinStatus = useKioskBackupPinStatus(seriesId)
  const setBackupPin = useSetKioskBackupPin(seriesId)
  const verifyBackupPin = useVerifyKioskBackupPin(seriesId)

  const [phase, setPhase] = useState<KioskLockPhase>('loading')
  const [backupPinDraft, setBackupPinDraft] = useState('')
  const [backupPinConfirm, setBackupPinConfirm] = useState('')
  const [error, setError] = useState('')

  // Once a server PIN exists, enter kiosk mode immediately. There is no per-session PIN.
  const effectivePhase: KioskLockPhase = phase === 'loading' && backupPinStatus.isSuccess
    ? (backupPinStatus.data.configured ? 'active' : 'setup-backup')
    : phase
  const phaseRef = useRef(effectivePhase)
  phaseRef.current = effectivePhase

  useEffect(() => {
    if (effectivePhase !== 'active') return
    const requestFullscreen = rootRef.current?.requestFullscreen
    if (requestFullscreen) void requestFullscreen.call(rootRef.current).catch(() => undefined)
  }, [effectivePhase, rootRef])

  // If a bystander exits fullscreen without going through the "Exit kiosk" PIN gate (e.g. the Esc
  // key), fall back to the same PIN gate rather than silently revealing the roster underneath.
  useEffect(() => {
    function onFullscreenChange() {
      if (!document.fullscreenElement) setPhase((current) => (current === 'active' ? 'exit-gate' : current))
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => {
    // Keep browser Back inside the kiosk until the server PIN has been verified. Browser chrome
    // controls cannot be disabled by a web page, but this catches same-document navigation and
    // prevents an accidental Back press from exposing the organizer roster.
    window.history.replaceState({ ...window.history.state, kiosk: true }, '', window.location.href)
    window.history.pushState({ kiosk: true }, '', window.location.href)

    function trapKioskNavigation() {
      // Restore the sentinel entry immediately after the browser starts a Back traversal. This
      // keeps the document in place even when the previous history entry belongs to another page.
      window.history.go(1)
      if (phaseRef.current === 'active') setPhase('exit-gate')
    }

    function trapEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (phaseRef.current === 'active' || phaseRef.current === 'exit-gate') {
        setPhase(phaseRef.current === 'active' ? 'exit-gate' : 'active')
      }
    }

    window.addEventListener('popstate', trapKioskNavigation)
    window.addEventListener('keydown', trapEscape, true)
    return () => {
      window.removeEventListener('popstate', trapKioskNavigation)
      window.removeEventListener('keydown', trapEscape, true)
    }
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
      setPhase('active')
    } catch {
      setError('Could not save the backup PIN. Please try again.')
    }
  }

  async function submitExitPin(entered: string) {
    setError('')
    try {
      const hash = await hashKioskPin(entered)
      const result = await verifyBackupPin.mutateAsync(hash)
      if (!result.valid) { setError('Incorrect PIN.'); return }
      if (document.fullscreenElement) { try { await document.exitFullscreen() } catch { /* already released */ } }
      void navigate({ to: '/dashboard/series/$seriesId/events/$eventId/roster', params: { seriesId, eventId } })
    } catch {
      setError('Could not check that PIN. Please try again.')
    }
  }

  if (effectivePhase === 'loading' && backupPinStatus.isError) return <div className="kiosk-lock-screen">
    <ReadState message={friendlyApiErrorMessage(backupPinStatus.error, 'We could not load this kiosk\'s settings.')} retry={() => void backupPinStatus.refetch()} />
    <Link className="back-link" to="/dashboard/series/$seriesId/events/$eventId/roster" params={{ seriesId, eventId }}>← Back to roster</Link>
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
    <Link className="back-link" to="/dashboard/series/$seriesId/events/$eventId/roster" params={{ seriesId, eventId }}>← Back to roster</Link>
  </div>

  if (effectivePhase === 'exit-gate') return <div className="kiosk-lock-screen kiosk-exit-gate">
    <h1>{t('enterExitPin')}</h1>
    <p>{t('serverPinExitIntro')}</p>
    <PinCombinationInput onComplete={(pin) => void submitExitPin(pin)} disabled={verifyBackupPin.isPending} />
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>

  // phase === 'active'
  return <>{children(() => setPhase('exit-gate'))}</>
}

// A dedicated high-contrast, large-touch-target page an organizer hands to performers (or
// runs themselves) at the door: no account/email required from the performer, and the form
// resets itself right after each successful entry so the next performer can sign up quickly.
export function KioskPage({ seriesId, eventId, theme, mode }: { seriesId: string; eventId: string; theme: ThemeId; mode: ColorMode }) {
  const { t, i18n } = useTranslation()
  const { context, isOrganizer } = useOrganizerProfile()
  const event = useEventDetail(seriesId, eventId)
  const kioskRegistration = useKioskRegistration(eventId)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const emailInputRef = useRef<HTMLInputElement>(null)
  const confirmationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const rootRef = useRef<HTMLDivElement>(null)

  const [performerName, setPerformerName] = useState('')
  const [performerCity, setPerformerCity] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [songNames, setSongNames] = useState('')
  const [bio, setBio] = useState('')
  const [mediaConsent, setMediaConsent] = useState(true)
  const [confirmation, setConfirmation] = useState('')
  const [emailPromptOpen, setEmailPromptOpen] = useState(false)

  const eventClosed = Boolean(event.data) && isRegistrationClosed(event.data!)

  function resetForm() {
    setPerformerName('')
    setPerformerCity('')
    setContactEmail('')
    setContactPhone('')
    setSongNames('')
    setBio('')
    setMediaConsent(true)
    nameInputRef.current?.focus()
  }

  function performSubmit() {
    const submittedName = performerName.trim()
    kioskRegistration.mutate(
      {
        performer_name: submittedName,
        performer_city: performerCity.trim() || undefined,
        contact_email: contactEmail.trim() || undefined,
        contact_phone: contactPhone.trim() || undefined,
        song_names: songNames.split(',').map((song) => song.trim()).filter(Boolean),
        bio: bio.trim() || undefined,
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

  function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault()
    if (!performerName.trim()) return
    // No email? Explain why one helps before recording a sign-up with no way to follow up.
    if (!contactEmail.trim()) { setEmailPromptOpen(true); return }
    performSubmit()
  }

  if (!isOrganizer) return <main className="app kiosk-page" data-theme={theme} data-mode={mode}>
    <header className="topbar kiosk-topbar"><span className="brand" aria-label={t('openMicHome')}><span className="brand-mark"><Sparkles size={17} /></span><span>open mic kiosk</span></span></header>
    <section className="kiosk-body">
      <Link className="back-link" to="/dashboard/series/$seriesId/events/$eventId/roster" params={{ seriesId, eventId }}>← Back to roster</Link>
      {!context.account.data && <ReadState message={t('signInKiosk')} />}
      {context.account.data && <ReadState message="Select an organizer profile to run the kiosk." />}
    </section>
  </main>

  return <div ref={rootRef} className="app kiosk-page" data-theme={theme} data-mode={mode}>
    <KioskLock seriesId={seriesId} eventId={eventId} rootRef={rootRef}>
      {(requestExit) => <>
        <header className="topbar kiosk-topbar"><button type="button" className="brand" aria-label={t('exitKiosk')} onClick={requestExit}><span className="brand-mark"><Sparkles size={17} /></span><span>open mic kiosk</span></button></header>
        <section className="kiosk-body">
          <div className="eyebrow">{t('kioskPageEyebrow')}</div>
          <h1>{event.data?.title ?? 'Event kiosk'}</h1>
          <p className="detail-lede">{t('kioskPageIntro')}</p>
          {event.data && <div className="registration-event-summary" aria-label={t('eventDetails')}>
            <p className="registration-event-fact"><CalendarDays size={17} aria-hidden="true" /><strong>{formatEventDateTime(event.data.starts_at, event.data.time_zone, i18n.language)}</strong></p>
            <p className="registration-event-fact"><MapPin size={17} aria-hidden="true" /><span>{event.data.venue_name}, {event.data.city}</span></p>
          </div>}

          {event.data && <details className="kiosk-registration-qr">
            <summary>{t('kioskRegistrationQrTitle')}</summary>
            <p>{t('kioskRegistrationQrIntro')}</p>
            <div className="kiosk-registration-qr-grid">
              <RegistrationLinkTools
                url={`${window.location.origin}/events/${event.data.id}/register`}
                fileName={event.data.public_code}
                title={t('registerForThisEvent')}
                showPreview
              />
              <RegistrationLinkTools
                url={`${window.location.origin}/open-mics/${seriesId}/register`}
                fileName={seriesId}
                title={t('registerForAnyEvent')}
                showPreview
              />
            </div>
          </details>}

          {event.isPending && <ReadState message="Loading event…" />}
          {event.isError && <ReadState message={friendlyApiErrorMessage(event.error, 'We could not load this event.')} retry={() => void event.refetch()} />}

          {event.data && eventClosed && <div className="profile-context profile-context-warning" role="alert">
            Registration is closed for this event.
          </div>}

          {event.data && !eventClosed && <form className="kiosk-form" noValidate onSubmit={submit}>
            <RequiredFieldsNote />
            <label><span>{t('performerName')}<Required /></span> <span className="field-hint">{t('kioskNameHint')}</span><input ref={nameInputRef} autoFocus required value={performerName} onChange={(input) => setPerformerName(input.target.value)} /></label>
            <label>{t('cityLabel')} <span className="field-hint">{t('kioskCityHint')}</span><input value={performerCity} onChange={(input) => setPerformerCity(input.target.value)} /></label>
            <label>{t('phoneLabel')} <span className="field-hint">{t('kioskPhoneHint')}</span><input type="tel" value={contactPhone} onChange={(input) => setContactPhone(input.target.value)} /></label>
            <label>{t('kioskEmailLabel')} <span className="field-hint">{t('kioskEmailHint')}</span><input ref={emailInputRef} type="email" value={contactEmail} onChange={(input) => setContactEmail(input.target.value)} /></label>
            <label>{t('performancePrompt')} <span className="field-hint">{t('kioskPerformanceHint')}</span><input value={songNames} onChange={(input) => setSongNames(input.target.value)} /></label>
            <label>{t('bio')} <span className="field-hint">{t('kioskBioHint')}</span><textarea value={bio} onChange={(input) => setBio(input.target.value)} /></label>
            <label className="checkbox-label kiosk-checkbox-label"><input type="checkbox" checked={mediaConsent} onChange={(input) => setMediaConsent(input.target.checked)} /><span>{t('mediaConsentPrompt')}</span></label>
            {kioskRegistration.isError && <p className="form-error" role="alert">{kioskErrorMessage(kioskRegistration.error)}</p>}
            {confirmation && <p className="kiosk-success" role="status">{confirmation} ✓</p>}
            <button className="primary-button kiosk-submit" type="submit" disabled={kioskRegistration.isPending}>{kioskRegistration.isPending ? t('loading') : t('addRoster')}</button>
          </form>}
          {emailPromptOpen && <Modal title={t('kioskEmailPromptTitle')} onClose={() => setEmailPromptOpen(false)}>
            <p>{t('kioskEmailPromptIntro')}</p>
            <ul className="kiosk-email-prompt-benefits">
              <li>{t('kioskEmailPromptBenefit1')}</li>
              <li>{t('kioskEmailPromptBenefit2')}</li>
              <li>{t('kioskEmailPromptBenefit3')}</li>
              <li>{t('kioskEmailPromptBenefit4')}</li>
            </ul>
            <div className="dashboard-series-card-actions">
              <button type="button" className="link-button" onClick={() => { setEmailPromptOpen(false); performSubmit() }}>{t('kioskEmailPromptContinue')}</button>
              <button type="button" className="primary-button" onClick={() => { setEmailPromptOpen(false); emailInputRef.current?.focus() }}>{t('kioskEmailPromptAddEmail')}</button>
            </div>
          </Modal>}
        </section>
      </>}
    </KioskLock>
  </div>
}


