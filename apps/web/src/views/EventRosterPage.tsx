import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CityAutocomplete } from '../components/location/CityAutocomplete'
import { useCity } from '../features/cities'
import { registrationFormSchema, type RegistrationFormValues } from '../features/registration-form'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, DoorOpen, Eye, Image, ImagePlus, Lock, LockOpen, MapPin, Pencil } from 'lucide-react'
import { friendlyApiErrorMessage } from '../api/client'
import { ActionMenu } from '../components/ActionMenu'
import { OrganizerAttendance } from '../components/OrganizerAttendance'
import { EventManagementActions } from '../components/EventManagementActions'
import { copyRegistrationLink, downloadRegistrationQr } from '../components/RegistrationLinkTools'
import {
  PERFORMANCE_BOARD_STATUSES,
  PERFORMANCE_STATUS_LABELS,
  useSetRegistrationsClosed,
  useCreatePerformance,
  useDeletePerformance,
  useEventDetail,
  useEventRoster,
  useOpenMicDetail,
  useOrganizerProfile,
  useRosterLiveUpdates,
  useUpdatePerformance,
  useUpdateRegistration,
  type Performance,
  type PerformanceStatus,
  type RegistrationEditInput,
  type RosterRegistration,
} from '../features/organizer'
import { isRegistrationClosed } from '../features/publicReads'
import { canAttributeMedia } from '../features/media'
import { RegistrationMediaUploadModal } from '../components/media/RegistrationMediaUploadModal'
import type { ColorMode, ThemeId } from '../theme'
import { Modal, ReadState, Required, RequiredFieldsNote, SiteHeader } from './shared'

const PROVENANCE_FILTERS = ['all', 'pending'] as const
type ProvenanceFilter = (typeof PROVENANCE_FILTERS)[number]

// One flattened row per performance, carrying its parent registration's contact/provenance info
// alongside it — the roster no longer shows registrations and performances as separate concepts.
type PerformerCardData = { registration: RosterRegistration; performance: Performance }

// A registration's provenance/verification classification — shown on card "Details" (still every
// registration's own concern) even though the filter bar itself now only distinguishes All/Pending.
type ProvenanceKey = 'pending' | 'verified' | 'kiosk' | 'kiosk_qr'

// Visibility-safe provenance: mirrors the server's "Publicly visible / valid" rule
// (organizer_supervised OR email_verified_at). Registration "claiming" is a separate
// attribution concept (which account a registration is linked to) that doesn't affect roster
// eligibility, so it's intentionally left out of this roster-facing categorization.
function provenanceOf(registration: RosterRegistration): { key: ProvenanceKey; label: string } {
  if (registration.organizer_supervised) return { key: 'kiosk', label: 'Kiosk' }
  if (registration.submission_channel === 'kiosk_qr') return { key: 'kiosk_qr', label: 'Kiosk QR' }
  if (registration.email_verified_at) return { key: 'verified', label: 'Verified' }
  return { key: 'pending', label: 'Pending' }
}

// The kanban board only makes sense for registrations that are actually going to happen:
// verified self-registrations and kiosk (organizer-supervised) ones. Registrations still
// awaiting email confirmation aren't board-eligible yet — they're shown in a separate, simple
// "Pending confirmation" list instead (see PendingRegistrationRow) until they verify.
function isBoardEligible(registration: RosterRegistration): boolean {
  return registration.organizer_supervised || Boolean(registration.email_verified_at)
}

// Matches the wide-screen breakpoint used elsewhere for the roster board vs. the small-screen
// single-list-with-filters fallback (kanban columns need real horizontal space to be usable).
function useIsWideScreen(): boolean {
  const query = '(min-width: 900px)'
  const [isWide, setIsWide] = useState(() => (typeof window === 'undefined' ? true : window.matchMedia(query).matches))
  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setIsWide(list.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [])
  return isWide
}

