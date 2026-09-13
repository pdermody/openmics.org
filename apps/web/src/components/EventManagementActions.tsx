import { useState } from 'react'
import { Pause, Play, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ActionMenu, type ActionMenuItem } from './ActionMenu'
import { useDeleteEvent, useSetEventRunning } from '../features/organizer'
import { Modal } from '../views/shared'

export function EventManagementActions({ openMicId, eventId, running, onDeleted, navigationItems = [] }: { openMicId: string; eventId: string; running?: boolean | null; onDeleted?: () => void; navigationItems?: ActionMenuItem[] }) {
  const { t } = useTranslation()
  const updateRunning = useSetEventRunning(openMicId, eventId)
  const deleteEvent = useDeleteEvent(openMicId, eventId)
  const [confirmation, setConfirmation] = useState<'pause' | 'resume' | 'delete' | null>(null)
  const actionLabel = confirmation === 'pause' ? t('confirmPauseEvent') : confirmation === 'resume' ? t('confirmResumeEvent') : t('confirmDeleteEvent')

  return <>
    <ActionMenu label={t('eventActions')} items={[...navigationItems, ...[
      { label: running === false ? t('continueEvent') : t('pauseEvent'), icon: running === false ? <Play size={16} /> : <Pause size={16} />, onClick: () => setConfirmation(running === false ? 'resume' : 'pause'), disabled: updateRunning.isPending },
      { label: t('deleteEvent'), icon: <Trash2 size={16} />, onClick: () => setConfirmation('delete'), disabled: deleteEvent.isPending },
    ]]} />
    {confirmation && <Modal title={t('confirmAction')} onClose={() => setConfirmation(null)}>
      <p>{actionLabel}</p>
      <div className="dashboard-series-card-actions"><button type="button" className="quiet-button" onClick={() => { if (confirmation === 'delete') deleteEvent.mutate(undefined, { onSuccess: onDeleted }); else updateRunning.mutate(confirmation === 'resume'); setConfirmation(null) }}>{t('confirm')}</button><button type="button" className="link-button" onClick={() => setConfirmation(null)}>{t('cancel')}</button></div>
    </Modal>}
  </>
}