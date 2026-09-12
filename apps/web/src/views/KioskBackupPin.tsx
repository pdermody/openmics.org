import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { hashKioskPin, useKioskBackupPinStatus, useSetKioskBackupPin } from '../features/organizer'
import { Required, RequiredFieldsNote } from './shared'

// Shown on both the series edit page and the series details page, so an organizer can set/change
// this series' kiosk backup PIN without having to open the kiosk itself first (see KioskPage.tsx
// for the one-time PIN an organizer chooses each time they start a kiosk session, and
// docs/decisions.md for why the backup PIN lives server-side per series rather than per device).
export function KioskBackupPinSection({ seriesId }: { seriesId: string }) {
  const { t } = useTranslation()
  const status = useKioskBackupPinStatus(seriesId)
  const setBackupPin = useSetKioskBackupPin(seriesId)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  async function save(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault()
    setError('')
    setSaved(false)
    if (draft.trim().length < 4) { setError('Backup PIN must be at least 4 digits.'); return }
    if (draft !== confirm) { setError('Backup PINs do not match.'); return }
    try {
      const hash = await hashKioskPin(draft.trim())
      await setBackupPin.mutateAsync(hash)
      setDraft('')
      setConfirm('')
      setEditing(false)
      setSaved(true)
    } catch {
      setError('Could not save the backup PIN. Please try again.')
    }
  }

  return <div className="kiosk-backup-pin-panel">
    <h2>{t('backupPin')}</h2>
    <p className="field-hint">{t('backupPinHelp')}</p>
    {status.isPending && <p className="field-hint">{t('checkingStatus')}</p>}
    {status.isError && <p className="form-error" role="alert">{t('backupPinStatusError')}</p>}
    {status.isSuccess && !editing && <p>
      <span className={status.data.configured ? 'roster-badge roster-badge-verified' : 'roster-badge roster-badge-warning'}>{status.data.configured ? 'Backup PIN set' : 'No backup PIN set'}</span>
      {' '}
      <button type="button" className="link-button" onClick={() => { setEditing(true); setSaved(false) }}>{status.data.configured ? 'Change backup PIN' : 'Set backup PIN'}</button>
    </p>}
    {saved && !editing && <p className="kiosk-success" role="status">{t('backupSaved')}</p>}
    {editing && <form className="kiosk-form" noValidate onSubmit={(formEvent) => void save(formEvent)}>
      <RequiredFieldsNote />
      <label><span>{t('backupPin')}<Required /></span><input type="password" inputMode="numeric" minLength={4} required value={draft} onChange={(input) => setDraft(input.target.value)} /></label>
      <label><span>{t('confirmBackupPin')}<Required /></span><input type="password" inputMode="numeric" minLength={4} required value={confirm} onChange={(input) => setConfirm(input.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dashboard-series-card-actions">
        <button className="primary-button" type="submit" disabled={setBackupPin.isPending}>{t('saveBackupPin')}</button>
        <button type="button" className="link-button" onClick={() => { setEditing(false); setDraft(''); setConfirm(''); setError('') }}>{t('cancel')}</button>
      </div>
    </form>}
  </div>
}