// Registration details, shown in every column (including Performed) via a real modal so it's
// never clipped by the roster board's scroll container.
function RegistrationDetailsModal({ registration, onClose, onEdit, onAddMedia }: {
  registration: RosterRegistration
  onClose: () => void
  onEdit: () => void
  onAddMedia: () => void
}) {
  const { t } = useTranslation()
  const info = provenanceOf(registration)
  const canAddMedia = canAttributeMedia(registration)
  return <Modal title={`Registration details for ${registration.performer_name}`} onClose={onClose}>
    <div className="registration-details-actions">
      <button type="button" className="quiet-button icon-button" onClick={onEdit} aria-label={t('edit')} title={t('edit')}><Pencil size={17} aria-hidden="true" /></button>
      <button type="button" className="quiet-button icon-button" onClick={onAddMedia} disabled={!canAddMedia} aria-label={t('mediaAdd')} title={t('mediaAdd')} aria-describedby={!canAddMedia ? `media-eligibility-${registration.id}` : undefined}><ImagePlus size={17} aria-hidden="true" /></button>
    </div>
    {!canAddMedia && <p id={`media-eligibility-${registration.id}`} className="field-hint">{t(registration.media_consent ? 'mediaRegistrationNotEligible' : 'mediaRegistrationNeedsConsent')}</p>}
    <span className={`roster-badge roster-badge-${info.key}`}>{info.label}</span>
    <dl>
      {registration.performer_city && <><dt>{t('city')}</dt><dd>{registration.performer_city}</dd></>}
      {registration.contact_email && <><dt>{t('email')}</dt><dd>{registration.contact_email}</dd></>}
      {registration.contact_phone && <><dt>{t('phone')}</dt><dd>{registration.contact_phone}</dd></>}
      {registration.song_names.length > 0 && <><dt>{t('songs')}</dt><dd>{registration.song_names.join(', ')}</dd></>}
      {/* The "Kiosk"/"Verified" badge above already covers verified/kiosk sign-ups; only call out
          the still-unverified case, since that's the one an organizer needs to notice. */}
      {!registration.organizer_supervised && !registration.email_verified_at && <><dt>{t('emailVerification')}</dt><dd><span className="roster-badge roster-badge-pending">{t('pendingVerification')}</span></dd></>}
      <dt>{t('mediaConsent')}</dt><dd>{registration.media_consent ? t('yes') : t('no')}</dd>
    </dl>
  </Modal>
}

