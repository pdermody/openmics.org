import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type UseFormSetError } from 'react-hook-form'
import { z } from 'zod'
import { Link, useNavigate } from '@tanstack/react-router'
import { ApiError } from '../api/client'
import { LocationPicker } from '../components/location/LocationPicker'
import { useCreateEvent, useEventDetail, useOpenMicDetail, useOrganizerProfile, useUpdateEvent, type EventFormInput } from '../features/organizer'
import { CURRENCIES } from '../features/currencies'
import { ACTIVITY_LABEL_KEYS, browserTimeZone, COUNTRY_OPTIONS, formatTimeZoneOption, TIME_ZONE_OPTIONS } from '../features/form-options'
import { baseLocationFieldsSchema } from '../features/location'
import { isRegistrationClosed } from '../features/publicReads'
import type { ColorMode, ThemeId } from '../theme'
import { Modal, ReadState, Required, RequiredFieldsNote, SiteHeader } from './shared'

const ACTIVITIES = ['singing', 'poetry', 'jam', 'trad', 'comedy', 'storytelling', 'other'] as const

const EVENT_TABS = [
  { id: 'details', labelKey: 'eventTabDetails', fields: ['title', 'starts_at', 'ends_at', 'capacity'] },
  { id: 'schedule', labelKey: 'eventTabSchedule', fields: ['time_zone', 'registrations_closed_at'] },
  { id: 'location', labelKey: 'eventTabLocation', fields: ['venue_name', 'address_line1', 'city', 'country', 'lat', 'lng'] },
  { id: 'registration', labelKey: 'eventTabRegistration', fields: ['activities', 'tags', 'notes', 'entry_fee_amount', 'entry_fee_currency', 'entry_fee_note'] },
] as const

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
    ends_at: z.string().min(1, 'End time is required'),
    time_zone: z.string().trim().min(1, 'Time zone is required'),
    status: z.enum(['draft', 'published']),
    registrations_closed_at: z.string().optional(),
    open_registrations: z.boolean(),
    capacity: z.string().optional(),
    override_location: z.boolean(),
    venue_name: z.string().trim().min(1, 'Venue name is required'),
    activities: z.array(z.string()).optional(),
    tags: z.string().optional(),
    notes: z.string().trim().optional(),
    entry_fee_amount: z.string().optional(),
    entry_fee_currency: z.string().optional(),
    entry_fee_note: z.string().trim().optional(),
  })
  .extend(baseLocationFieldsSchema.shape)
  .extend({
    address_line1: z.string().trim().min(1, 'Address is required'),
    city: z.string().trim().min(1, 'City is required'),
    country: z.string().trim().min(1, 'Country is required'),
  })
  .superRefine((value, ctx) => {
    if ((value.lat === undefined) !== (value.lng === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Latitude and longitude must be set together', path: ['lng'] })
    }
    if (value.country && !/^[A-Za-z]{2}$/.test(value.country)) {
      ctx.addIssue({ code: 'custom', message: 'Use a two-letter country code, e.g. IE', path: ['country'] })
    }
    // The API stores venue_name/address/city/country/lat/lng as an all-or-nothing snapshot: lat/lng
    // are only mandatory once the organizer is actually editing this event's own location (override
    // on create, or always on edit), matching the parent series' own optional coordinates otherwise.
    if (value.override_location) {
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
  time_zone: browserTimeZone(),
  status: 'draft',
  registrations_closed_at: '',
  open_registrations: true,
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
  const navigate = useNavigate()
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
  const [activeTab, setActiveTab] = useState(0)
  const [savedModalOpen, setSavedModalOpen] = useState(false)
  const [discardModalOpen, setDiscardModalOpen] = useState(false)
  const [registrationTogglePending, setRegistrationTogglePending] = useState(false)

  const overrideLocation = watch('override_location')
  const lat = watch('lat')
  const lng = watch('lng')
  const addressLine1 = watch('address_line1')
  const city = watch('city')
  const country = watch('country')
  const postcode = watch('postcode')
  const activities = watch('activities') ?? []
  const entryFeeAmount = watch('entry_fee_amount')
  const registrationsClosedAt = watch('registrations_closed_at') ?? ''
  const existingEvent = existing.data
  const onlineRegistrationMode = openMic.data?.registration_mode === 'pre_only' || openMic.data?.registration_mode === 'both'
  const registrationsClosed = Boolean(registrationsClosedAt) && new Date(registrationsClosedAt).getTime() <= Date.now()
  const eventPhase = existingEvent?.phase

  // Prefill sensible defaults from the parent series when creating a new event. The event
  // always stores its own location snapshot; these values are copied so it saves correctly
  // even if the organizer never opens the location fields to change them.
  useEffect(() => {
    if (isEdit || !openMic.data) return
    setValue('time_zone', openMic.data.time_zone)
    setValue('activities', openMic.data.activities)
    setValue('venue_name', openMic.data.venue_name)
    setValue('address_line1', openMic.data.address_line1)
    setValue('address_line2', openMic.data.address_line2 ?? '')
    setValue('postcode', openMic.data.postcode ?? '')
    setValue('city', openMic.data.city)
    setValue('country', openMic.data.country)
    setValue('lat', openMic.data.lat ?? undefined)
    setValue('lng', openMic.data.lng ?? undefined)
  }, [isEdit, openMic.data, setValue])

  useEffect(() => {
    if (!existing.data) return
    setRegistrationTogglePending(false)
    reset({
      title: existing.data.title,
      starts_at: toDatetimeLocalValue(existing.data.starts_at),
      ends_at: toDatetimeLocalValue(existing.data.ends_at),
      time_zone: existing.data.time_zone,
      status: existing.data.status,
      registrations_closed_at: toDatetimeLocalValue(existing.data.registrations_closed_at),
      open_registrations: !isRegistrationClosed(existing.data),
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

  function tabHasErrors(tabIndex: number): boolean {
    return EVENT_TABS[tabIndex].fields.some((field) => Boolean(errors[field as keyof EventFormValues]))
  }

  function focusFirstError(errorValues: Partial<Record<keyof EventFormValues, unknown>>) {
    const firstTab = EVENT_TABS.findIndex((tab) => tab.fields.some((field) => Boolean(errorValues[field as keyof EventFormValues])))
    const tabIndex = firstTab < 0 ? 0 : firstTab
    setActiveTab(tabIndex)
    const firstField = firstTab < 0 ? undefined : EVENT_TABS[tabIndex].fields.find((field) => Boolean(errorValues[field as keyof EventFormValues]))
    if (firstField) window.setTimeout(() => {
      const element = document.querySelector<HTMLElement>(`[name="${firstField}"]`)
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      element?.focus()
    }, 0)
  }

  useEffect(() => {
    if (mutation.error) {
      applyServerFieldErrors(mutation.error, setError)
      const fieldErrors = (mutation.error instanceof ApiError ? mutation.error.details : undefined) as { fieldErrors?: Record<string, string[]> } | undefined
      if (fieldErrors?.fieldErrors) focusFirstError(fieldErrors.fieldErrors)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mutation.error])

  function onSubmit(values: EventFormValues) {
    const input: EventFormInput = {
      title: values.title,
      starts_at: fromDatetimeLocalValue(values.starts_at)!,
      ends_at: fromDatetimeLocalValue(values.ends_at)!,
      time_zone: values.time_zone,
      status: values.status,
      registrations_closed_at: isEdit
        ? (values.registrations_closed_at ? fromDatetimeLocalValue(values.registrations_closed_at) : null)
        : values.open_registrations
          ? undefined
          : values.registrations_closed_at
            ? fromDatetimeLocalValue(values.registrations_closed_at)
            : new Date().toISOString(),
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
        country: values.country.toUpperCase(),
        lat: values.lat,
        lng: values.lng,
      } : {}),
    }
    if (isEdit) {
      updateEvent.mutate(input, { onSuccess: () => { reset(values); setRegistrationTogglePending(false); setSavedModalOpen(true) } })
    } else {
      createEvent.mutate(input, {
        onSuccess: (created) => { reset(values); void navigate({ to: '/events/$eventId', params: { eventId: created.public_code } }) },
      })
    }
  }

  function toggleRegistrationAvailability() {
    setValue('registrations_closed_at', registrationsClosed ? '' : toDatetimeLocalValue(new Date().toISOString()), { shouldDirty: true })
    setRegistrationTogglePending(true)
  }

  function discardChanges() {
    if (isDirty) { setDiscardModalOpen(true); return }
    void navigate({ to: '/dashboard/series/$seriesId', params: { seriesId } })
  }

  if (context.account.isPending || context.profiles.isPending || openMic.isPending || (isEdit && existing.isPending)) {
    return <main className="app" data-theme={theme} data-mode={mode}><ReadState message={t('loading')} /></main>
  }
  const isOwner = !openMic.data || openMic.data.owner_profile_id === activeProfile?.id
  if (!context.account.data || !isOrganizer || (openMic.data && !isOwner)) {
    return <main className="app" data-theme={theme} data-mode={mode}>
      <SiteHeader />
      <section className="dashboard-page"><ReadState message={t('selectOrganizer')} /></section>
    </main>
  }
  if (openMic.isError || (isEdit && existing.isError)) {
    return <main className="app" data-theme={theme} data-mode={mode}><ReadState message={t('eventLoadError')} retry={() => { void openMic.refetch(); void existing.refetch() }} /></main>
  }

  return <main className="app" data-theme={theme} data-mode={mode}>
    <SiteHeader />
    <section className="dashboard-page">
      <Link className="back-link" to="/dashboard/series/$seriesId" params={{ seriesId }}>← Back to {openMic.data?.name ?? 'series'}</Link>
      <div className="eyebrow">{t('organizerWorkspace')}</div>
      <h1>{isEdit ? t('editEventTitle', { name: existing.data?.title ?? t('eventDetail') }) : t('newEventTitle', { name: openMic.data?.name ?? t('openMicSeries') })}</h1>
      <form className="registration-form series-form" onSubmit={handleSubmit(onSubmit, focusFirstError)} noValidate>
        <RequiredFieldsNote />
        <div className="form-tabs" role="tablist" aria-label={t('eventFormSections')}>
          {EVENT_TABS.map((tab, index) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === index} aria-controls={`event-tab-${tab.id}`} className={`form-tab${activeTab === index ? ' form-tab-active' : ''}`} onClick={() => setActiveTab(index)}>
            {t(tab.labelKey)}{tabHasErrors(index) && <span className="form-tab-error" aria-label={t('requiredInformationMissing')}>!</span>}
          </button>)}
        </div>

        <section id="event-tab-details" role="tabpanel" hidden={activeTab !== 0}>
          <label><span>{t('eventTitle')}<Required /></span><input required {...register('title')} /></label>
          {errors.title && <p className="form-error" role="alert">{errors.title.message}</p>}
          <label><span>{t('startsAt')}<Required /></span><input required type="datetime-local" {...register('starts_at')} /></label>
          {errors.starts_at && <p className="form-error" role="alert">{errors.starts_at.message}</p>}
          <label><span>{t('endsAt')}<Required /></span><input required type="datetime-local" {...register('ends_at')} /></label>
          {errors.ends_at && <p className="form-error" role="alert">{errors.ends_at.message}</p>}
          <label>{t('eventPublication')}<select {...register('status')}><option value="draft">{t('statusDraft')}</option><option value="published">{t('statusPublished')}</option></select></label>
          {isEdit && eventPhase && <p className="field-hint">{t('eventPhaseLabel')}: {t(`eventPhase${eventPhase[0].toUpperCase()}${eventPhase.slice(1)}`)}</p>}
          <label>{t('capacity')}<input type="number" min="1" {...register('capacity')} /></label>
          <p className="field-hint">{t('eventCapacityHint')}</p>
        </section>

        <section id="event-tab-schedule" role="tabpanel" hidden={activeTab !== 1}>
          <label><span>{t('timeZone')}<Required /></span><select required {...register('time_zone')}>{TIME_ZONE_OPTIONS.map((zone) => <option key={zone} value={zone}>{formatTimeZoneOption(zone)}</option>)}</select></label>
          {errors.time_zone && <p className="form-error" role="alert">{errors.time_zone.message}</p>}
          <p className="field-hint">{t('timeZoneFormHint')}</p>
          <label>{t('closeAt')}<input type="datetime-local" {...register('registrations_closed_at')} /></label>
          <p className="field-hint">{t('closeAtHint')}</p>
          <p className="field-hint">{onlineRegistrationMode ? t('eventOnlineRegistrationEnabled') : t('eventOnlineRegistrationDisabled')}</p>
          {isEdit && eventPhase === 'past' && <p className="field-hint">{t('eventRegistrationEnded')}</p>}
          {!isEdit && <label className="checkbox-label"><input type="checkbox" {...register('open_registrations')} /><span>{t('openRegistrationsOnCreate')}</span></label>}
          <button className="quiet-button" type="button" onClick={toggleRegistrationAvailability}>{registrationsClosed ? t('reopenRegistrations') : t('stopRegistrations')}</button>
          {registrationTogglePending && isDirty && <p className="field-hint" role="status">{t('saveRegistrationChangeHint')}</p>}
        </section>

        <section id="event-tab-location" role="tabpanel" hidden={activeTab !== 2}>
          {!isEdit && <label className="checkbox-label"><input type="checkbox" {...register('override_location')} /><span>{t('eventOverrideLocationCreate')}</span></label>}
          {(isEdit || overrideLocation) && <>
            <label><span>{t('venueName')}<Required /></span><input required {...register('venue_name')} /></label>
            {errors.venue_name && <p className="form-error" role="alert">{errors.venue_name.message}</p>}
            <label><span>{t('address')}<Required /></span><input required {...register('address_line1')} /></label>
            {errors.address_line1 && <p className="form-error" role="alert">{errors.address_line1.message}</p>}
            <label>{t('addressLine2')}<input {...register('address_line2')} /></label>
            <label>{t('postcode')}<input {...register('postcode')} /></label>
            <label><span>{t('city')}<Required /></span><input required {...register('city')} /></label>
            {errors.city && <p className="form-error" role="alert">{errors.city.message}</p>}
            <label><span>{t('country')}<Required /></span><select required {...register('country')}><option value="">{t('selectCountry')}</option>{COUNTRY_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.name} ({option.code})</option>)}</select></label>
            {errors.country && <p className="form-error" role="alert">{errors.country.message}</p>}
            <p className="field-hint">{t('locationFieldsHint')}</p>
            <LocationPicker lat={lat} lng={lng} onChange={({ lat: nextLat, lng: nextLng }) => { setValue('lat', nextLat, { shouldDirty: true, shouldValidate: true }); setValue('lng', nextLng, { shouldDirty: true, shouldValidate: true }) }} addressQuery={[addressLine1, postcode, city, country].filter(Boolean).join(', ')} latInputId="event-lat" lngInputId="event-lng" />
            {errors.lat && <p className="form-error" role="alert">{errors.lat.message}</p>}
            {errors.lng && <p className="form-error" role="alert">{errors.lng.message}</p>}
          </>}
        </section>

        <section id="event-tab-registration" role="tabpanel" hidden={activeTab !== 3}>
          <fieldset><legend>{t('activities')}</legend>{ACTIVITIES.map((activity) => <label className="checkbox-label" key={activity}><input type="checkbox" checked={activities.includes(activity)} onChange={() => toggleActivity(activity)} /><span>{t(ACTIVITY_LABEL_KEYS[activity])}</span></label>)}</fieldset>
          <label>{t('tags')}<input {...register('tags')} /></label>
          <p className="field-hint">{t('seriesTagsHint')}</p>
          <label>{t('notes')}<textarea {...register('notes')} /></label>
          <p className="field-hint">{t('eventNotesHint')}</p>
          <label>{t('entryFee')}<input type="number" min="0" step="0.01" {...register('entry_fee_amount')} /></label>
          <p className="field-hint">{t('entryFeeFormHint')}</p>
          {Number(entryFeeAmount) > 0 && <label><span>{t('entryFeeCurrency')}<Required /></span><select required {...register('entry_fee_currency')}><option value="">{t('selectCurrency')}</option>{CURRENCIES.map(([code, label]) => <option value={code} key={code}>{label}</option>)}</select></label>}
          {errors.entry_fee_currency && <p className="form-error" role="alert">{errors.entry_fee_currency.message}</p>}
          <label>{t('entryFeeNote')}<input {...register('entry_fee_note')} /></label>
          <p className="field-hint">{t('entryFeeNoteHint')}</p>
        </section>

        {mutation.isError && <p className="form-error" role="alert">{eventErrorMessage(mutation.error)}</p>}
        <div className="form-tab-navigation">
          <button type="button" className="link-button" onClick={discardChanges}>{t('cancel')}</button>
          <button className="primary-button" type="submit" disabled={mutation.isPending || (isEdit && !isDirty)}>{mutation.isPending ? t('saving') : isEdit ? t('saveChanges') : t('createEvent')}</button>
          <span className="form-tab-navigation-spacer" aria-hidden="true" />
          <button type="button" className="quiet-button" disabled={activeTab === 0} onClick={() => setActiveTab((tab) => Math.max(0, tab - 1))}>{t('previousTab')}</button>
          <button type="button" className="quiet-button" disabled={activeTab === EVENT_TABS.length - 1} onClick={() => setActiveTab((tab) => Math.min(EVENT_TABS.length - 1, tab + 1))}>{t('nextTab')}</button>
        </div>
      </form>
      {savedModalOpen && <Modal title={t('eventSavedTitle')} onClose={() => setSavedModalOpen(false)}>
        <p>{t('eventSavedMessage')}</p>
        <div className="dashboard-series-card-actions">
          <button type="button" className="quiet-button" onClick={() => setSavedModalOpen(false)}>{t('close')}</button>
        </div>
      </Modal>}
      {discardModalOpen && <Modal title={t('confirmAction')} onClose={() => setDiscardModalOpen(false)}>
        <p>{t('confirmDiscardChanges')}</p>
        <div className="dashboard-series-card-actions">
          <button type="button" className="quiet-button" onClick={() => { setDiscardModalOpen(false); void navigate({ to: '/dashboard/series/$seriesId', params: { seriesId } }) }}>{t('discardChanges')}</button>
          <button type="button" className="link-button" onClick={() => setDiscardModalOpen(false)}>{t('cancel')}</button>
        </div>
      </Modal>}
    </section>
  </main>
}
