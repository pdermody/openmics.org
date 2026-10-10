import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type UseFormSetError } from 'react-hook-form'
import { z } from 'zod'
import { Link, useNavigate } from '@tanstack/react-router'
import { ApiError, friendlyApiErrorMessage } from '../api/client'
import { LocationPicker } from '../components/location/LocationPicker'
import { CityAutocomplete } from '../components/location/CityAutocomplete'
import { useCity, type City } from '../features/cities'
import { useCreateEvent, useEventDetail, useOpenMicDetail, useOrganizerProfile, useOrganizerSeriesEvents, useUpdateEvent, type EventDetail, type EventFormInput, type OpenMicDetail } from '../features/organizer'
import { CURRENCIES } from '../features/currencies'
import { ACTIVITY_LABEL_KEYS, browserTimeZone, COUNTRY_OPTIONS, formatTimeZoneOption, TIME_ZONE_OPTIONS } from '../features/form-options'
import { formatInstantInTimeZone, instantPlusMilliseconds, millisecondsBetweenLocalDateTimes, resolveLocalDateTime } from '../features/eventDateTime'
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

function toDatetimeLocalValue(iso: string | null | undefined, timeZone = browserTimeZone()): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return formatInstantInTimeZone(date, timeZone)
}

function fromDatetimeLocalValue(value: string, timeZone: string): string | undefined {
  if (!value) return undefined
  const resolution = resolveLocalDateTime(value, timeZone)
  return resolution.kind === 'valid' ? resolution.instant.toISOString() : undefined
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
    // The default plan rejects unlimited capacity and any value above 50 (decisions.md →
    // Organizer DEFAULT_PLAN values), mirrored client-side as a friendly error; the API's
    // PLAN_LIMIT_EXCEEDED (scope event_capacity) remains authoritative.
    capacity: z.string().trim().min(1, 'Capacity is required (max 50)').refine((value) => {
      const parsed = Number(value)
      return Number.isInteger(parsed) && parsed >= 1 && parsed <= 50
    }, 'Capacity must be a whole number between 1 and 50'),
    override_location: z.boolean(),
    venue_name: z.string().trim().min(1, 'Venue name is required'),
    activities: z.array(z.string()).optional(),
    tags: z.string().optional(),
    notes: z.string().trim().optional(),
    public_information: z.string().trim().optional(),
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
    for (const field of ['starts_at', 'ends_at', 'registrations_closed_at'] as const) {
      if (!value[field]) continue
      let resolution: ReturnType<typeof resolveLocalDateTime>
      try {
        resolution = resolveLocalDateTime(value[field], value.time_zone)
      } catch {
        ctx.addIssue({ code: 'custom', message: 'eventTimeInvalidZone', path: ['time_zone'] })
        continue
      }
      if (resolution.kind === 'nonexistent') {
        ctx.addIssue({ code: 'custom', message: 'eventTimeDstGap', path: [field] })
      }
    }
    let duration: number | undefined
    try {
      duration = value.starts_at && value.ends_at
        ? millisecondsBetweenLocalDateTimes(value.starts_at, value.ends_at, value.time_zone)
        : undefined
    } catch {
      duration = undefined
    }
    if (duration !== undefined && duration <= 0) {
      ctx.addIssue({ code: 'custom', message: 'eventEndAfterStart', path: ['ends_at'] })
    }
    if (value.override_location && value.venue_pin_confirmed === false) {
      ctx.addIssue({ code: 'custom', message: 'cityPickerPinRequired', path: ['lat'] })
    }
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
  city_id: null,
  venue_pin_confirmed: true,
  country: '',
  lat: undefined,
  lng: undefined,
  activities: [],
  tags: '',
  notes: '',
  public_information: '',
  entry_fee_amount: '',
  entry_fee_currency: '',
  entry_fee_note: '',
}

const DEFAULT_EVENT_DURATION_MS = 3 * 60 * 60 * 1000

function seriesDefaultValues(openMic: OpenMicDetail): EventFormValues {
  return {
    ...DEFAULT_VALUES,
    public_information: openMic.public_information ?? '',
    time_zone: openMic.time_zone,
    activities: openMic.activities,
    venue_name: openMic.venue_name,
    address_line1: openMic.address_line1,
    address_line2: openMic.address_line2 ?? '',
    postcode: openMic.postcode ?? '',
    city: openMic.city,
    city_id: openMic.city_id ?? null,
    venue_pin_confirmed: true,
    country: openMic.country,
    lat: openMic.lat ?? undefined,
    lng: openMic.lng ?? undefined,
  }
}

