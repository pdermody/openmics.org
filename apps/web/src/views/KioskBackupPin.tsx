import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PasswordInput } from '../components/forms/PasswordInput'
import { useKioskBackupPinStatus, useRevealKioskBackupPin, useSetKioskBackupPin } from '../features/organizer'
import { Required, RequiredFieldsNote } from './shared'

// Shown on both the series edit page and the series details page, so an organizer can set/change
// this series' kiosk backup PIN without having to open the kiosk itself first (see KioskPage.tsx
// for the one-time PIN an organizer chooses each time they start a kiosk session, and
// docs/decisions.md for why the backup PIN lives server-side per series rather than per device).
export function KioskBackupPinSection({ seriesId, embedded = false }: { seriesId: string; embedded?: boolean }) {
  const { t } = useTranslation()
  const status = useKioskBackupPinStatus(seriesId)
  const revealBackupPin = useRevealKioskBackupPin(seriesId)
  const setBackupPin = useSetKioskBackupPin(seriesId)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirm, setConfirm] = useState('')
  const [revealedPin, setRevealedPin] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function save() {
    setError('')
    setSaved(false)
    if (draft.trim().length < 4) { setError('Backup PIN must be at least 4 digits.'); return }
    if (draft !== confirm) { setError('Backup PINs do not match.'); return }
    try {
      await setBackupPin.mutateAsync(draft.trim())
      setDraft('')
      setConfirm('')
      setEditing(false)
      setRevealedPin(null)
      revealBackupPin.reset()
      setSaved(true)
    } catch {
      setError('Could not save the backup PIN. Please try again.')
    }
  }

  function toggleSavedPin() {
    if (revealedPin !== null) {
      setRevealedPin(null)
      revealBackupPin.reset()
      return
    }
    revealBackupPin.mutate(undefined, {
      onSuccess: ({ pin }) => setRevealedPin(pin),
    })
  }

  return <div className={`kiosk-backup-pin-panel${embedded ? ' kiosk-backup-pin-panel-embedded' : ''}`}>
    <h2>{t('backupPin')}</h2>
    <p className="field-hint">{t('backupPinHelp')}</p>
    {status.isPending && <p className="field-hint">{t('checkingStatus')}</p>}
    {status.isError && <p className="form-error" role="alert">{t('backupPinStatusError')}</p>}
    {status.isSuccess && <>
      <div className="kiosk-backup-pin-actions">
        <span className={status.data.configured ? 'roster-badge roster-badge-verified' : 'roster-badge roster-badge-warning'}>{status.data.configured ? 'Backup PIN set' : 'No backup PIN set'}</span>
        {!editing && <button type="button" className="quiet-button kiosk-backup-pin-change" onClick={() => { setEditing(true); setSaved(false) }}>{status.data.configured ? 'Change backup PIN' : 'Set backup PIN'}</button>}
        {status.data.configured && <>
          <button type="button" className="link-button kiosk-backup-pin-reveal" aria-pressed={revealedPin !== null} disabled={revealBackupPin.isPending} onClick={toggleSavedPin}>{t(revealedPin !== null ? 'hideSavedPin' : 'showSavedPin')}</button>
        </>}
      </div>
      {revealedPin !== null && <p className="kiosk-revealed-pin" role="status">{revealedPin}</p>}
      {revealBackupPin.isError && <p className="form-error" role="alert">{t('backupPinRevealError')}</p>}
    </>}
    {saved && !editing && <p className="kiosk-success" role="status">{t('backupSaved')}</p>}
    {editing && <div className="kiosk-form">
      {!embedded && <RequiredFieldsNote className="kiosk-backup-pin-required-note" />}
      <label><span>{t('backupPin')}<Required /></span><PasswordInput fieldLabel={t('backupPin')} inputMode="numeric" minLength={4} required value={draft} onChange={(input) => setDraft(input.target.value)} /></label>
      <label><span>{t('confirmBackupPin')}<Required /></span><PasswordInput fieldLabel={t('confirmBackupPin')} inputMode="numeric" minLength={4} required value={confirm} onChange={(input) => setConfirm(input.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dashboard-series-card-actions">
        <button className="primary-button" type="button" onClick={() => void save()} disabled={setBackupPin.isPending}>{t('saveBackupPin')}</button>
        <button type="button" className="link-button" onClick={() => { setEditing(false); setDraft(''); setConfirm(''); setError('') }}>{t('cancel')}</button>
      </div>
    </div>}
  </div>
}
