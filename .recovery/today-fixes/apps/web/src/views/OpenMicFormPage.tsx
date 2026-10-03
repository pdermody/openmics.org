import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type UseFormSetError } from 'react-hook-form'
import { z } from 'zod'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { Link, useNavigate } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { LocationPicker } from '../components/location/LocationPicker'
import { useHandleAvailability } from '../features/handles'
import { CURRENCIES } from '../features/currencies'
import { ACTIVITY_LABEL_KEYS, browserTimeZone, COUNTRY_OPTIONS, formatTimeZoneOption, TIME_ZONE_OPTIONS } from '../features/form-options'
import { baseLocationFieldsSchema } from '../features/location'
import { useCreateOpenMic, useOpenMicDetail, useOrganizerProfile, useUpdateOpenMic, type OpenMicFormInput } from '../features/organizer'
import { suggestHandle } from '../features/slugify'
import type { ColorMode, ThemeId } from '../theme'
import { KioskBackupPinSection } from './KioskBackupPin'
import { Modal, ReadState, Required, RequiredFieldsNote, SiteHeader } from './shared'

const ACTIVITIES = ['singing', 'poetry', 'jam', 'trad', 'comedy', 'storytelling', 'other'] as const

const FORM_TABS = [
  { id: 'basics', labelKey: 'seriesTabBasics', fields: ['name', 'handle', 'website', 'contact_email', 'status', 'activities'] },
  { id: 'location', labelKey: 'seriesTabLocation', fields: ['venue_name', 'address_line1', 'city', 'country', 'lat', 'lng'] },
  { id: 'schedule', labelKey: 'seriesTabSchedule', fields: ['time_zone', 'schedule_summary', 'schedule_details'] },
  { id: 'registration', labelKey: 'seriesTabRegistration', fields: ['tags', 'registration_mode', 'external_registration_url', 'entry_fee_amount', 'entry_fee_currency', 'entry_fee_note'] },
] as const

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
    status: z.enum(['active', 'paused', 'ended', 'draft']),
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
  time_zone: browserTimeZone(),
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
  status: 'draft',
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
  const navigate = useNavigate()
  const isEdit = Boolean(seriesId)
  const { context, activeProfile, isOrganizer } = useOrganizerProfile()
  const existing = useOpenMicDetail(seriesId)
  const createOpenMic = useCreateOpenMic(activeProfile?.id)
  const updateOpenMic = useUpdateOpenMic(seriesId)

  const { register, handleSubmit, watch, setValue, setError, reset, formState } = useForm<OpenMicFormValues>({
    resolver: zodResolver(openMicFormSchema),
    defaultValues: DEFAULT_VALUES,
  })
  const { errors, isDirty } = formState
  const [activeTab, setActiveTab] = useState(0)
  const [discardModalOpen, setDiscardModalOpen] = useState(false)

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
  // dirtyFields is unreliable as a "user edited this" signal for programmatically-suggested
  // fields: once anything reads formState.isDirty (the Cancel button does), RHF recomputes
  // dirtyFields by comparing every field's VALUE against its default on each user keystroke,
  // which marks the suggested website/contact_email as dirty after the first keystroke and
  // freezes the suggestion. Refs set from each field's own onChange track real user edits.
  const websiteTouchedRef = useRef(false)
  const { onChange: websiteFieldOnChange, ...websiteFieldProps } = register('website')
  const contactEmailTouchedRef = useRef(false)
  const { onChange: contactEmailFieldOnChange, ...contactEmailFieldProps } = register('contact_email')

  // Suggest a handle from the series name until the organizer directly edits the handle field.
  // Tracking "touched" via a ref (set only from the handle input's own onChange) rather than
  // reading `dirtyFields.handle`/`handle` back out of the form keeps this effect a one-way
  // sync from name -> handle, avoiding a feedback loop through the watched `handle` value.
  useEffect(() => {
    if (isEdit || handleTouchedRef.current) return
    setValue('handle', suggestHandle(name ?? ''))
  }, [name, isEdit, setValue])

  useEffect(() => {
    if (isEdit || websiteTouchedRef.current) return
    setValue('website', handle ? `https://openmics.org/@${handle}` : '')
  }, [handle, isEdit, setValue])

  // Default the open mic's contact email to the organizer's account email; they can still
  // override it with a separate address, which we validate the same way as any other email field.
  useEffect(() => {
    if (contactEmailTouchedRef.current || contactEmail || !context.account.data?.email) return
    setValue('contact_email', context.account.data.email)
  }, [contactEmail, context.account.data?.email, setValue])

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
      status: existing.data.status,
    })
  }, [existing.data, reset])

  useEffect(() => {
    if (!isDirty) return
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const mutation = isEdit ? updateOpenMic : createOpenMic

  function tabHasErrors(tabIndex: number): boolean {
    return FORM_TABS[tabIndex].fields.some((field) => Boolean(errors[field as keyof OpenMicFormValues]))
  }

  function focusFirstError(errorValues: Partial<Record<keyof OpenMicFormValues, unknown>>) {
    const firstTab = FORM_TABS.findIndex((tab) => tab.fields.some((field) => Boolean(errorValues[field as keyof OpenMicFormValues])))
    const tabIndex = firstTab < 0 ? 0 : firstTab
    setActiveTab(tabIndex)
    const firstField = firstTab < 0 ? undefined : FORM_TABS[tabIndex].fields.find((field) => Boolean(errorValues[field as keyof OpenMicFormValues]))
    if (firstField) {
      window.setTimeout(() => {
        const element = document.querySelector<HTMLElement>(`[name="${firstField}"]`)
        element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        element?.focus()
      }, 0)
    }
  }

  useEffect(() => {
    if (mutation.error) {
      applyServerFieldErrors(mutation.error, setError)
      const fieldErrors = (mutation.error instanceof ApiError ? mutation.error.details : undefined) as { fieldErrors?: Record<string, string[]> } | undefined
      if (fieldErrors?.fieldErrors) focusFirstError(fieldErrors.fieldErrors)
    }
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
      status: values.status,
      ...(isEdit ? {} : { handle: values.handle || undefined }),
    }
    if (isEdit) {
      updateOpenMic.mutate(input, { onSuccess: () => reset(values) })
    } else {
      createOpenMic.mutate(input, {
        onSuccess: (created) => { reset(values); void navigate({ to: '/dashboard/series/$seriesId', params: { seriesId: created.id } }) },
      })
    }
  }

  function leaveForm() {
    if (isDirty) { setDiscardModalOpen(true); return }
    if (isEdit) void navigate({ to: '/dashboard/series/$seriesId', params: { seriesId: seriesId ?? '' } })
    else void navigate({ to: '/dashboard' })
  }

  const isOwner = !isEdit || !existing.data || existing.data.owner_profile_id === activeProfile?.id

  if (context.account.isPending || context.profiles.isPending || (isEdit && existing.isPending)) {
    return <main className="app" data-theme={theme} data-mode={mode}><ReadState message={t('loading')} /></main>
  }
  if (!context.account.data || !isOrganizer || (isEdit && existing.data && !isOwner)) {
    return <main className="app" data-theme={theme} data-mode={mode}>
      <SiteHeader />
      <section className="dashboard-page">
        <ReadState message={t('selectOrganizerSeries')} />
        {context.account.data && !isOrganizer && <Link className="primary-button" to="/profiles/manage">{t('createOrSwitchOrganizer')}</Link>}
      </section>
    </main>
  }
  if (isEdit && existing.isError) {
    return <main className="app" data-theme={theme} data-mode={mode}><ReadState message="We could not load this open mic." retry={() => void existing.refetch()} /></main>
  }

  return <main className="app" data-theme={theme} data-mode={mode}>
    <SiteHeader />
    <section className="dashboard-page">
      {isEdit
        ? <Link className="back-link" to="/dashboard/series/$seriesId" params={{ seriesId: seriesId ?? '' }}>← Back to series</Link>
        : <Link className="back-link" to="/dashboard">← Back to dashboard</Link>}
      <div className="eyebrow">{t('organizerWorkspace')}</div>
      <h1>{isEdit ? t('editSeriesTitle', { name: existing.data?.name ?? t('openMicSeries') }) : t('createSeriesTitle')}</h1>
      <form className="registration-form series-form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <RequiredFieldsNote />
        <div className="form-tabs" role="tablist" aria-label={t('seriesFormSections')}>
          {FORM_TABS.map((tab, index) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === index} aria-controls={`series-tab-${tab.id}`} className={`form-tab${activeTab === index ? ' form-tab-active' : ''}`} onClick={() => setActiveTab(index)}>
            {t(tab.labelKey)}{tabHasErrors(index) && <span className="form-tab-error" aria-label={t('requiredInformationMissing')}>!</span>}
          </button>)}
        </div>

        <section id="series-tab-basics" role="tabpanel" hidden={activeTab !== 0}>
          <label><span>{t('seriesName')}<Required /></span><input required {...register('name')} /></label>
          {errors.name && <p className="form-error" role="alert">{errors.name.message}</p>}
          <p className="field-hint">{t('seriesNameHint')}</p>
          {!isEdit && <label>{t('handleLabel')}<span className="handle-input"><span aria-hidden="true">@</span><input {...handleFieldProps} onChange={(event) => { handleTouchedRef.current = true; void handleFieldOnChange(event) }} /></span></label>}
          {!isEdit && <p className="field-hint">{t('seriesHandleFormHint')}</p>}
          {!isEdit && handle && <p className={`handle-feedback ${handleCheck.state === 'available' ? 'form-success' : handleCheck.state === 'checking' ? 'field-hint' : 'form-error'}`} role={handleCheck.state === 'unavailable' || handleCheck.state === 'invalid' ? 'alert' : 'status'}>
            {handleCheck.state === 'available' && <CircleCheck aria-hidden="true" size={16} />}
            {(handleCheck.state === 'unavailable' || handleCheck.state === 'invalid') && <CircleAlert aria-hidden="true" size={16} />}
            {handleCheck.state === 'checking' ? t('checkingAvailability') : handleCheck.message}
          </p>}
          {isEdit && <label>{t('handleLabel')}<input value={existing.data?.current_handle ? `@${existing.data.current_handle}` : ''} placeholder={t('handleNotSet')} disabled readOnly /></label>}
          {isEdit && <p className="field-hint">{t('handleRenameUnavailable')}</p>}
          <label>{t('website')}<input type="url" {...websiteFieldProps} onChange={(event) => { websiteTouchedRef.current = true; void websiteFieldOnChange(event) }} /></label>
          {errors.website && <p className="form-error" role="alert">{errors.website.message}</p>}
          <label>{t('contactEmail')}<input type="email" {...contactEmailFieldProps} onChange={(event) => { contactEmailTouchedRef.current = true; void contactEmailFieldOnChange(event) }} /></label>
          {errors.contact_email && <p className="form-error" role="alert">{errors.contact_email.message}</p>}
          <p className="field-hint">{t('seriesContactHint')}</p>
          <label>{t('seriesStatus')}<select {...register('status')}>
            <option value="draft">{t('statusDraft')}</option>
            <option value="active">{t('statusActive')}</option>
            <option value="paused">{t('statusPaused')}</option>
            <option value="ended">{t('statusEnded')}</option>
          </select></label>
          <p className="field-hint">{t('seriesStatusHint')}</p>
          <label>{t('description')}<textarea {...register('description')} /></label>
          <p className="field-hint">{t('seriesDescriptionHint')}</p>
          <fieldset>
            <legend>{t('activities')}<Required /></legend>
            {ACTIVITIES.map((activity) => <label className="checkbox-label" key={activity}><input type="checkbox" checked={activities.includes(activity)} onChange={() => toggleActivity(activity)} /><span>{t(ACTIVITY_LABEL_KEYS[activity])}</span></label>)}
          </fieldset>
          {errors.activities && <p className="form-error" role="alert">{errors.activities.message}</p>}
        </section>

        <section id="series-tab-location" role="tabpanel" hidden={activeTab !== 1}>
          <label><span>{t('venueName')}<Required /></span><input required {...register('venue_name')} /></label>
          {errors.venue_name && <p className="form-error" role="alert">{errors.venue_name.message}</p>}
          <p className="field-hint">{t('venueNameHint')}</p>
          <label><span>{t('address')}<Required /></span><input required {...register('address_line1')} /></label>
          {errors.address_line1 && <p className="form-error" role="alert">{errors.address_line1.message}</p>}
          <label>{t('addressLine2')}<textarea {...register('address_line2')} /></label>
          <label>{t('postcode')}<input {...register('postcode')} /></label>
          <label><span>{t('city')}<Required /></span><input required {...register('city')} /></label>
          {errors.city && <p className="form-error" role="alert">{errors.city.message}</p>}
          <label><span>{t('country')}<Required /></span><select required {...register('country')}><option value="">{t('selectCountry')}</option>{COUNTRY_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.name} ({option.code})</option>)}</select></label>
          {errors.country && <p className="form-error" role="alert">{errors.country.message}</p>}
          <p className="field-hint">{t('locationFieldsHint')}</p>
          <LocationPicker
            lat={lat}
            lng={lng}
            onChange={({ lat: nextLat, lng: nextLng }) => { setValue('lat', nextLat, { shouldDirty: true, shouldValidate: true }); setValue('lng', nextLng, { shouldDirty: true, shouldValidate: true }) }}
            addressQuery={[addressLine1, postcode, city, country].filter(Boolean).join(', ')}
            latInputId="open-mic-lat"
            lngInputId="open-mic-lng"
          />
          {errors.lng && <p className="form-error" role="alert">{errors.lng.message}</p>}
        </section>

        <section id="series-tab-schedule" role="tabpanel" hidden={activeTab !== 2}>
          <label><span>{t('timeZone')}<Required /></span><select required {...register('time_zone')}>{TIME_ZONE_OPTIONS.map((zone) => <option key={zone} value={zone}>{formatTimeZoneOption(zone)}</option>)}</select></label>
          {errors.time_zone && <p className="form-error" role="alert">{errors.time_zone.message}</p>}
          <p className="field-hint">{t('timeZoneFormHint')}</p>
          <label>{t('scheduleSummary')}<input {...register('schedule_summary')} /></label>
          <p className="field-hint">{t('scheduleSummaryFormHint')}</p>
          <label>{t('scheduleDetails')}<textarea {...register('schedule_details')} /></label>
        </section>

        <section id="series-tab-registration" role="tabpanel" hidden={activeTab !== 3}>
          <label>{t('tags')}<input {...register('tags')} /></label>
          <p className="field-hint">{t('seriesTagsHint')}</p>

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

          <label>{t('entryFee')}<input type="number" min="0" step="0.01" {...register('entry_fee_amount')} /></label>
          <p className="field-hint">{t('entryFeeFormHint')}</p>
          {Number(entryFeeAmount) > 0 && <label><span>{t('entryFeeCurrency')}<Required /></span><select required {...register('entry_fee_currency')}><option value="">{t('selectCurrency')}</option>{CURRENCIES.map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label>}
          {errors.entry_fee_currency && <p className="form-error" role="alert">{errors.entry_fee_currency.message}</p>}
          <label>{t('entryFeeNote')}<input {...register('entry_fee_note')} /></label>
          <p className="field-hint">{t('entryFeeNoteHint')}</p>
          {isEdit && seriesId && <KioskBackupPinSection seriesId={seriesId} embedded />}
        </section>

        {mutation.isError && <p className="form-error" role="alert">{openMicErrorMessage(mutation.error)}</p>}
        {mutation.isSuccess && isEdit && <p className="form-success" role="status">{t('saved')}</p>}
        <div className="form-tab-navigation">
          <button type="button" className="link-button" onClick={leaveForm} disabled={!isDirty || mutation.isPending}>{t('cancel')}</button>
          <button className="primary-button" type="submit" disabled={mutation.isPending || (isEdit && !isDirty) || activities.length === 0 || (!isEdit && Boolean(handle) && (handleCheck.state === 'unavailable' || handleCheck.state === 'invalid'))}>
            {mutation.isPending ? t('saving') : isEdit ? t('saveChanges') : t('createSeries')}
          </button>
          <span className="form-tab-navigation-spacer" aria-hidden="true" />
          <button type="button" className="quiet-button" disabled={activeTab === 0} onClick={() => setActiveTab((tab) => Math.max(0, tab - 1))}>{t('previousTab')}</button>
          <button type="button" className="quiet-button" disabled={activeTab === FORM_TABS.length - 1} onClick={() => setActiveTab((tab) => Math.min(FORM_TABS.length - 1, tab + 1))}>{t('nextTab')}</button>
        </div>
        {activities.length === 0 && <p className="field-hint">{t('selectActivity')}</p>}
      </form>
      {discardModalOpen && <Modal title={t('confirmAction')} onClose={() => setDiscardModalOpen(false)}>
        <p>{t('confirmDiscardChanges')}</p>
        <div className="dashboard-series-card-actions">
          <button type="button" className="quiet-button" onClick={() => { setDiscardModalOpen(false); if (isEdit) void navigate({ to: '/dashboard/series/$seriesId', params: { seriesId: seriesId ?? '' } }); else void navigate({ to: '/dashboard' }) }}>{t('discardChanges')}</button>
          <button type="button" className="link-button" onClick={() => setDiscardModalOpen(false)}>{t('cancel')}</button>
        </div>
      </Modal>}
    </section>
  </main>
}