function copiedEventValues(event: EventDetail): EventFormValues {
  const startsAt = toDatetimeLocalValue(event.starts_at, event.time_zone)
  const endsAt = event.ends_at
    ? toDatetimeLocalValue(event.ends_at, event.time_zone)
    : instantPlusMilliseconds(event.starts_at, DEFAULT_EVENT_DURATION_MS, event.time_zone)
  return {
    ...DEFAULT_VALUES,
    title: event.title,
    starts_at: startsAt,
    ends_at: endsAt,
    time_zone: event.time_zone,
    capacity: event.capacity ? String(event.capacity) : '',
    override_location: true,
    venue_name: event.venue_name,
    address_line1: event.address_line1,
    address_line2: event.address_line2 ?? '',
    postcode: event.postcode ?? '',
    city: event.city,
    city_id: event.city_id ?? null,
    venue_pin_confirmed: true,
    country: event.country,
    lat: event.lat ?? undefined,
    lng: event.lng ?? undefined,
    activities: event.activities ?? [],
    tags: (event.tags ?? []).join(', '),
    notes: event.notes ?? '',
    public_information: event.public_information ?? '',
    entry_fee_amount: event.entry_fee_amount ? String(event.entry_fee_amount) : '',
    entry_fee_currency: event.entry_fee_currency ?? '',
    entry_fee_note: event.entry_fee_note ?? '',
  }
}

function eventErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'We could not save this event. Please try again.'
  if (error.code === 'CITY_CATALOGUE_IMPORT_REQUIRED'
    || (error.details as { reason?: string } | undefined)?.reason === 'retired') {
    return friendlyApiErrorMessage(error)
  }
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

