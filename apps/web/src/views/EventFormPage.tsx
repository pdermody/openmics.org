import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type UseFormSetError } from 'react-hook-form'
import { z } from 'zod'
import { Sparkles } from 'lucide-react'
import { ApiError } from '../api/client'
import { LocationPicker } from '../components/location/LocationPicker'
import { useCreateEvent, useEventDetail, useOpenMicDetail, useOrganizerProfile, useUpdateEvent, type EventFormInput } from '../features/organizer'
import { CURRENCIES } from '../features/currencies'
import { baseLocationFieldsSchema } from '../features/location'
import type { ColorMode, ThemeId } from '../theme'
import { HeaderMenu, ProfileSwitcher, ReadState, Required, RequiredFieldsNote, SignInButton } from './shared'

const ACTIVITIES = ['singing', 'poetry', 'jam', 'trad', 'comedy', 'storytelling', 'other'] as const

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromDatetimeLocalValue(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

const eventFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Event title is required'),
    starts_at: z.string().min(1, 'Start time is required'),
    ends_at: z.string().optional(),
    time_zone: z.string().trim().min(1, 'Time zone is required'),
    registrations_closed_at: z.string().optional(),
    capacity: z.string().optional(),
    override_location: z.boolean(),
    venue_name: z.string().trim().optional(),
    activities: z.array(z.string()).optional(),
    tags: z.string().optional(),
    notes: z.string().trim().optional(),
    entry_fee_amount: z.string().optional(),
    entry_fee_currency: z.string().optional(),
    entry_fee_note: z.string().trim().optional(),
  })
  .extend(baseLocationFieldsSchema.shape)
  .extend({
    address_line1: z.string().trim().optional(),
    city: z.string().trim().optional(),
    country: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.lat === undefined) !== (value.lng === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Latitude and longitude must be set together', path: ['lng'] })
    }
    if (value.override_location) {
      if (!value.venue_name) ctx.addIssue({ code: 'custom', message: 'Venue name is required', path: ['venue_name'] })
      if (!value.address_line1) ctx.addIssue({ code: 'custom', message: 'Address is required', path: ['address_line1'] })
      if (!value.city) ctx.addIssue({ code: 'custom', message: 'City is required', path: ['city'] })
      if (!value.country) {
        ctx.addIssue({ code: 'custom', message: 'Country is required', path: ['country'] })
      } else if (!/^[A-Za-z]{2}$/.test(value.country)) {
        ctx.addIssue({ code: 'custom', message: 'Use a two-letter country code, e.g. IE', path: ['country'] })
      }
      if (value.lat === undefined) ctx.addIssue({ code: 'custom', message: 'Latitude is required', path: ['lat'] })
      if (value.lng === undefined) ctx.addIssue({ code: 'custom', message: 'Longitude is required', path: ['lng'] })
    }
    const feeAmount = value.entry_fee_amount ? Number(value.entry_fee_amount) : 0
    if (feeAmount > 0 && !value.entry_fee_currency) {
      ctx.addIssue({ code: 'custom', message: 'Select a currency for the entry fee', path: ['entry_fee_currency'] })
    }
  })

type EventFormValues = z.infer<typeof eventFormSchema>

const DEFAULT_VALUES: EventFormValues = {
  title: '',
  starts_at: '',
  ends_at: '',
  time_zone: '',
  registrations_closed_at: '',
  capacity: '',
  override_location: false,
  venue_name: '',
  address_line1: '',
  address_line2: '',
  postcode: '',
  city: '',
  country: '',
  lat: undefined,
  lng: undefined,
  activities: [],
  tags: '',
  notes: '',
  entry_fee_amount: '',
  entry_fee_currency: '',
  entry_fee_note: '',
}

function eventErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'We could not save this event. Please try again.'
  const fieldErrors = (error.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors
  const firstField = fieldErrors && Object.keys(fieldErrors)[0]
  if (firstField) return `${firstField.replace(/_/g, ' ')}: ${fieldErrors![firstField][0]}`
  return 'Please check the fields below and try again.'
}

function applyServerFieldErrors(error: unknown, setError: UseFormSetError<EventFormValues>): void {
  if (!(error instanceof ApiError)) return
  const fieldErrors = (error.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors
  if (!fieldErrors) return
  Object.entries(fieldErrors).forEach(([field, messages]) => {
    setError(field as keyof EventFormValues, { type: 'server', message: messages[0] })
  })
}

export function EventFormPage({ seriesId, eventId, theme, mode }: { seriesId: string; eventId?: string; theme: ThemeId; mode: ColorMode }) {
  const { t } = useTranslation()
  const isEdit = Boolean(eventId)
  const { context, activeProfile, isOrganizer } = useOrganizerProfile()
  const openMic = useOpenMicDetail(seriesId)
  const existing = useEventDetail(seriesId, eventId)
  const createEvent = useCreateEvent(seriesId)
  const updateEvent = useUpdateEvent(seriesId, eventId)

  const { register, handleSubmit, watch, setValue, setError, reset, formState } = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: DEFAULT_VALUES,
  })
  const { errors, isDirty } = formState

  const overrideLocation = watch('override_location')
  const lat = watch('lat')
  const lng = watch('lng')
  const addressLine1 = watch('address_line1')
  const city = watch('city')
  const country = watch('country')
  const postcode = watch('postcode')
  const activities = watch('activities') ?? []
  const entryFeeAmount = watch('entry_fee_amount')

  // Prefill sensible defaults from the parent series when creating a new event.
  useEffect(() => {
    if (isEdit || !openMic.data) return
    setValue('time_zone', openMic.data.time_zone)
    setValue('activities', openMic.data.activities)
  }, [isEdit, openMic.data, setValue])

  useEffect(() => {
    if (!existing.data) return
    reset({
      title: existing.data.title,
      starts_at: toDatetimeLocalValue(existing.data.starts_at),
      ends_at: toDatetimeLocalValue(existing.data.ends_at),
      time_zone: existing.data.time_zone,
      registrations_closed_at: toDatetimeLocalValue(existing.data.registrations_closed_at),
      capacity: existing.data.capacity ? String(existing.data.capacity) : '',
      override_location: true,
      venue_name: existing.data.venue_name,
      address_line1: existing.data.address_line1,
      address_line2: existing.data.address_line2 ?? '',
      postcode: existing.data.postcode ?? '',
      city: existing.data.city,
      country: existing.data.country,
      lat: existing.data.lat ?? undefined,
      lng: existing.data.lng ?? undefined,
      activities: existing.data.activities ?? [],
      tags: (existing.data.tags ?? []).join(', '),
      notes: existing.data.notes ?? '',
      entry_fee_amount: existing.data.entry_fee_amount ? String(existing.data.entry_fee_amount) : '',
      entry_fee_currency: existing.data.entry_fee_currency ?? '',
      entry_fee_note: existing.data.entry_fee_note ?? '',
    })
  }, [existing.data, reset])

  useEffect(() => {
    if (!isDirty) return
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  function toggleActivity(activity: string) {
    const next = activities.includes(activity) ? activities.filter((item) => item !== activity) : [...activities, activity]
    setValue('activities', next, { shouldDirty: true, shouldValidate: true })
  }

  const mutation = isEdit ? updateEvent : createEvent

  useEffect(() => {
    if (mutation.error) applyServerFieldErrors(mutation.error, setError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutation.error])

  function onSubmit(values: EventFormValues) {
    const input: EventFormInput = {
      title: values.title,
      starts_at: fromDatetimeLocalValue(values.starts_at)!,
      ends_at: fromDatetimeLocalValue(values.ends_at ?? ''),
      time_zone: values.time_zone,
      registrations_closed_at: values.registrations_closed_at
        ? fromDatetimeLocalValue(values.registrations_closed_at)
        : isEdit ? null : undefined,
      capacity: values.capacity ? Number(values.capacity) : undefined,
      activities: values.activities && values.activities.length > 0 ? values.activities : undefined,
      tags: (values.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean),
      notes: values.notes || undefined,
      entry_fee_amount: values.entry_fee_amount ? Number(values.entry_fee_amount) : undefined,
      entry_fee_currency: values.entry_fee_currency || undefined,
      entry_fee_note: values.entry_fee_note || undefined,
      ...(values.override_location ? {
        venue_name: values.venue_name,
        address_line1: values.address_line1,
        address_line2: values.address_line2 || undefined,
        postcode: values.postcode || undefined,
        city: values.city,
        country: values.country?.toUpperCase(),
        lat: values.lat,
        lng: values.lng,
      } : {}),
    }
    if (isEdit) {
      updateEvent.mutate(input, { onSuccess: () => reset(values) })
    } else {
      createEvent.mutate(input, {
        onSuccess: (created) => { reset(values); window.location.href = `/events/${created.public_code}` },
      })
    }
  }

  function toggleRegistrationAvailability() {
    setValue('registrations_closed_at', watch('registrations_closed_at') ? '' : toDatetimeLocalValue(new Date().toISOString()), { shouldDirty: true })
  }

  if (context.account.isPending || context.profiles.isPending || openMic.isPending || (isEdit && existing.isPending)) {
    return <main className="app" data-theme={theme} data-mode={mode}><ReadState message={t('loading')} /></main>
  }
  const isOwner = !openMic.data || openMic.data.owner_profile_id === activeProfile?.id
  if (!context.account.data || !isOrganizer || (openMic.data && !isOwner)) {
    return <main className="app" data-theme={theme} data-mode={mode}>
      <header className="topbar"><a className="brand" href="/" aria-label={t('openMicHome')}><span className="brand-mark"><Sparkles size={17} /></span><span>{t("appName")}</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
      <section className="dashboard-page"><ReadState message={t('selectOrganizer')} /></section>
    </main>
  }
  if (openMic.isError || (isEdit && existing.isError)) {
    return <main className="app" data-theme={theme} data-mode={mode}><ReadState message={t('eventLoadError')} retry={() => { void openMic.refetch(); void existing.refetch() }} /></main>
  }

  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><a className="brand" href="/" aria-label={t('openMicHome')}><span className="brand-mark"><Sparkles size={17} /></span><span>{t("appName")}</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
    <section className="dashboard-page">
      <a className="back-link" href={`/dashboard/series/${seriesId}`}>← Back to {openMic.data?.name ?? 'series'}</a>
      <div className="eyebrow">{t('organizerWorkspace')}</div>
      <h1>{isEdit ? `Edit ${existing.data?.title ?? 'event'}` : `New event for ${openMic.data?.name ?? 'this series'}`}</h1>
      <form className="registration-form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <RequiredFieldsNote />
        <label><span>{t('eventTitle')}<Required /></span><input required {...register('title')} /></label>
        {errors.title && <p className="form-error" role="alert">{errors.title.message}</p>}
        <label><span>{t('startsAt')}<Required /></span><input required type="datetime-local" {...register('starts_at')} /></label>
        {errors.starts_at && <p className="form-error" role="alert">{errors.starts_at.message}</p>}
        <label>Ends at <span className="field-hint">{t('optional')}</span><input type="datetime-local" {...register('ends_at')} /></label>
        <label><span>{t('timeZone')}<Required /></span> <span className="field-hint">{t('timeZoneHint')}</span><input required {...register('time_zone')} /></label>
        {errors.time_zone && <p className="form-error" role="alert">{errors.time_zone.message}</p>}
        <label>Capacity <span className="field-hint">{t('optional')} · leave blank for unlimited</span><input type="number" min="1" {...register('capacity')} /></label>

        <label>{t('closeAt')} <span className="field-hint">{t('closeAtHint')}</span><input type="datetime-local" {...register('registrations_closed_at')} /></label>
        <button className="quiet-button" type="button" onClick={toggleRegistrationAvailability}>{watch('registrations_closed_at') ? t('reopenRegistrations') : t('stopRegistrations')}</button>

        <label className="checkbox-label"><input type="checkbox" disabled={isEdit} {...register('override_location')} /><span>Use a different location for this event {!isEdit && '(otherwise it inherits the series venue)'}</span></label>
        {overrideLocation && <>
          <label><span>{t('venueName')}<Required /></span><input required {...register('venue_name')} /></label>
          {errors.venue_name && <p className="form-error" role="alert">{errors.venue_name.message}</p>}
          <label><span>{t('address')}<Required /></span><input required {...register('address_line1')} /></label>
          {errors.address_line1 && <p className="form-error" role="alert">{errors.address_line1.message}</p>}
          <label>Address line 2 <span className="field-hint">{t('optional')}</span><input {...register('address_line2')} /></label>
          <label>{t('postcode')} <span className="field-hint">{t('optional')}</span><input {...register('postcode')} /></label>
          <label><span>{t('city')}<Required /></span><input required {...register('city')} /></label>
          {errors.city && <p className="form-error" role="alert">{errors.city.message}</p>}
          <label><span>{t('country')}<Required /></span> <span className="field-hint">Two-letter code, e.g. IE</span><input required maxLength={2} {...register('country')} /></label>
          {errors.country && <p className="form-error" role="alert">{errors.country.message}</p>}

          <LocationPicker
            lat={lat}
            lng={lng}
            onChange={({ lat: nextLat, lng: nextLng }) => {
              setValue('lat', nextLat, { shouldDirty: true, shouldValidate: true })
              setValue('lng', nextLng, { shouldDirty: true, shouldValidate: true })
            }}
            addressQuery={[addressLine1, postcode, city, country].filter(Boolean).join(', ')}
            latInputId="event-lat"
            lngInputId="event-lng"
          />
          {errors.lat && <p className="form-error" role="alert">{errors.lat.message}</p>}
          {errors.lng && <p className="form-error" role="alert">{errors.lng.message}</p>}
        </>}

        <fieldset>
          <legend>{t('activities')}</legend>
          {ACTIVITIES.map((activity) => (
            <label className="checkbox-label" key={activity}><input type="checkbox" checked={activities.includes(activity)} onChange={() => toggleActivity(activity)} /><span>{activity}</span></label>
          ))}
        </fieldset>
        <label>{t('tags')} <span className="field-hint">{t('optional')} · separate with commas</span><input {...register('tags')} /></label>
        <label>{t('notes')} <span className="field-hint">{t('optional')} · shown to the public</span><textarea {...register('notes')} /></label>

        <label>{t('entryFee')} <span className="field-hint">{t('entryFeeHint')}</span><input type="number" min="0" step="0.01" {...register('entry_fee_amount')} /></label>
        {Number(entryFeeAmount) > 0 && <label><span>{t('entryFeeCurrency')}<Required /></span><select required {...register('entry_fee_currency')}><option value="">{t('selectCurrency')}</option>{CURRENCIES.map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label>}
        {errors.entry_fee_currency && <p className="form-error" role="alert">{errors.entry_fee_currency.message}</p>}
        <label>{t('entryFeeNote')} <span className="field-hint">{t('optional')}</span><input {...register('entry_fee_note')} /></label>

        {mutation.isError && <p className="form-error" role="alert">{eventErrorMessage(mutation.error)}</p>}
        {mutation.isSuccess && isEdit && <p className="form-success" role="status">{t('saved')}</p>}
        <button className="primary-button" type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create event'}</button>
      </form>
    </section>
  </main>
}
