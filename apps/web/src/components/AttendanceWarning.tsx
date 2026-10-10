import { useTranslation } from 'react-i18next'
import { useAttendanceStatus } from '../features/publicReads'

export function AttendanceWarning({ eventId, phase }: { eventId?: string; phase?: string }) {
  const { t } = useTranslation()
  const attendance = useAttendanceStatus(eventId, phase !== 'past')
  if (!eventId || phase === 'past' || attendance.isPending) return null
  if (attendance.isError || attendance.data?.status === 'incomplete') {
    return <p className="field-hint" role="status">{t('attendanceUnavailable')}</p>
  }
  if (attendance.data?.status !== 'at_capacity') return null
  return <aside className="attendance-warning" role="status">
    <strong>{t('attendanceAtCapacity')}</strong>
    <p>{t('attendanceWarning')}</p>
    <small>{t('attendanceEstimateHint')}</small>
  </aside>
}