// Lets an organizer correct what a performer supplied at registration (e.g. a mistyped name or
// contact info). Mirrors the server's updateRegistrationSchema field set exactly.
export function RegistrationEditModal({ eventId, registration, onClose }: { eventId: string; registration: RosterRegistration; onClose: () => void }) {
  const { t } = useTranslation()
  const updateRegistration = useUpdateRegistration(eventId)
  const [discardModalOpen, setDiscardModalOpen] = useState(false)
  const { watch, setValue, handleSubmit, formState: { isDirty, errors } } = useForm<RegistrationFormValues>({
    resolver: zodResolver(registrationFormSchema),
    defaultValues: {
    performer_name: registration.performer_name,
    performer_city: registration.performer_city ?? '',
    performer_city_id: registration.performer_city_id ?? null,
    contact_email: registration.contact_email ?? '',
    contact_phone: registration.contact_phone ?? '',
    song_names: registration.song_names.join(', '),
    media_consent: registration.media_consent,
    },
  })
  const form = watch()
  const selectedCity = useCity(form.performer_city_id)
  const requestClose = () => { if (isDirty) setDiscardModalOpen(true); else onClose() }

  const submit = () => {
    const input: RegistrationEditInput = {
      performer_name: form.performer_name.trim(),
      performer_city: form.performer_city.trim() || null,
      performer_city_id: form.performer_city_id,
      contact_email: form.contact_email.trim(),
      contact_phone: form.contact_phone.trim(),
      song_names: form.song_names.split(',').map((name) => name.trim()).filter(Boolean),
      media_consent: form.media_consent,
    }
    updateRegistration.mutate({ id: registration.id, ...input }, { onSuccess: onClose })
  }

  return <><Modal title={`Edit registration for ${registration.performer_name}`} onClose={requestClose}>
    <form className="registration-form" onSubmit={handleSubmit(submit)}>
      <label><span>{t('performerName')}<Required /></span><input required value={form.performer_name} onChange={(event) => setValue('performer_name', event.target.value, { shouldDirty: true })} /></label>
      <CityAutocomplete value={form.performer_city} selectedCity={selectedCity.data} onChange={(value, city) => {
        setValue('performer_city', value, { shouldDirty: true })
        setValue('performer_city_id', city?.id ?? null, { shouldDirty: true })
      }} />
      <label>{t('email')}<input type="email" value={form.contact_email} onChange={(event) => setValue('contact_email', event.target.value, { shouldDirty: true })} /></label>
      <label>{t('phone')}<input type="tel" value={form.contact_phone} onChange={(event) => setValue('contact_phone', event.target.value, { shouldDirty: true })} /></label>
      <label>{t('songsComma')}<input value={form.song_names} onChange={(event) => setValue('song_names', event.target.value, { shouldDirty: true })} /></label>
      <label className="checkbox-label"><input type="checkbox" checked={form.media_consent} onChange={(event) => setValue('media_consent', event.target.checked, { shouldDirty: true })} /> {t('mediaConsent')}</label>
      {errors.contact_email && <p className="form-error" role="alert">{t('cityPickerEmailInvalid')}</p>}
      <RequiredFieldsNote />
      {updateRegistration.isError && <p className="form-error">{friendlyApiErrorMessage(updateRegistration.error, 'Could not save those changes.')}</p>}
      <div className="dashboard-series-card-actions">
        <button type="submit" className="quiet-button" disabled={!isDirty || updateRegistration.isPending}>{t('save')}</button>
        <button type="button" className="link-button" onClick={requestClose}>{t('cancel')}</button>
      </div>
    </form>
  </Modal>
    {discardModalOpen && <Modal title={t('confirmAction')} onClose={() => setDiscardModalOpen(false)}>
      <p>{t('confirmDiscardChanges')}</p>
      <div className="dashboard-series-card-actions">
        <button type="button" className="quiet-button" onClick={onClose}>{t('discardChanges')}</button>
        <button type="button" className="link-button" onClick={() => setDiscardModalOpen(false)}>{t('cancel')}</button>
      </div>
    </Modal>}
  </>
}

// A dropdown menu portal-rendered to document.body (not a native <details>), so it's never
// clipped by the roster board's overflow-x:auto scroll container regardless of how tall the
// menu's contents are or how close to the bottom of the column the triggering card sits.
function CardMenu({ label, items }: { label: string; items: { label: string; onClick: () => void; disabled?: boolean }[] }) {
  return <ActionMenu label={label} items={items} />
}

// A deliberately plain list row (no move controls, no kanban card styling) for registrations
// that aren't board-eligible yet — just enough to see who's waiting and check what they
// submitted or fix a typo before their confirmation email is verified.
function PendingRegistrationRow({ eventId, registration }: { eventId: string; registration: RosterRegistration }) {
  const { t } = useTranslation()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [mediaOpen, setMediaOpen] = useState(false)

  return <li className="roster-pending-row">
    <span className="performer-card-name">{registration.performer_name}</span>
    <span className="roster-pending-actions">
      <button type="button" className="link-button" onClick={() => setDetailsOpen(true)}>{t('details')}</button>
      <button type="button" className="link-button" onClick={() => setEditOpen(true)}>{t('edit')}</button>
    </span>
    {detailsOpen && <RegistrationDetailsModal registration={registration} onClose={() => setDetailsOpen(false)} onEdit={() => { setDetailsOpen(false); setEditOpen(true) }} onAddMedia={() => { if (canAttributeMedia(registration)) { setDetailsOpen(false); setMediaOpen(true) } }} />}
    {editOpen && <RegistrationEditModal eventId={eventId} registration={registration} onClose={() => setEditOpen(false)} />}
    {mediaOpen && <RegistrationMediaUploadModal eventId={eventId} registration={registration} onClose={() => setMediaOpen(false)} />}
  </li>
}

