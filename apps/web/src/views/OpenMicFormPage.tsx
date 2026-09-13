import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type UseFormSetError } from 'react-hook-form'
import { z } from 'zod'
import { CircleAlert, CircleCheck, Sparkles } from 'lucide-react'
import { ApiError } from '../api/client'
import { LocationPicker } from '../components/location/LocationPicker'
import { useHandleAvailability } from '../features/handles'
import { CURRENCIES } from '../features/currencies'
import { baseLocationFieldsSchema } from '../features/location'
import { useCreateOpenMic, useOpenMicDetail, useOrganizerProfile, useUpdateOpenMic, type OpenMicFormInput } from '../features/organizer'
import { suggestHandle } from '../features/slugify'
import type { ColorMode, ThemeId } from '../theme'
import { KioskBackupPinSection } from './KioskBackupPin'
import { HeaderMenu, ProfileSwitcher, ReadState, Required, RequiredFieldsNote, SignInButton } from './shared'

const ACTIVITIES = ['singing', 'poetry', 'jam', 'trad', 'comedy', 'storytelling', 'other'] as const

const openMicFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Series name is required'),
    description: z.string().trim().optional(),
    handle: z.string().trim().optional(),
    venue_name: z.string().trim().min(1, 'Venue name is required'),
    time_zone: z.string().trim().min(1, 'Time zone is required'),
    website: z.union([z.literal(''), z.string().trim().url('Enter a valid URL, e.g. https://example.com')]).optional(),
    contact_email: z.union([z.literal(''), z.string().trim().email('Please enter a valid email address, such as you@example.com.')]).optional(),
    schedule_summary: z.string().trim().optional(),
    schedule_details: z.string().trim().optional(),
    originals_only: z.boolean(),
    amplification_available: z.boolean(),
    age_policy: z.enum(['adults_only', 'children_only', 'both']),
    activities: z.array(z.string()).min(1, 'Select at least one activity'),
    tags: z.string().optional(),
    registration_mode: z.enum(['pre_only', 'on_night_only', 'both', 'external']),
    external_registration_url: z.string().trim().optional(),
    entry_fee_amount: z.string().optional(),
    entry_fee_currency: z.string().optional(),
    entry_fee_note: z.string().trim().optional(),
  })
  .extend(baseLocationFieldsSchema.shape)
  .superRefine((value, ctx) => {
    if ((value.lat === undefined) !== (value.lng === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Latitude and longitude must be set together', path: ['lng'] })
    }
    if (value.registration_mode === 'external' && !value.external_registration_url) {
      ctx.addIssue({ code: 'custom', message: 'External registration URL is required', path: ['external_registration_url'] })
    }
    const feeAmount = value.entry_fee_amount ? Number(value.entry_fee_amount) : 0
    if (feeAmount > 0 && !value.entry_fee_currency) {
      ctx.addIssue({ code: 'custom', message: 'Select a currency for the entry fee', path: ['entry_fee_currency'] })
    }
  })

type OpenMicFormValues = z.infer<typeof openMicFormSchema>

const DEFAULT_VALUES: OpenMicFormValues = {
  name: '',
  description: '',
  handle: '',
  venue_name: '',
  address_line1: '',
  address_line2: '',
  postcode: '',
  city: '',
  country: '',
  lat: undefined,
  lng: undefined,
  time_zone: '',
  website: '',
  contact_email: '',
  schedule_summary: '',
  schedule_details: '',
  originals_only: false,
  amplification_available: false,
  age_policy: 'both',
  activities: [],
  tags: '',
  registration_mode: 'both',
  external_registration_url: '',
  entry_fee_amount: '',
  entry_fee_currency: '',
  entry_fee_note: '',
}

function openMicErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'We could not save this open mic. Please try again.'
  if (error.code === 'HANDLE_UNAVAILABLE') return 'That handle is already taken. Please choose another.'
  const fieldErrors = (error.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors
  const firstField = fieldErrors && Object.keys(fieldErrors)[0]
  if (firstField) return `${firstField.replace(/_/g, ' ')}: ${fieldErrors![firstField][0]}`
  return 'Please check the fields below and try again.'
}

function applyServerFieldErrors(error: unknown, setError: UseFormSetError<OpenMicFormValues>): void {
  if (!(error instanceof ApiError)) return
  const fieldErrors = (error.details as { fieldErrors?: Record<string, string[]> } | undefined)?.fieldErrors
  if (!fieldErrors) return
  Object.entries(fieldErrors).forEach(([field, messages]) => {
    setError(field as keyof OpenMicFormValues, { type: 'server', message: messages[0] })
  })
}

export function OpenMicFormPage({ seriesId, theme, mode }: { seriesId?: string; theme: ThemeId; mode: ColorMode }) {
  const { t } = useTranslation()
  const isEdit = Boolean(seriesId)
  const { context, activeProfile, isOrganizer } = useOrganizerProfile()
  const existing = useOpenMicDetail(seriesId)
  const createOpenMic = useCreateOpenMic(activeProfile?.id)
  const updateOpenMic = useUpdateOpenMic(seriesId)

  const { register, handleSubmit, watch, setValue, setError, reset, formState } = useForm<OpenMicFormValues>({
    resolver: zodResolver(openMicFormSchema),
    defaultValues: DEFAULT_VALUES,
  })
  const { errors, dirtyFields, isDirty } = formState

  const name = watch('name')
  const handle = watch('handle') ?? ''
  const contactEmail = watch('contact_email') ?? ''
  const lat = watch('lat')
  const lng = watch('lng')
  const addressLine1 = watch('address_line1')
  const city = watch('city')
  const country = watch('country')
  const postcode = watch('postcode')
  const activities = watch('activities')
  const entryFeeAmount = watch('entry_fee_amount')
  const registrationMode = watch('registration_mode')

  const handleCheck = useHandleAvailability(handle, !isEdit)
  const handleTouchedRef = useRef(false)
  const { onChange: handleFieldOnChange, ...handleFieldProps } = register('handle')

  // Suggest a handle from the series name until the organizer directly edits the handle field.
  // Tracking "touched" via a ref (set only from the handle input's own onChange) rather than
  // reading `dirtyFields.handle`/`handle` back out of the form keeps this effect a one-way
  // sync from name -> handle, avoiding a feedback loop through the watched `handle` value.
  useEffect(() => {
    if (isEdit || handleTouchedRef.current) return
    setValue('handle', suggestHandle(name ?? ''))
  }, [name, isEdit, setValue])

  // Default the open mic's contact email to the organizer's account email; they can still
  // override it with a separate address, which we validate the same way as any other email field.
  useEffect(() => {
    if (dirtyFields.contact_email || contactEmail || !context.account.data?.email) return
    setValue('contact_email', context.account.data.email)
  }, [dirtyFields.contact_email, contactEmail, context.account.data?.email, setValue])

  useEffect(() => {
    if (!existing.data) return
    reset({
      name: existing.data.name,
      description: existing.data.description ?? '',
      handle: '',
      venue_name: existing.data.venue_name,
      address_line1: existing.data.address_line1,
      address_line2: existing.data.address_line2 ?? '',
      postcode: existing.data.postcode ?? '',
      city: existing.data.city,
      country: existing.data.country,
      lat: existing.data.lat ?? undefined,
      lng: existing.data.lng ?? undefined,
      time_zone: existing.data.time_zone,
      website: existing.data.website ?? '',
      contact_email: existing.data.contact_email ?? '',
      schedule_summary: existing.data.schedule_summary ?? '',
      schedule_details: existing.data.schedule_details ?? '',
      originals_only: existing.data.originals_only,
      amplification_available: existing.data.amplification_available,
      age_policy: existing.data.age_policy,
      activities: existing.data.activities,
      tags: (existing.data.tags ?? []).join(', '),
      registration_mode: existing.data.registration_mode,
      external_registration_url: existing.data.external_registration_url ?? '',
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

  const mutation = isEdit ? updateOpenMic : createOpenMic

  useEffect(() => {
    if (mutation.error) applyServerFieldErrors(mutation.error, setError)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutation.error])

  function toggleActivity(activity: string) {
    const next = activities.includes(activity) ? activities.filter((item) => item !== activity) : [...activities, activity]
    setValue('activities', next, { shouldDirty: true, shouldValidate: true })
  }

  function onSubmit(values: OpenMicFormValues) {
    if (!isEdit && values.handle && (handleCheck.state === 'unavailable' || handleCheck.state === 'invalid')) return
    const input: OpenMicFormInput = {
      name: values.name,
      description: values.description || undefined,
      venue_name: values.venue_name,
      address_line1: values.address_line1,
      address_line2: values.address_line2 || undefined,
      postcode: values.postcode || undefined,
      city: values.city,
      country: values.country,
      lat: values.lat,
      lng: values.lng,
      time_zone: values.time_zone,
      website: values.website || undefined,
      contact_email: values.contact_email || undefined,
      schedule_summary: values.schedule_summary || undefined,
      schedule_details: values.schedule_details || undefined,
      originals_only: values.originals_only,
      amplification_available: values.amplification_available,
      age_policy: values.age_policy,
      activities: values.activities,
      tags: (values.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean),
      registration_mode: values.registration_mode,
      external_registration_url: values.registration_mode === 'external' ? values.external_registration_url : undefined,
      entry_fee_amount: values.entry_fee_amount ? Number(values.entry_fee_amount) : undefined,
      entry_fee_currency: values.entry_fee_currency || undefined,
      entry_fee_note: values.entry_fee_note || undefined,
      ...(isEdit ? {} : { handle: values.handle || undefined }),
    }
    if (isEdit) {
      updateOpenMic.mutate(input, { onSuccess: () => reset(values) })
    } else {
      createOpenMic.mutate(input, {
        onSuccess: (created) => { reset(values); window.location.href = `/dashboard/series/${created.id}` },
      })
    }
  }

  const isOwner = !isEdit || !existing.data || existing.data.owner_profile_id === activeProfile?.id

  if (context.account.isPending || context.profiles.isPending || (isEdit && existing.isPending)) {
    return <main className="app" data-theme={theme} data-mode={mode}><ReadState message={t('loading')} /></main>
  }
  if (!context.account.data || !isOrganizer || (isEdit && existing.data && !isOwner)) {
    return <main className="app" data-theme={theme} data-mode={mode}>
      <header className="topbar"><a className="brand" href="/" aria-label={t('openMicHome')}><span className="brand-mark"><Sparkles size={17} /></span><span>{t("appName")}</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
      <section className="dashboard-page"><ReadState message="Switch to an organizer profile to manage open mic series." /></section>
    </main>
  }
  if (isEdit && existing.isError) {
    return <main className="app" data-theme={theme} data-mode={mode}><ReadState message="We could not load this open mic." retry={() => void existing.refetch()} /></main>
  }

  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><a className="brand" href="/" aria-label={t('openMicHome')}><span className="brand-mark"><Sparkles size={17} /></span><span>{t("appName")}</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
    <section className="dashboard-page">
      <a className="back-link" href={isEdit ? `/dashboard/series/${seriesId}` : '/dashboard/series'}>← Back to {isEdit ? 'series' : 'series list'}</a>
      <div className="eyebrow">{t('organizerWorkspace')}</div>
      <h1>{isEdit ? t('editSeriesTitle', { name: existing.data?.name ?? t('openMicSeries') }) : t('createSeriesTitle')}</h1>
      <form className="registration-form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <RequiredFieldsNote />
        <label><span>{t('seriesName')}<Required /></span><input required {...register('name')} /></label>
        {errors.name && <p className="form-error" role="alert">{errors.name.message}</p>}
        <label>Description <span className="field-hint">{t('optional')}</span><textarea {...register('description')} /></label>
        {!isEdit && <label>{t('handleLabel')} <span className="field-hint">{t('handleHint')}</span><span className="handle-input"><span aria-hidden="true">@</span><input {...handleFieldProps} onChange={(event) => { handleTouchedRef.current = true; void handleFieldOnChange(event) }} /></span></label>}
        {!isEdit && handle && <p className={`handle-feedback ${handleCheck.state === 'available' ? 'form-success' : handleCheck.state === 'checking' ? 'field-hint' : 'form-error'}`} role={handleCheck.state === 'unavailable' || handleCheck.state === 'invalid' ? 'alert' : 'status'}>
          {handleCheck.state === 'available' && <CircleCheck aria-hidden="true" size={16} />}
          {(handleCheck.state === 'unavailable' || handleCheck.state === 'invalid') && <CircleAlert aria-hidden="true" size={16} />}
          {handleCheck.state === 'checking' ? 'Checking availability…' : handleCheck.message}
        </p>}

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
          latInputId="open-mic-lat"
          lngInputId="open-mic-lng"
        />
        {errors.lng && <p className="form-error" role="alert">{errors.lng.message}</p>}

        <label><span>{t('timeZone')}<Required /></span> <span className="field-hint">{t('timeZoneHint')}</span><input required {...register('time_zone')} /></label>
        {errors.time_zone && <p className="form-error" role="alert">{errors.time_zone.message}</p>}

        <label>{t('website')} <span className="field-hint">{t('optional')}</span><input type="url" {...register('website')} /></label>
        {errors.website && <p className="form-error" role="alert">{errors.website.message}</p>}
        <label>{t('contactEmail')} <span className="field-hint">{t('contactEmailHint')}</span><input type="email" {...register('contact_email')} /></label>
        {errors.contact_email && <p className="form-error" role="alert">{errors.contact_email.message}</p>}
        <label>{t('scheduleSummary')} <span className="field-hint">{t('scheduleSummaryHint')}</span><input {...register('schedule_summary')} /></label>
        <label>{t('scheduleDetails')} <span className="field-hint">{t('optional')}</span><textarea {...register('schedule_details')} /></label>

        <fieldset>
          <legend>{t('activities')}<Required /></legend>
          {ACTIVITIES.map((activity) => (
            <label className="checkbox-label" key={activity}><input type="checkbox" checked={activities.includes(activity)} onChange={() => toggleActivity(activity)} /><span>{activity}</span></label>
          ))}
        </fieldset>
        {errors.activities && <p className="form-error" role="alert">{errors.activities.message}</p>}
        <label>{t('tags')} <span className="field-hint">{t('optional')} · separate with commas</span><input {...register('tags')} /></label>

        <label className="checkbox-label"><input type="checkbox" {...register('originals_only')} /><span>{t('originalsOnly')}</span></label>
        <label className="checkbox-label"><input type="checkbox" {...register('amplification_available')} /><span>{t('amplification')}</span></label>
        <label>{t('agePolicy')}<select {...register('age_policy')}>
          <option value="both">{t('allAges')}</option>
          <option value="adults_only">{t('adultsOnly')}</option>
          <option value="children_only">{t('childrenOnly')}</option>
        </select></label>

        <label>{t('registrationMode')}<select {...register('registration_mode')}>
          <option value="both">{t('onlineNight')}</option>
          <option value="pre_only">{t('onlineOnly')}</option>
          <option value="on_night_only">{t('nightOnly')}</option>
          <option value="external">{t('externalLink')}</option>
        </select></label>
        {registrationMode === 'external' && <label><span>{t('externalRegistrationUrl')}<Required /></span><input required type="url" {...register('external_registration_url')} /></label>}
        {errors.external_registration_url && <p className="form-error" role="alert">{errors.external_registration_url.message}</p>}

        <label>{t('entryFee')} <span className="field-hint">{t('entryFeeHint')}</span><input type="number" min="0" step="0.01" {...register('entry_fee_amount')} /></label>
        {Number(entryFeeAmount) > 0 && <label><span>{t('entryFeeCurrency')}<Required /></span><select required {...register('entry_fee_currency')}><option value="">{t('selectCurrency')}</option>{CURRENCIES.map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label>}
        {errors.entry_fee_currency && <p className="form-error" role="alert">{errors.entry_fee_currency.message}</p>}
        <label>{t('entryFeeNote')} <span className="field-hint">{t('optional')}</span><input {...register('entry_fee_note')} /></label>

        {mutation.isError && <p className="form-error" role="alert">{openMicErrorMessage(mutation.error)}</p>}
        {mutation.isSuccess && isEdit && <p className="form-success" role="status">{t('saved')}</p>}
        <button className="primary-button" type="submit" disabled={mutation.isPending || activities.length === 0 || (!isEdit && Boolean(handle) && (handleCheck.state === 'unavailable' || handleCheck.state === 'invalid'))}>
          {mutation.isPending ? t('saving') : isEdit ? t('saveChanges') : t('createSeries')}
        </button>
        {activities.length === 0 && <p className="field-hint">{t('selectActivity')}</p>}
      </form>
      {isEdit && seriesId && <KioskBackupPinSection seriesId={seriesId} />}
    </section>
  </main>
}
