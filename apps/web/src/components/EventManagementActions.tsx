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
  const [confirmation, setConfirmation] = useState<'start' | 'pause' | 'resume' | 'delete' | null>(null)
  const actionLabel = confirmation === 'start' ? t('confirmStartEvent') : confirmation === 'pause' ? t('confirmStopEvent') : confirmation === 'resume' ? t('confirmRestartEvent') : t('confirmDeleteEvent')
  const runAction = running === null || running === undefined ? 'start' : running ? 'pause' : 'resume'

  return <>
    <ActionMenu label={t('eventActions')} items={[...navigationItems, ...[
      { label: runAction === 'start' ? t('startEvent') : runAction === 'resume' ? t('restartEvent') : t('stopEvent'), icon: runAction === 'pause' ? <Pause size={16} /> : <Play size={16} />, onClick: () => setConfirmation(runAction), disabled: updateRunning.isPending },
      { label: t('deleteEvent'), icon: <Trash2 size={16} />, onClick: () => setConfirmation('delete'), disabled: deleteEvent.isPending },
    ]]} />
    {confirmation && <Modal title={t('confirmAction')} onClose={() => setConfirmation(null)}>
      <p>{actionLabel}</p>
      <div className="dashboard-series-card-actions"><button type="button" className="quiet-button" onClick={() => { if (confirmation === 'delete') deleteEvent.mutate(undefined, { onSuccess: onDeleted }); else updateRunning.mutate(confirmation !== 'pause'); setConfirmation(null) }}>{t('confirm')}</button><button type="button" className="link-button" onClick={() => setConfirmation(null)}>{t('cancel')}</button></div>
    </Modal>}
  </>
}