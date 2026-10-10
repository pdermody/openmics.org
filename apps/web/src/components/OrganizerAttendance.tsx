import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'
import { useOrganizerAttendance, useSaveAudienceCount } from '../features/organizer'
import { friendlyApiErrorMessage } from '../api/client'

function AudienceForm({ eventId, count }: { eventId: string; count: number | null }) {
  const { t } = useTranslation()
  const schema = z.object({ count: z.number().int(t('audienceCountInvalid')).min(0, t('audienceCountInvalid')).max(2147483647) })
  const { register, handleSubmit, formState: { errors } } = useForm<{ count: number }>({
    resolver: zodResolver(schema), defaultValues: count === null ? {} : { count },
  })
  const save = useSaveAudienceCount(eventId)
  return <form onSubmit={handleSubmit((values) => save.mutate(values.count))}>
    <label>{t('audienceGuests')}<input type="number" min="0" step="1" {...register('count', { valueAsNumber: true })} /></label>
    <p className="field-hint">{t('audienceGuestsHint')}</p>
    {errors.count && <p role="alert">{errors.count.message}</p>}
    {save.isError && <p role="alert">{friendlyApiErrorMessage(save.error)}</p>}
    <button className="quiet-button" type="submit" disabled={save.isPending}>{t('saveAudienceGuests')}</button>
  </form>
}

export function OrganizerAttendance({ eventId }: { eventId: string }) {
  const { t } = useTranslation()
  const attendance = useOrganizerAttendance(eventId, true)
  return <section className="attendance-warning">
    <h2>{t('suggestedAttendanceLimit')}</h2>
    {attendance.isPending && <p role="status">{t('loading')}</p>}
    {attendance.isError && <p role="alert">{friendlyApiErrorMessage(attendance.error)} <button type="button" onClick={() => void attendance.refetch()}>{t('discoveryRetry')}</button></p>}
    {attendance.data && <>
      <p>{t('attendanceSummary', {
        performers: attendance.data.confirmed_performers,
        guests: attendance.data.audience_guest_count ?? t('publicNotSpecified'),
        estimate: attendance.data.attendance_estimate ?? t('publicNotSpecified'),
        limit: attendance.data.capacity ?? t('publicNotSpecified'),
      })}</p>
      {attendance.data.status === 'at_capacity' && <p>{t('attendanceAtCapacity')} {t('attendanceWarning')}</p>}
      {attendance.data.status === 'incomplete' && <p>{t('attendanceUnavailable')}</p>}
      <AudienceForm key={attendance.data.audience_guest_count ?? 'unknown'} eventId={eventId} count={attendance.data.audience_guest_count} />
    </>}
  </section>
}
