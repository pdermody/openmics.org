import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock3, MapPin, MoreVertical, Sparkles } from 'lucide-react'
import { friendlyApiErrorMessage } from '../api/client'
import {
  PERFORMANCE_BOARD_STATUSES,
  PERFORMANCE_STATUS_LABELS,
  useSetRegistrationsClosed,
  useCreatePerformance,
  useDeletePerformance,
  useEventDetail,
  useEventRoster,
  useOrganizerProfile,
  useRosterLiveUpdates,
  useSetEventRunning,
  useUpdatePerformance,
  useUpdateRegistration,
  type Performance,
  type PerformanceStatus,
  type RegistrationEditInput,
  type RosterRegistration,
} from '../features/organizer'
import { isRegistrationClosed } from '../features/publicReads'
import type { ColorMode, ThemeId } from '../theme'
import { HeaderMenu, Modal, ProfileSwitcher, ReadState, Required, RequiredFieldsNote, SignInButton } from './shared'
import { useDismissOnOutsideOrEscape } from '../hooks/dismissable'

const PROVENANCE_FILTERS = ['all', 'pending'] as const
type ProvenanceFilter = (typeof PROVENANCE_FILTERS)[number]

// One flattened row per performance, carrying its parent registration's contact/provenance info
// alongside it — the roster no longer shows registrations and performances as separate concepts.
type PerformerCardData = { registration: RosterRegistration; performance: Performance }

// A registration's provenance/verification classification — shown on card "Details" (still every
// registration's own concern) even though the filter bar itself now only distinguishes All/Pending.
type ProvenanceKey = 'pending' | 'verified' | 'kiosk'

