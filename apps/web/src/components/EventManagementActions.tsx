import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ActionMenu, type ActionMenuItem } from './ActionMenu'
import { useDeleteEvent } from '../features/organizer'
import { Modal } from '../views/shared'

export function EventManagementActions({ openMicId, eventId, onDeleted, navigationItems = [] }: { openMicId: string; eventId: string; onDeleted?: () => void; navigationItems?: ActionMenuItem[] }) {
  const { t } = useTranslation()
  const deleteEvent = useDeleteEvent(openMicId, eventId)
  const [confirmation, setConfirmation] = useState(false)

  return <>
    <ActionMenu label={t('eventActions')} items={[...navigationItems, { label: t('deleteEvent'), icon: <Trash2 size={16} />, onClick: () => setConfirmation(true), disabled: deleteEvent.isPending }]} />
    {confirmation && <Modal title={t('confirmAction')} onClose={() => setConfirmation(false)}>
      <p>{t('confirmDeleteEvent')}</p>
      <div className="dashboard-series-card-actions"><button type="button" className="quiet-button" onClick={() => { deleteEvent.mutate(undefined, { onSuccess: onDeleted }); setConfirmation(false) }}>{t('confirm')}</button><button type="button" className="link-button" onClick={() => setConfirmation(false)}>{t('cancel')}</button></div>
    </Modal>}
  </>
}