export function EventFormPage({ seriesId, eventId, sourceEventId: initialSourceEventId, copySchedule = false, theme, mode }: { seriesId: string; eventId?: string; sourceEventId?: string; copySchedule?: boolean; theme: ThemeId; mode: ColorMode }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const isEdit = Boolean(eventId)
  const { context, activeProfile, isOrganizer } = useOrganizerProfile()
  const openMic = useOpenMicDetail(seriesId)
  const existing = useEventDetail(seriesId, eventId)
  const [sourceEventId, setSourceEventId] = useState(isEdit ? '' : initialSourceEventId ?? '')
  const sourceEvent = useEventDetail(seriesId, !isEdit ? sourceEventId || undefined : undefined)
  const canManageSeries = Boolean(isOrganizer && activeProfile && openMic.data?.owner_profile_id === activeProfile.id)
  const sourceEvents = useOrganizerSeriesEvents(seriesId, !isEdit && canManageSeries)
  const createEvent = useCreateEvent(seriesId)
  const updateEvent = useUpdateEvent(seriesId, eventId)
  const durationMs = useRef(DEFAULT_EVENT_DURATION_MS)

  const { register, handleSubmit, watch, setValue, setError, clearErrors, reset, formState } = useForm<EventFormValues>({
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
  const cityId = watch('city_id')
  const selectedCity = useCity(cityId)
  const pinConfirmed = watch('venue_pin_confirmed') !== false
  const country = watch('country')
  const postcode = watch('postcode')
  const activities = watch('activities') ?? []
  const entryFeeAmount = watch('entry_fee_amount')
  const registrationsClosedAt = watch('registrations_closed_at') ?? ''
  const startValue = watch('starts_at')
  const endValue = watch('ends_at')
  const timeZone = watch('time_zone')
  const existingEvent = existing.data
  const onlineRegistrationMode = openMic.data?.registration_mode === 'pre_only' || openMic.data?.registration_mode === 'both'
  const registrationsClosed = Boolean(registrationsClosedAt) && new Date(registrationsClosedAt).getTime() <= Date.now()
  const eventPhase = existingEvent?.phase

  // New events retain an independent snapshot of the parent series location.
  useEffect(() => {
    if (isEdit || !openMic.data || sourceEventId) return
    durationMs.current = DEFAULT_EVENT_DURATION_MS
    reset(seriesDefaultValues(openMic.data))
  }, [isEdit, openMic.data, reset, sourceEventId])

  useEffect(() => {
    const source = sourceEvent.data
    if (isEdit || !sourceEventId || !source || source.open_mic_id !== seriesId) return
    reset(copiedEventValues(source))
    const duration = source.ends_at
      ? new Date(source.ends_at).getTime() - new Date(source.starts_at).getTime()
      : DEFAULT_EVENT_DURATION_MS
    durationMs.current = duration > 0 ? duration : DEFAULT_EVENT_DURATION_MS
  }, [isEdit, reset, seriesId, sourceEvent.data, sourceEventId, sourceEvents.data])

  useEffect(() => {
    if (!existing.data) return
    setRegistrationTogglePending(false)
    reset({
      title: existing.data.title,
      starts_at: toDatetimeLocalValue(existing.data.starts_at, existing.data.time_zone),
      ends_at: toDatetimeLocalValue(existing.data.ends_at, existing.data.time_zone),
      time_zone: existing.data.time_zone,
      status: existing.data.status,
      registrations_closed_at: toDatetimeLocalValue(existing.data.registrations_closed_at, existing.data.time_zone),
      open_registrations: !isRegistrationClosed(existing.data),
      capacity: existing.data.capacity ? String(existing.data.capacity) : '',
      override_location: true,
      venue_name: existing.data.venue_name,
      address_line1: existing.data.address_line1,
      address_line2: existing.data.address_line2 ?? '',
      postcode: existing.data.postcode ?? '',
      city: existing.data.city,
      city_id: existing.data.city_id ?? null,
      venue_pin_confirmed: true,
      country: existing.data.country,
      lat: existing.data.lat ?? undefined,
      lng: existing.data.lng ?? undefined,
      activities: existing.data.activities ?? [],
      tags: (existing.data.tags ?? []).join(', '),
      notes: existing.data.notes ?? '',
      public_information: existing.data.public_information ?? '',
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

  const sourceEventsNow = Date.now()
  const nearbyPastEvents = (sourceEvents.data ?? [])
    .filter((item) => new Date(item.starts_at).getTime() < sourceEventsNow)
    .sort((left, right) => new Date(right.starts_at).getTime() - new Date(left.starts_at).getTime())
    .slice(0, 5)
  const nearbyUpcomingEvents = (sourceEvents.data ?? [])
    .filter((item) => new Date(item.starts_at).getTime() >= sourceEventsNow)
    .sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime())
    .slice(0, 5)
  const chosenSourceEvents = [...nearbyUpcomingEvents, ...nearbyPastEvents]
  const chosenSourceIds = new Set(chosenSourceEvents.map((item) => item.id))
  const remainingSourceEvents = (sourceEvents.data ?? [])
    .filter((item) => !chosenSourceIds.has(item.id))
    .sort((left, right) => Math.abs(new Date(left.starts_at).getTime() - sourceEventsNow) - Math.abs(new Date(right.starts_at).getTime() - sourceEventsNow))
    .slice(0, Math.max(0, 10 - chosenSourceEvents.length))
  const sourceEventOptions = [...chosenSourceEvents, ...remainingSourceEvents]
    .sort((left, right) => {
      const leftFuture = new Date(left.starts_at).getTime() >= sourceEventsNow
      const rightFuture = new Date(right.starts_at).getTime() >= sourceEventsNow
      if (leftFuture !== rightFuture) return leftFuture ? -1 : 1
      const delta = new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime()
      return leftFuture ? delta : -delta
    })
  const linkedSourceEvent = sourceEvent.data?.open_mic_id === seriesId ? sourceEvent.data : undefined
  const visibleSourceEvents = sourceEventId && linkedSourceEvent
    && !sourceEventOptions.some((item) => item.id === sourceEventId)
    ? [...sourceEventOptions.slice(0, 9), linkedSourceEvent]
    : sourceEventOptions
  const copyScheduleForEvent = !isEdit && copySchedule && Boolean(sourceEventId)

  function changeStart(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value
    if (isEdit) {
      setValue('starts_at', value, { shouldDirty: true, shouldValidate: true })
      return
    }
    setValue('starts_at', value, { shouldDirty: true, shouldValidate: true })
    if (!value) return
    try {
      const resolved = resolveLocalDateTime(value, timeZone)
      if (resolved.kind !== 'valid') {
        setError('starts_at', { type: 'validate', message: resolved.kind === 'ambiguous' ? 'eventTimeDstFold' : 'eventTimeDstGap' })
        return
      }
      clearErrors('starts_at')
      setValue('ends_at', instantPlusMilliseconds(resolved.instant.toISOString(), durationMs.current, timeZone), { shouldDirty: true, shouldValidate: true })
      clearErrors('ends_at')
    } catch {
      setError('time_zone', { type: 'validate', message: 'eventTimeInvalidZone' })
    }
  }

  function changeEnd(event: ChangeEvent<HTMLInputElement>) {
    const value = event.target.value
    setValue('ends_at', value, { shouldDirty: true, shouldValidate: true })
    if (isEdit || !startValue || !value) return
    try {
      const duration = millisecondsBetweenLocalDateTimes(startValue, value, timeZone)
      if (duration !== undefined && duration > 0) durationMs.current = duration
    } catch {
      setError('time_zone', { type: 'validate', message: 'eventTimeInvalidZone' })
    }
  }

  function changeSource(value: string) {
    setSourceEventId(value)
    if (!value) durationMs.current = DEFAULT_EVENT_DURATION_MS
  }

  function changeTimeZone(value: string) {
    setValue('time_zone', value, { shouldDirty: true, shouldValidate: true })
    if (isEdit || !startValue) return
    try {
      const start = resolveLocalDateTime(startValue, value)
      if (start.kind === 'valid') {
        setValue('ends_at', instantPlusMilliseconds(start.instant.toISOString(), durationMs.current, value), { shouldDirty: true, shouldValidate: true })
      }
    } catch {
      setError('time_zone', { type: 'validate', message: 'eventTimeInvalidZone' })
    }
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
    for (const field of ['starts_at', 'ends_at'] as const) {
      const resolution = resolveLocalDateTime(values[field], values.time_zone)
      const original = isEdit && existing.data
        ? field === 'starts_at' ? existing.data.starts_at : existing.data.ends_at
        : undefined
      const unchangedOriginal = Boolean(original && values[field] === toDatetimeLocalValue(original, values.time_zone))
      if (resolution.kind === 'ambiguous' && !unchangedOriginal) {
        setError(field, { type: 'validate', message: 'eventTimeDstFold' })
        return
      }
    }
    if (values.registrations_closed_at) {
      const closeAt = resolveLocalDateTime(values.registrations_closed_at, values.time_zone)
      const originalCloseAt = existing.data?.registrations_closed_at
      const unchangedOriginal = Boolean(originalCloseAt
        && values.registrations_closed_at === toDatetimeLocalValue(originalCloseAt, values.time_zone))
      if (closeAt.kind === 'ambiguous' && !unchangedOriginal) {
        setError('registrations_closed_at', { type: 'validate', message: 'eventTimeDstFold' })
        return
      }
    }
    const toStoredInstant = (value: string, original?: string | null) => (
      isEdit && original && value === toDatetimeLocalValue(original, values.time_zone)
        ? original
        : fromDatetimeLocalValue(value, values.time_zone)!
    )
    const input: EventFormInput = {
      title: values.title,
      starts_at: toStoredInstant(values.starts_at, existing.data?.starts_at),
      ends_at: toStoredInstant(values.ends_at, existing.data?.ends_at),
      time_zone: values.time_zone,
      status: values.status,
      registrations_closed_at: isEdit
        ? (values.registrations_closed_at ? toStoredInstant(values.registrations_closed_at, existing.data?.registrations_closed_at) : null)
        : values.open_registrations
          ? undefined
          : values.registrations_closed_at
            ? toStoredInstant(values.registrations_closed_at)
            : new Date().toISOString(),
      capacity: values.capacity ? Number(values.capacity) : undefined,
      activities: values.activities && values.activities.length > 0 ? values.activities : undefined,
      tags: (values.tags ?? '').split(',').map((tag) => tag.trim()).filter(Boolean),
      notes: values.notes || undefined,
      public_information: values.public_information || null,
      entry_fee_amount: values.entry_fee_amount ? Number(values.entry_fee_amount) : undefined,
      entry_fee_currency: values.entry_fee_currency || undefined,
      entry_fee_note: values.entry_fee_note || undefined,
      ...(values.override_location ? {
        venue_name: values.venue_name,
        address_line1: values.address_line1,
        address_line2: values.address_line2 || undefined,
        postcode: values.postcode || undefined,
        city: values.city,
        city_id: values.city_id ?? null,
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
    setValue('registrations_closed_at', registrationsClosed ? '' : toDatetimeLocalValue(new Date().toISOString(), timeZone), { shouldDirty: true })
    setRegistrationTogglePending(true)
  }

  function changeCity(text: string, selected: City | null) {
    const value = { text, city: selected }
    setValue('city', value.text, { shouldDirty: true, shouldValidate: true })
    setValue('city_id', value.city?.id ?? null, { shouldDirty: true })
    if (value.city) {
      setValue('country', value.city.iso2, { shouldDirty: true, shouldValidate: true })
      setValue('lat', value.city.lat, { shouldDirty: true })
      setValue('lng', value.city.lng, { shouldDirty: true })
      setValue('venue_pin_confirmed', false, { shouldDirty: true, shouldValidate: true })
    } else if (!pinConfirmed) {
      setValue('lat', undefined, { shouldDirty: true, shouldValidate: true })
      setValue('lng', undefined, { shouldDirty: true, shouldValidate: true })
      setValue('venue_pin_confirmed', true, { shouldDirty: true })
    }
  }

  function discardChanges() {
    if (isDirty) { setDiscardModalOpen(true); return }
    void navigate({ to: '/dashboard/series/$seriesId', params: { seriesId } })
  }

  if (context.account.isPending || context.profiles.isPending || openMic.isPending || (isEdit && existing.isPending)
    || (!isEdit && Boolean(sourceEventId) && sourceEvents.isPending)) {
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
      <Link className="back-link" to="/dashboard/series/$seriesId" params={{ seriesId }}>{openMic.data?.name ? t('backToNamedSeries', { series: openMic.data.name }) : t('backToSeries')}</Link>
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
          {!isEdit && <div className="event-copy-source">
            <label><span>{t('eventCopySource')}</span><select value={sourceEventId} onChange={(event) => changeSource(event.target.value)}>
              <option value="">{t('eventCopySeriesDefaults')}</option>
              {visibleSourceEvents.map((item) => <option key={item.id} value={item.id}>
                {item.title} — {new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: item.time_zone }).format(new Date(item.starts_at))}
                {' · '}{item.venue_name}, {item.city} · {t(item.status === 'draft' ? 'statusDraft' : 'statusPublished')}
              </option>)}
            </select></label>
            {sourceEvents.data?.length === 0 && !sourceEventId && <p className="field-hint">{t('eventCopyNoSources')}</p>}
            {sourceEvents.isError && <div role="alert"><p>{t('eventCopyListError')}</p><button type="button" className="quiet-button" onClick={() => void sourceEvents.refetch()}>{t('eventCopyRetry')}</button></div>}
            {sourceEventId && (!sourceEvent.data || sourceEvent.data.open_mic_id !== seriesId) && !sourceEvent.isPending && <p className="form-error" role="alert">{t('eventCopyUnavailable')}</p>}
          </div>}
          <label><span>{t('eventTitle')}<Required /></span><input required {...register('title')} /></label>
          {errors.title && <p className="form-error" role="alert">{errors.title.message}</p>}
          <label><span>{t('startsAt')}<Required /></span><input required type="datetime-local" {...register('starts_at')} value={startValue} onChange={changeStart} /></label>
          {errors.starts_at && <p className="form-error" role="alert">{t(errors.starts_at.message ?? '')}</p>}
          <label><span>{t('endsAt')}<Required /></span><input required type="datetime-local" {...register('ends_at')} value={endValue} onChange={changeEnd} /></label>
          {errors.ends_at && <p className="form-error" role="alert">{t(errors.ends_at.message ?? '')}</p>}
          {copyScheduleForEvent && sourceEvent.data && <p className="field-hint">{t('eventCopyScheduleHint', { timeZone: sourceEvent.data.time_zone })}</p>}
          {!isEdit && !sourceEventId && <p className="field-hint">{t('eventDefaultDurationHint')}</p>}
          {errors.time_zone && <p className="form-error" role="alert">{t(errors.time_zone.message ?? '')}</p>}
          {!isEdit && <label>{t('eventPublication')}<select value="draft" disabled><option value="draft">{t('statusDraft')}</option></select></label>}
          {isEdit && <label>{t('eventPublication')}<select {...register('status')}><option value="draft">{t('statusDraft')}</option><option value="published">{t('statusPublished')}</option></select></label>}
          {isEdit && eventPhase && <p className="field-hint">{t('eventPhaseLabel')}: {t(`eventPhase${eventPhase[0].toUpperCase()}${eventPhase.slice(1)}`)}</p>}
          <label><span>{t('suggestedAttendanceLimit')}<Required /></span><input type="number" min="1" max="50" required {...register('capacity')} /></label>
          <p className="field-hint">{t('eventCapacityHint')}</p>
          {errors.capacity && <p className="form-error" role="alert">{errors.capacity.message}</p>}
        </section>

        <section id="event-tab-schedule" role="tabpanel" hidden={activeTab !== 1}>
          <label><span>{t('timeZone')}<Required /></span><select required {...register('time_zone')} value={timeZone} onChange={(event) => changeTimeZone(event.target.value)}>{TIME_ZONE_OPTIONS.map((zone) => <option key={zone} value={zone}>{formatTimeZoneOption(zone)}</option>)}</select></label>
          {errors.time_zone && <p className="form-error" role="alert">{t(errors.time_zone.message ?? '')}</p>}
          <p className="field-hint">{t('timeZoneFormHint')}</p>
          <p className="field-hint">{onlineRegistrationMode ? t('eventOnlineRegistrationEnabled') : t('eventOnlineRegistrationDisabled')}</p>
          {isEdit && eventPhase === 'past' && <p className="field-hint">{t('eventRegistrationEnded')}</p>}
          {isEdit && onlineRegistrationMode && <>
            <label>{t('closeAt')}<input type="datetime-local" {...register('registrations_closed_at')} /></label>
            <p className="field-hint">{t('closeAtHint')}</p>
            <button className="quiet-button" type="button" onClick={toggleRegistrationAvailability}>{registrationsClosed ? t('reopenRegistrations') : t('stopRegistrations')}</button>
            {registrationTogglePending && isDirty && <p className="field-hint" role="status">{t('saveRegistrationChangeHint')}</p>}
          </>}
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
            <CityAutocomplete name="city" required value={city} selectedCity={selectedCity.data} onChange={changeCity} />
            {errors.city && <p className="form-error" role="alert">{errors.city.message}</p>}
            {!selectedCity.data && <label><span>{t('country')}<Required /></span><select required {...register('country', { onChange: () => setValue('city_id', null, { shouldDirty: true }) })}><option value="">{t('selectCountry')}</option>{COUNTRY_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.name} ({option.code})</option>)}</select></label>}
            {errors.country && <p className="form-error" role="alert">{errors.country.message}</p>}
            <p className="field-hint">{t('locationFieldsHint')}</p>
            <LocationPicker provisional={!pinConfirmed} onConfirm={() => setValue('venue_pin_confirmed', true, { shouldDirty: true, shouldValidate: true })} lat={lat} lng={lng} onChange={({ lat: nextLat, lng: nextLng }) => { setValue('lat', nextLat, { shouldDirty: true, shouldValidate: true }); setValue('lng', nextLng, { shouldDirty: true, shouldValidate: true }); setValue('venue_pin_confirmed', nextLat !== undefined && nextLng !== undefined, { shouldDirty: true, shouldValidate: true }) }} addressQuery={[addressLine1, postcode, city, country].filter(Boolean).join(', ')} latInputId="event-lat" lngInputId="event-lng" />
            {errors.lat && <p className="form-error" role="alert">{errors.lat.message === 'cityPickerPinRequired' ? t('cityPickerPinRequired') : errors.lat.message}</p>}
            {errors.lng && <p className="form-error" role="alert">{errors.lng.message}</p>}
          </>}
        </section>

        <section id="event-tab-registration" role="tabpanel" hidden={activeTab !== 3}>
          <fieldset><legend>{t('activities')}</legend>{ACTIVITIES.map((activity) => <label className="checkbox-label" key={activity}><input type="checkbox" checked={activities.includes(activity)} onChange={() => toggleActivity(activity)} /><span>{t(ACTIVITY_LABEL_KEYS[activity])}</span></label>)}</fieldset>
          <label>{t('tags')}<input {...register('tags')} /></label>
          <p className="field-hint">{t('seriesTagsHint')}</p>
          <label>{t('eventInformation')}<textarea {...register('public_information')} /></label>
          <p className="field-hint">{t('publicInformationHint')}</p>
          <label>{t('privateOrganizerNotes')}<textarea {...register('notes')} /></label>
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