// Visibility-safe provenance: mirrors the server's "Publicly visible / valid" rule
// (organizer_supervised OR email_verified_at). Registration "claiming" is a separate
// attribution concept (which account a registration is linked to) that doesn't affect roster
// eligibility, so it's intentionally left out of this roster-facing categorization.
function provenanceOf(registration: RosterRegistration): { key: ProvenanceKey; label: string } {
  if (registration.organizer_supervised) return { key: 'kiosk', label: 'Kiosk' }
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
function RegistrationDetailsModal({ registration, onClose }: { registration: RosterRegistration; onClose: () => void }) {
  const info = provenanceOf(registration)
  return <Modal title={`Registration details for ${registration.performer_name}`} onClose={onClose}>
    <span className={`roster-badge roster-badge-${info.key}`}>{info.label}</span>
    <dl>
      {registration.performer_city && <><dt>City</dt><dd>{registration.performer_city}</dd></>}
      {registration.contact_email && <><dt>Email</dt><dd>{registration.contact_email}</dd></>}
      {registration.contact_phone && <><dt>Phone</dt><dd>{registration.contact_phone}</dd></>}
      {registration.song_names.length > 0 && <><dt>Songs</dt><dd>{registration.song_names.join(', ')}</dd></>}
      {/* The "Kiosk"/"Verified" badge above already covers verified/kiosk sign-ups; only call out
          the still-unverified case, since that's the one an organizer needs to notice. */}
      {!registration.organizer_supervised && !registration.email_verified_at && <><dt>Email verification</dt><dd><span className="roster-badge roster-badge-pending">Pending verification</span></dd></>}
      <dt>Media consent</dt><dd>{registration.media_consent ? 'Yes' : 'No'}</dd>
    </dl>
  </Modal>
}

// Lets an organizer correct what a performer supplied at registration (e.g. a mistyped name or
// contact info). Mirrors the server's updateRegistrationSchema field set exactly.
function RegistrationEditModal({ eventId, registration, onClose }: { eventId: string; registration: RosterRegistration; onClose: () => void }) {
  const updateRegistration = useUpdateRegistration(eventId)
  const [form, setForm] = useState({
    performer_name: registration.performer_name,
    performer_city: registration.performer_city ?? '',
    contact_email: registration.contact_email ?? '',
    contact_phone: registration.contact_phone ?? '',
    song_names: registration.song_names.join(', '),
    media_consent: registration.media_consent,
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const input: RegistrationEditInput = {
      performer_name: form.performer_name.trim(),
      performer_city: form.performer_city.trim(),
      contact_email: form.contact_email.trim(),
      contact_phone: form.contact_phone.trim(),
      song_names: form.song_names.split(',').map((name) => name.trim()).filter(Boolean),
      media_consent: form.media_consent,
    }
    updateRegistration.mutate({ id: registration.id, ...input }, { onSuccess: onClose })
  }

  return <Modal title={`Edit registration for ${registration.performer_name}`} onClose={onClose}>
    <form className="registration-form" onSubmit={submit}>
      <label>Performer name<Required /><input required value={form.performer_name} onChange={(event) => setForm({ ...form, performer_name: event.target.value })} /></label>
      <label>City<input value={form.performer_city} onChange={(event) => setForm({ ...form, performer_city: event.target.value })} /></label>
      <label>Email<input type="email" value={form.contact_email} onChange={(event) => setForm({ ...form, contact_email: event.target.value })} /></label>
      <label>Phone<input type="tel" value={form.contact_phone} onChange={(event) => setForm({ ...form, contact_phone: event.target.value })} /></label>
      <label>Songs (comma-separated)<input value={form.song_names} onChange={(event) => setForm({ ...form, song_names: event.target.value })} /></label>
      <label className="checkbox-label"><input type="checkbox" checked={form.media_consent} onChange={(event) => setForm({ ...form, media_consent: event.target.checked })} /> Media consent</label>
      <RequiredFieldsNote />
      {updateRegistration.isError && <p className="form-error">{friendlyApiErrorMessage(updateRegistration.error, 'Could not save those changes.')}</p>}
      <div className="dashboard-series-card-actions">
        <button type="submit" className="quiet-button" disabled={updateRegistration.isPending}>Save</button>
        <button type="button" className="link-button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  </Modal>
}

// A dropdown menu portal-rendered to document.body (not a native <details>), so it's never
// clipped by the roster board's overflow-x:auto scroll container regardless of how tall the
// menu's contents are or how close to the bottom of the column the triggering card sits.
function CardMenu({ label, items }: { label: string; items: { label: string; onClick: () => void; disabled?: boolean }[] }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useDismissOnOutsideOrEscape<HTMLDivElement>(open, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  // Initial placement is just a guess (below the button) before the panel's real height is known.
  // Once it's actually rendered, snap it to fit the viewport — flipping above the button instead
  // of below when there isn't enough room underneath, and clamping so it's never cut off at the
  // bottom (or either side) regardless of how close to the edge of the screen the card sits.
  useEffect(() => {
    if (!open || !buttonRef.current || !panelRef.current) return
    const margin = 8
    const buttonRect = buttonRef.current.getBoundingClientRect()
    const panelRect = panelRef.current.getBoundingClientRect()
    let top = buttonRect.bottom + 4
    if (top + panelRect.height > window.innerHeight - margin) top = buttonRect.top - panelRect.height - 4
    top = Math.max(margin, Math.min(top, window.innerHeight - panelRect.height - margin))
    let left = Math.max(margin, buttonRect.right - panelRect.width)
    left = Math.min(left, window.innerWidth - panelRect.width - margin)
    setPosition((current) => (current && current.top === top && current.left === left ? current : { top, left }))
  }, [open, items.length])

  const toggle = () => {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setPosition({ top: rect.bottom + 4, left: Math.max(8, rect.right - 200) })
    }
    setOpen((value) => !value)
  }

  return <>
    <button type="button" ref={buttonRef} className="performer-card-arrow" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
      <MoreVertical size={16} />
    </button>
    {open && position && createPortal(
      <div className="performer-card-menu-panel" ref={panelRef} role="menu" style={{ top: position.top, left: position.left }}>
        {items.map((item) => <button key={item.label} type="button" role="menuitem" onClick={() => { setOpen(false); item.onClick() }} disabled={item.disabled}>{item.label}</button>)}
      </div>,
      document.querySelector('.app') ?? document.body,
    )}
  </>
}

// A deliberately plain list row (no move controls, no kanban card styling) for registrations
// that aren't board-eligible yet — just enough to see who's waiting and check what they
// submitted or fix a typo before their confirmation email is verified.
function PendingRegistrationRow({ eventId, registration }: { eventId: string; registration: RosterRegistration }) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  return <li className="roster-pending-row">
    <span className="performer-card-name">{registration.performer_name}</span>
    <span className="roster-pending-actions">
      <button type="button" className="link-button" onClick={() => setDetailsOpen(true)}>Details</button>
      <button type="button" className="link-button" onClick={() => setEditOpen(true)}>Edit</button>
    </span>
    {detailsOpen && <RegistrationDetailsModal registration={registration} onClose={() => setDetailsOpen(false)} />}
    {editOpen && <RegistrationEditModal eventId={eventId} registration={registration} onClose={() => setEditOpen(false)} />}
  </li>
}

// The card shows only the performer's name plus move/hamburger controls — no other info on the
// card face (registration details live behind the "Details" modal instead).
function PerformerCard({
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
  const { registration, performance } = data
  const status = performance.status
  const updatePerformance = useUpdatePerformance(eventId)
  const createPerformance = useCreatePerformance(eventId)
  const deletePerformance = useDeletePerformance(eventId)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

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


  return <article className="performer-card">
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

    {detailsOpen && <RegistrationDetailsModal registration={registration} onClose={() => setDetailsOpen(false)} />}
    {editOpen && <RegistrationEditModal eventId={eventId} registration={registration} onClose={() => setEditOpen(false)} />}
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
        <button type="button" className="link-button" onClick={() => setDeleteConfirmOpen(false)}>Cancel</button>
      </div>
    </Modal>}

    {updatePerformance.isError && <p className="form-error">{friendlyApiErrorMessage(updatePerformance.error, 'Could not save that change.')}</p>}
    {createPerformance.isError && <p className="form-error">{friendlyApiErrorMessage(createPerformance.error, 'Could not start a new performance.')}</p>}
  </article>
}

export function EventRosterPage({ seriesId, eventId, theme, mode }: { seriesId: string; eventId: string; theme: ThemeId; mode: ColorMode }) {
  const { context, isOrganizer } = useOrganizerProfile()
  const event = useEventDetail(seriesId, eventId)
  const roster = useEventRoster(eventId, isOrganizer)
  const [provenanceFilter, setProvenanceFilter] = useState<ProvenanceFilter>('all')
  useRosterLiveUpdates(seriesId, eventId, isOrganizer)
  const isWide = useIsWideScreen()
  const setRunning = useSetEventRunning(seriesId, eventId)
  const setRegistrationsClosed = useSetRegistrationsClosed(seriesId, eventId)
  const [confirmStop, setConfirmStop] = useState(false)

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
  // unlabeled flat list, so it's always clear which stage a performer is in. There's no
  // filter here — mobile always shows every non-empty section, same as the desktop board.
  const mobileSections = useMemo(() => {
    const statusesToShow: PerformanceStatus[] = [...PERFORMANCE_BOARD_STATUSES, 'no_show', 'cancelled']
    return statusesToShow
      .map((status) => ({
        status,
        label: PERFORMANCE_STATUS_LABELS[status],
        items: board.columns.get(status) ?? cards.filter((card) => card.performance.status === status),
      }))
      .filter((section) => section.items.length > 0)
  }, [cards, board])

  const registrationCount = roster.data?.length ?? 0
  const isClosed = Boolean(event.data) && isRegistrationClosed(event.data!)
  const isFull = Boolean(event.data?.capacity && registrationCount >= event.data.capacity)
  const isRunning = event.data?.running === true
  const wasStopped = event.data?.running === false
  // "Pending" shows only the simple pending-confirmation list (no kanban); "all" shows the board
  // plus the pending list too, so organizers still notice who's waiting without switching filters.
  const showBoard = provenanceFilter !== 'pending'
  const showPendingList = provenanceFilter === 'all' || provenanceFilter === 'pending'

  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><a className="brand" href="/" aria-label="Open Mic home"><span className="brand-mark"><Sparkles size={17} /></span><span>open mic</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
    <section className="dashboard-page">
      <a className="back-link" href={`/dashboard/series/${seriesId}`}>← Back to events</a>
      <div className="eyebrow">Event operations</div>
      <h1>{event.data?.title ?? 'Event roster'}</h1>
      {/* Roster is reached from several places (dashboard, kiosk, direct links) — always show
          which event this is, since the title alone can be ambiguous across a series. */}
      {event.data && <p className="event-meta-line">
        <span className="event-meta"><Clock3 size={15} /> {new Date(event.data.starts_at).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })}</span>
        <span className="event-meta"><MapPin size={15} /> {event.data.venue_name}, {event.data.city}</span>
      </p>}
      {event.data && isOrganizer && <div className="dashboard-series-card-actions">
        <a className="quiet-button" href={`/dashboard/series/${seriesId}/events/${eventId}/kiosk`}>Open kiosk</a>
        <button type="button" className="quiet-button" onClick={() => setRegistrationsClosed.mutate(!isClosed)} disabled={setRegistrationsClosed.isPending}>{isClosed ? 'Reopen registrations' : 'Stop registrations'}</button>
        {isRunning && !confirmStop && <button type="button" className="quiet-button" onClick={() => setConfirmStop(true)}>Stop event</button>}
        {isRunning && confirmStop && <span className="roster-confirm-bar">
          <span>Stop the event? Anyone not checked in will be marked no-show.</span>
          <button type="button" className="quiet-button" onClick={() => { setRunning.mutate(false); setConfirmStop(false) }} disabled={setRunning.isPending}>Confirm stop</button>
          <button type="button" className="link-button" onClick={() => setConfirmStop(false)}>Cancel</button>
        </span>}
        {!isRunning && <button type="button" className="quiet-button" onClick={() => setRunning.mutate(true)} disabled={setRunning.isPending}>{wasStopped ? 'Restart event' : 'Start event'}</button>}
      </div>}
      {setRunning.isError && <p className="form-error">{friendlyApiErrorMessage(setRunning.error, 'Could not update the event.')}</p>}
      {setRegistrationsClosed.isError && <p className="form-error">{friendlyApiErrorMessage(setRegistrationsClosed.error, 'Could not update registration availability.')}</p>}
      {event.data && <div className="roster-summary">
        <span className="roster-badge">{registrationCount} registration{registrationCount === 1 ? '' : 's'}</span>
        {event.data.capacity && <span className={isFull ? 'roster-badge roster-badge-warning' : 'roster-badge'}>{isFull ? 'Full' : `Capacity ${event.data.capacity}`}</span>}
        <span className={isClosed ? 'roster-badge roster-badge-warning' : 'roster-badge'}>{isClosed ? 'Registrations closed' : 'Registrations open'}</span>
        <span className={wasStopped ? 'roster-badge roster-badge-warning' : 'roster-badge'}>{isRunning ? 'Event running' : wasStopped ? 'Event stopped' : 'Not started'}</span>
      </div>}

      {!context.account.data && <ReadState message="Sign in to manage this event's roster." />}
      {context.account.data && !isOrganizer && <ReadState message="Select an organizer profile to manage this event's roster." />}
      {isOrganizer && roster.isPending && <ReadState message="Loading roster…" />}
      {isOrganizer && roster.isError && <ReadState message={friendlyApiErrorMessage(roster.error, 'We could not load the roster.')} retry={() => void roster.refetch()} />}

      {isOrganizer && roster.isSuccess && <div className="roster-filters" role="group" aria-label="Filter roster by provenance">
        {PROVENANCE_FILTERS.map((option) => <button
          key={option}
          type="button"
          className={provenanceFilter === option ? 'quiet-button roster-filter-active' : 'quiet-button'}
          aria-pressed={provenanceFilter === option}
          onClick={() => setProvenanceFilter(option)}
        >
          {option === 'all' ? 'All' : option.charAt(0).toUpperCase() + option.slice(1)}
        </button>)}
      </div>}

      {isOrganizer && roster.isSuccess && showPendingList && pendingRegistrations.length > 0 && <div className="roster-pending">
        <h2>Pending confirmation <span className="roster-badge">{pendingRegistrations.length}</span></h2>
        <p className="field-hint">Awaiting email confirmation — not yet shown on the board below.</p>
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

      {isOrganizer && roster.isSuccess && showBoard && cards.length > 0 && !isWide && <>
        {mobileSections.length === 0 && <ReadState message="No performers in this state." />}
        <div className="roster-list">
          {mobileSections.map(({ status, label, items }) => <section key={status} className="roster-list-section">
            <h2>{label} <span className="roster-badge">{items.length}</span></h2>
            <div className="roster-list-section-cards">
              {items.map((card, index, column) => <PerformerCard
                key={card.performance.id}
                eventId={eventId}
                data={card}
                isWide={isWide}
                sequenceNeighbor={reorderableNeighbors(card)}
                columnPosition={{ isFirst: index === 0, isLast: index === column.length - 1 }}
              />)}
            </div>
          </section>)}
        </div>
      </>}
    </section>
  </main>
}