// The card shows only the performer's name plus move/hamburger controls — no other info on the
// card face (registration details live behind the "Details" modal instead).
export function PerformerCard({
  eventId,
  data,
  isWide,
  sequenceNeighbor,
  columnPosition,
}: {
  eventId: string
  data: PerformerCardData
  isWide: boolean
  // Adjacent cards within the same status column, ordered by `sequence` — only present for
  // Present/Scheduled, where the running order actually matters and might need a manual nudge.
  sequenceNeighbor?: { prev?: Performance; next?: Performance }
  // This card's position within its own status column — used to enforce "only the top of
  // Scheduled can start performing" and "only the last card in Performed can be moved out".
  columnPosition?: { isFirst: boolean; isLast: boolean }
}) {
  const { t } = useTranslation()
  const { registration, performance } = data
  const status = performance.status
  const updatePerformance = useUpdatePerformance(eventId)
  const createPerformance = useCreatePerformance(eventId)
  const deletePerformance = useDeletePerformance(eventId)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [mediaOpen, setMediaOpen] = useState(false)

  const columnIndex = PERFORMANCE_BOARD_STATUSES.indexOf(status)
  const isMainColumn = columnIndex !== -1
  // Only the top-of-queue Scheduled card may start performing; only the most recently finished
  // Performed card may be moved back out (the "moved too early by mistake" fix-up case).
  const canMoveBack = isMainColumn && columnIndex > 0 && (status !== 'performed' || columnPosition?.isLast !== false)
  const canMoveForward = isMainColumn && columnIndex < PERFORMANCE_BOARD_STATUSES.length - 1 && (status !== 'scheduled' || columnPosition?.isFirst !== false)

  const moveTo = (nextStatus: PerformanceStatus) => updatePerformance.mutate({ id: performance.id, status: nextStatus })
  const moveBack = () => canMoveBack && moveTo(PERFORMANCE_BOARD_STATUSES[columnIndex - 1])
  const moveForward = () => canMoveForward && moveTo(PERFORMANCE_BOARD_STATUSES[columnIndex + 1])
  // A second set can only be started from a Performed card (the performer's already finished
  // their current one) — it's always a brand-new performance row, never this card looping back.
  // It's also only offered when none of the registration's other performances are still active
  // (registered/present/scheduled/performing) — a performer can't have two cards in flight at
  // once, so "Perform again" waits until whichever other set is in progress reaches Performed
  // (or no_show/cancelled) too.
  const hasOtherActivePerformance = registration.performances.some(
    (other) => other.id !== performance.id && !['performed', 'no_show', 'cancelled'].includes(other.status),
  )
  const canPerformAgain = status === 'performed' && !hasOtherActivePerformance
  const performAgain = () => createPerformance.mutate({ registration_id: registration.id, name: registration.performer_name, status: 'present' })

  // Swaps this card's `sequence` with its neighbor's, so the running order changes without
  // touching status — a manual override for when the auto-assigned order needs a nudge. Only
  // meaningful in Present/Scheduled (see reorderableNeighbors).
  const swapSequenceWith = (neighbor: Performance) => {
    updatePerformance.mutate({ id: performance.id, sequence: neighbor.sequence })
    updatePerformance.mutate({ id: neighbor.id, sequence: performance.sequence })
  }
  const moveUpInOrder = () => sequenceNeighbor?.prev && swapSequenceWith(sequenceNeighbor.prev)
  const moveDownInOrder = () => sequenceNeighbor?.next && swapSequenceWith(sequenceNeighbor.next)

  // A card is a registration+performance pair: deleting it removes just that performance, unless
  // it's the registration's only one, in which case there's nothing left to show and the whole
  // registration goes with it (they'd need to register again for a future set) — the server
  // decides which happened, but the confirmation copy tells the organizer which to expect.
  const isOnlyPerformance = registration.performances.length === 1

  const menuItems = [
    ...(canMoveBack ? [{ label: 'Move back', onClick: moveBack }] : []),
    ...(canMoveForward ? [{ label: 'Move forward', onClick: moveForward }] : []),
    ...(sequenceNeighbor?.prev ? [{ label: 'Move up in order', onClick: moveUpInOrder }] : []),
    ...(sequenceNeighbor?.next ? [{ label: 'Move down in order', onClick: moveDownInOrder }] : []),
    ...(status === 'registered' ? [{ label: 'No-show', onClick: () => moveTo('no_show') }] : []),
    ...(status === 'no_show' ? [{ label: 'Mark as present', onClick: () => moveTo('present') }] : []),
    ...(canPerformAgain ? [{ label: 'Perform again', onClick: performAgain, disabled: createPerformance.isPending }] : []),
    { label: 'Details', onClick: () => setDetailsOpen(true) },
    { label: 'Edit', onClick: () => setEditOpen(true) },
    { label: 'Delete', onClick: () => setDeleteConfirmOpen(true) },
  ]

  const openCardDetails = (event: MouseEvent<HTMLElement>) => {
    if (!event.currentTarget.contains(event.target as Node) || (event.target as HTMLElement).closest('button, a, input, select, textarea')) return
    setDetailsOpen(true)
  }

  const openCardDetailsWithKeyboard = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    setDetailsOpen(true)
  }

  return <article className="performer-card" role="group" aria-label={`${registration.performer_name} — view registration details`} tabIndex={0} onClick={openCardDetails} onKeyDown={openCardDetailsWithKeyboard}>
    {canMoveBack && <button
      type="button"
      className="performer-card-arrow"
      aria-label={isWide ? 'Move back a stage' : 'Move up a stage'}
      onClick={moveBack}
      disabled={updatePerformance.isPending}
    >
      {isWide ? <ChevronLeft size={16} /> : <ChevronUp size={16} />}
    </button>}

    <span className="performer-card-name">{registration.performer_name}</span>

    {canMoveForward && <button
      type="button"
      className="performer-card-arrow"
      aria-label={isWide ? 'Move forward a stage' : 'Move down a stage'}
      onClick={moveForward}
      disabled={updatePerformance.isPending}
    >
      {isWide ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
    </button>}

    <CardMenu label={`More actions for ${registration.performer_name}`} items={menuItems} />

    {detailsOpen && <RegistrationDetailsModal registration={registration} onClose={() => setDetailsOpen(false)} onEdit={() => { setDetailsOpen(false); setEditOpen(true) }} onAddMedia={() => { if (canAttributeMedia(registration)) { setDetailsOpen(false); setMediaOpen(true) } }} />}
    {editOpen && <RegistrationEditModal eventId={eventId} registration={registration} onClose={() => setEditOpen(false)} />}
    {mediaOpen && <RegistrationMediaUploadModal eventId={eventId} registration={registration} onClose={() => setMediaOpen(false)} />}
    {deleteConfirmOpen && <Modal title={isOnlyPerformance ? 'Delete registration?' : 'Delete this performance?'} onClose={() => setDeleteConfirmOpen(false)}>
      <p>
        {isOnlyPerformance
          ? <>This is {registration.performer_name}&apos;s only performance — deleting it removes their entire registration. They&apos;d need to register again for a future set. This cannot be undone from here.</>
          : <>Delete this performance for {registration.performer_name}? Their registration and other performance(s) will stay. This cannot be undone from here.</>}
      </p>
      {deletePerformance.isError && <p className="form-error">{friendlyApiErrorMessage(deletePerformance.error, 'Could not delete that.')}</p>}
      <div className="dashboard-series-card-actions">
        <button
          type="button"
          className="quiet-button"
          disabled={deletePerformance.isPending}
          onClick={() => deletePerformance.mutate(performance.id, { onSuccess: () => setDeleteConfirmOpen(false) })}
        >
          Delete
        </button>
        <button type="button" className="link-button" onClick={() => setDeleteConfirmOpen(false)}>{t('cancel')}</button>
      </div>
    </Modal>}

    {updatePerformance.isError && <p className="form-error">{friendlyApiErrorMessage(updatePerformance.error, 'Could not save that change.')}</p>}
    {createPerformance.isError && <p className="form-error">{friendlyApiErrorMessage(createPerformance.error, 'Could not start a new performance.')}</p>}
  </article>
}

export function EventRosterPage({ seriesId, eventId, theme, mode }: { seriesId: string; eventId: string; theme: ThemeId; mode: ColorMode }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { context, isOrganizer } = useOrganizerProfile()
  const event = useEventDetail(seriesId, eventId)
  const openMic = useOpenMicDetail(seriesId)
  const roster = useEventRoster(eventId, isOrganizer)
  const [provenanceFilter, setProvenanceFilter] = useState<ProvenanceFilter>('all')
  useRosterLiveUpdates(seriesId, eventId, isOrganizer)
  const isWide = useIsWideScreen()
  const setRegistrationsClosed = useSetRegistrationsClosed(seriesId, eventId)

  const cards = useMemo(() => {
    if (!roster.data) return []
    const rows: PerformerCardData[] = []
    for (const registration of roster.data) {
      if (!isBoardEligible(registration)) continue
      for (const performance of registration.performances) rows.push({ registration, performance })
    }
    return rows
  }, [roster.data])

  // Registrations still awaiting email confirmation (and not organizer-supervised) don't
  // belong on the kanban board yet — surfaced separately so organizers still have visibility.
  const pendingRegistrations = useMemo(
    () => (roster.data ?? []).filter((registration) => !isBoardEligible(registration)),
    [roster.data],
  )

  // Registered has no sequence of its own — cards stay in registration order (the order they
  // arrive in `cards`, since `roster.data` is already registration-created_at ascending). Present
  // and Scheduled are each their own bottom-filled queue, ordered by `sequence`. Performed has no
  // sequence at all: its order is entirely implied by `finished_at` (most recently finished last).
  function sortColumn(status: PerformanceStatus, column: PerformerCardData[]): PerformerCardData[] {
    if (status === 'present' || status === 'scheduled') {
      return [...column].sort((a, b) => a.performance.sequence - b.performance.sequence)
    }
    if (status === 'performed') {
      return [...column].sort((a, b) => new Date(a.performance.finished_at ?? 0).getTime() - new Date(b.performance.finished_at ?? 0).getTime())
    }
    return column
  }

  const board = useMemo(() => {
    const columns = new Map<PerformanceStatus, PerformerCardData[]>(PERFORMANCE_BOARD_STATUSES.map((status) => [status, []]))
    const other: PerformerCardData[] = []
    for (const card of cards) {
      if (card.performance.status === 'no_show' || card.performance.status === 'cancelled') other.push(card)
      else columns.get(card.performance.status)?.push(card)
    }
    for (const status of PERFORMANCE_BOARD_STATUSES) columns.set(status, sortColumn(status, columns.get(status) ?? []))
    return { columns, other }
  }, [cards])

  // Only Present and Scheduled support a manual "Move up/down in order" nudge — Performed has no
  // sequence (order is implied by finished_at) and the other columns don't carry a running order.
  const reorderableNeighbors = (card: PerformerCardData): { prev?: Performance; next?: Performance } | undefined => {
    if (card.performance.status !== 'present' && card.performance.status !== 'scheduled') return undefined
    const column = board.columns.get(card.performance.status) ?? []
    const index = column.findIndex((entry) => entry.performance.id === card.performance.id)
    if (index === -1) return undefined
    return { prev: column[index - 1]?.performance, next: column[index + 1]?.performance }
  }

  // Mobile view groups cards into labeled sections (one per status, in board order) instead of one
  // unlabeled flat list, so it's always clear which stage a performer is in. Sections stay
  // visible even when empty, with a placeholder, so the full flow of stages is always visible.
  const mobileSections = useMemo(() => {
    const statusesToShow: PerformanceStatus[] = [...PERFORMANCE_BOARD_STATUSES, 'no_show', 'cancelled']
    return statusesToShow.map((status) => ({
      status,
      label: PERFORMANCE_STATUS_LABELS[status],
      items: board.columns.get(status) ?? cards.filter((card) => card.performance.status === status),
    }))
  }, [cards, board])

  const registrationCount = roster.data?.length ?? 0
  const isClosed = Boolean(event.data) && isRegistrationClosed(event.data!)
  const supportsOnlineRegistration = ['pre_only', 'both'].includes(openMic.data?.registration_mode ?? '')
  // Pending registrations stay behind the Pending filter so the main roster remains focused.
  const showBoard = provenanceFilter !== 'pending'
  const showPendingList = provenanceFilter === 'pending'

  return <main className="app" data-theme={theme} data-mode={mode}>
    <SiteHeader />
    <section className="dashboard-page">
      <Link className="back-link" to="/dashboard/series/$seriesId" params={{ seriesId }}>{t('backToEvents')}</Link>
      <div className="eyebrow">{t('eventOperations')}</div>
      <h1>{event.data?.title ?? 'Event roster'}</h1>
      {/* Roster is reached from several places (dashboard, kiosk, direct links) — always show
          which event this is, since the title alone can be ambiguous across a series. */}
      {event.data && <p className="event-meta-line">
        <span className="event-meta"><Clock3 size={15} /> {new Date(event.data.starts_at).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}</span>
        <span className="event-meta"><MapPin size={15} /> {event.data.venue_name}, {event.data.city}</span>
      </p>}
      {event.data && isOrganizer && <div className="dashboard-series-card-actions">
        <Link className="quiet-button" to="/dashboard/series/$seriesId/events/$eventId/media" params={{ seriesId, eventId }}><Image size={17} aria-hidden="true" /> {t('mediaManageLink')}</Link>
        <Link className="quiet-button" to="/dashboard/series/$seriesId/events/$eventId/kiosk" params={{ seriesId, eventId }}><DoorOpen size={17} /> {t('openKiosk')}</Link>
        {supportsOnlineRegistration && <button type="button" className="quiet-button" onClick={() => setRegistrationsClosed.mutate(!isClosed)} disabled={setRegistrationsClosed.isPending}>{isClosed ? <LockOpen size={17} /> : <Lock size={17} />} {isClosed ? t('reopenRegistrations') : t('stopRegistrations')}</button>}
        <EventManagementActions openMicId={seriesId} eventId={eventId} onDeleted={() => void navigate({ to: '/dashboard' })} navigationItems={[{ label: t('view'), icon: <Eye size={16} />, onClick: () => void navigate({ to: '/events/$eventId', params: { eventId: event.data?.public_code ?? eventId } }) }, { label: t('edit'), icon: <Pencil size={16} />, onClick: () => void navigate({ to: '/dashboard/series/$seriesId/events/$eventId/edit', params: { seriesId, eventId } }) }, { label: t('copyLink'), onClick: () => void copyRegistrationLink(`${window.location.origin}/events/${eventId}/register`) }, { label: t('downloadQr'), onClick: () => void downloadRegistrationQr(`${window.location.origin}/events/${eventId}/register`, event.data?.public_code ?? eventId) }]} />
      </div>}
      {setRegistrationsClosed.isError && <p className="form-error">{friendlyApiErrorMessage(setRegistrationsClosed.error, 'Could not update registration availability.')}</p>}
      {event.data && <div className="roster-summary">
        <span className="roster-badge">{registrationCount} registration{registrationCount === 1 ? '' : 's'}</span>
        {supportsOnlineRegistration && <span className={isClosed ? 'roster-badge roster-badge-warning' : 'roster-badge'}>{isClosed ? 'Registrations closed' : 'Registrations open'}</span>}
        <span className="roster-badge">{event.data.status} · {event.data.phase}</span>
      </div>}
      {event.data && isOrganizer && <OrganizerAttendance eventId={event.data.id} />}

      {!context.account.data && <ReadState message={t('signInRoster')} />}
      {context.account.data && !isOrganizer && <ReadState message="Select an organizer profile to manage this event's roster." />}
      {isOrganizer && roster.isPending && <ReadState message="Loading roster…" />}
      {isOrganizer && roster.isError && <ReadState message={friendlyApiErrorMessage(roster.error, 'We could not load the roster.')} retry={() => void roster.refetch()} />}

      {isOrganizer && roster.isSuccess && <div className="roster-filters" role="group" aria-label={t('filterRoster')}>
        {PROVENANCE_FILTERS.map((option) => <button
          key={option}
          type="button"
          className={provenanceFilter === option ? 'quiet-button roster-filter-active' : 'quiet-button'}
          aria-pressed={provenanceFilter === option}
          onClick={() => setProvenanceFilter(option)}
        >
          {option === 'all' ? 'All' : <>{option.charAt(0).toUpperCase() + option.slice(1)} <span className="roster-filter-count">{pendingRegistrations.length}</span></>}
        </button>)}
      </div>}

      {isOrganizer && roster.isSuccess && showPendingList && pendingRegistrations.length > 0 && <div className="roster-pending">
        <h2>{t('pendingConfirmation')} <span className="roster-badge">{pendingRegistrations.length}</span></h2>
        <p className="field-hint">{t('pendingConfirmationHint')}</p>
        <ul className="roster-pending-list">
          {pendingRegistrations.map((registration) => <PendingRegistrationRow key={registration.id} eventId={eventId} registration={registration} />)}
        </ul>
      </div>}

      {isOrganizer && roster.isSuccess && showPendingList && !showBoard && pendingRegistrations.length === 0 && <ReadState message="No pending registrations." />}

      {isOrganizer && roster.isSuccess && showBoard && cards.length === 0 && <ReadState message={roster.data.length === 0 ? 'No one has registered for this event yet.' : pendingRegistrations.length > 0 ? 'No board-eligible registrations yet.' : 'No registrations yet.'} />}

      {isOrganizer && roster.isSuccess && showBoard && cards.length > 0 && isWide && <div className="roster-board">
        {PERFORMANCE_BOARD_STATUSES.map((status) => <div key={status} className="roster-board-column">
          <h2>{PERFORMANCE_STATUS_LABELS[status]} <span className="roster-badge">{board.columns.get(status)?.length ?? 0}</span></h2>
          <div className="roster-board-column-cards">
            {board.columns.get(status)?.map((card, index, column) => <PerformerCard
              key={card.performance.id}
              eventId={eventId}
              data={card}
              isWide={isWide}
              sequenceNeighbor={reorderableNeighbors(card)}
              columnPosition={{ isFirst: index === 0, isLast: index === column.length - 1 }}
            />)}
          </div>
        </div>)}
        {board.other.length > 0 && <details className="roster-board-other">
          <summary>No-show / cancelled ({board.other.length})</summary>
          <div className="roster-board-column-cards">
            {board.other.map((card) => <PerformerCard key={card.performance.id} eventId={eventId} data={card} isWide={isWide} />)}
          </div>
        </details>}
      </div>}

      {isOrganizer && roster.isSuccess && showBoard && cards.length > 0 && !isWide && <div className="roster-list">
        {mobileSections.map(({ status, label, items }) => <section key={status} className="roster-list-section">
          <h2>{label} <span className="roster-badge">{items.length}</span></h2>
          {items.length === 0
            ? <p className="roster-list-section-empty">{t('noOneHereYet')}</p>
            : <div className="roster-list-section-cards">
              {items.map((card, index, column) => <PerformerCard
                key={card.performance.id}
                eventId={eventId}
                data={card}
                isWide={isWide}
                sequenceNeighbor={reorderableNeighbors(card)}
                columnPosition={{ isFirst: index === 0, isLast: index === column.length - 1 }}
              />)}
            </div>}
        </section>)}
      </div>}
    </section>
  </main>
}
