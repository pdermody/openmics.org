import { useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { friendlyApiErrorMessage } from '../api/client'
import {
  useCreatePerformance,
  useDeletePerformance,
  useEventDetail,
  useEventRoster,
  useOrganizerProfile,
  useRosterLiveUpdates,
  useUpdatePerformance,
  type PerformanceStatus,
  type RosterRegistration,
} from '../features/organizer'
import { isRegistrationClosed } from '../features/publicReads'
import type { ColorMode, ThemeId } from '../theme'
import { HeaderMenu, ProfileSwitcher, ReadState, SignInButton } from './shared'

const PROVENANCE_FILTERS = ['all', 'pending', 'verified', 'kiosk', 'claimed'] as const
type ProvenanceFilter = (typeof PROVENANCE_FILTERS)[number]

const STATUS_OPTIONS: PerformanceStatus[] = ['registered', 'performed', 'no_show', 'cancelled']

// Visibility-safe provenance: mirrors the server's "Publicly visible / valid" rule
// (organizer_supervised OR email_verified_at) plus the separate claimed-attribution state,
// so organizers can see at a glance which rows are still awaiting email confirmation.
function provenanceOf(registration: RosterRegistration): { key: Exclude<ProvenanceFilter, 'all'>; label: string } {
  if (registration.organizer_supervised) return { key: 'kiosk', label: 'Kiosk' }
  if (registration.claimed_by_account_id) return { key: 'claimed', label: 'Claimed' }
  if (registration.email_verified_at) return { key: 'verified', label: 'Verified' }
  return { key: 'pending', label: 'Pending' }
}

function PerformanceControls({ eventId, performance }: { eventId: string; performance: RosterRegistration['performances'][number] }) {
  const updatePerformance = useUpdatePerformance(eventId)
  const deletePerformance = useDeletePerformance(eventId)
  const [notes, setNotes] = useState(performance.notes ?? '')

  return <div className="roster-performance">
    <label className="roster-performance-field">
      <span>Sequence</span>
      <input
        type="number"
        min={1}
        defaultValue={performance.sequence}
        aria-label={`Running-order position for ${performance.name}`}
        onBlur={(event) => {
          const value = Number(event.currentTarget.value)
          if (value > 0 && value !== performance.sequence) updatePerformance.mutate({ id: performance.id, sequence: value })
        }}
      />
    </label>
    <label className="roster-performance-field">
      <span>Status</span>
      <select
        value={performance.status}
        aria-label={`Performance status for ${performance.name}`}
        onChange={(event) => updatePerformance.mutate({ id: performance.id, status: event.currentTarget.value as PerformanceStatus })}
      >
        {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status.replace('_', ' ')}</option>)}
      </select>
    </label>
    <label className="roster-performance-field roster-performance-notes">
      <span>Organizer notes</span>
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.currentTarget.value)}
        onBlur={() => { if (notes !== (performance.notes ?? '')) updatePerformance.mutate({ id: performance.id, notes: notes || null }) }}
      />
    </label>
    <button type="button" className="link-button" onClick={() => deletePerformance.mutate(performance.id)} disabled={deletePerformance.isPending}>
      Remove performance
    </button>
    {updatePerformance.isError && <p className="form-error">{friendlyApiErrorMessage(updatePerformance.error, 'Could not save that change.')}</p>}
    {deletePerformance.isError && <p className="form-error">{friendlyApiErrorMessage(deletePerformance.error, 'Could not remove that performance.')}</p>}
  </div>
}

function RosterRow({ eventId, registration }: { eventId: string; registration: RosterRegistration }) {
  const info = provenanceOf(registration)
  const createPerformance = useCreatePerformance(eventId)

  return <article className="roster-row">
    <div className="roster-row-main">
      <span className={`roster-badge roster-badge-${info.key}`}>{info.label}</span>
      <h3>{registration.performer_name}</h3>
      {registration.performer_city && <span className="event-meta">{registration.performer_city}</span>}
      {registration.contact_email && <span className="event-meta">{registration.contact_email}</span>}
      {registration.contact_phone && <span className="event-meta">{registration.contact_phone}</span>}
      {registration.song_names.length > 0 && <div className="tag-row">{registration.song_names.map((song) => <span key={song}>{song}</span>)}</div>}
      {!registration.media_consent && <span className="roster-badge roster-badge-warning">No media consent</span>}
    </div>
    <div className="roster-performances">
      {registration.performances.map((performance) => <PerformanceControls key={performance.id} eventId={eventId} performance={performance} />)}
      <button
        type="button"
        className="quiet-button"
        onClick={() => createPerformance.mutate({ registration_id: registration.id, name: registration.performer_name })}
        disabled={createPerformance.isPending}
      >
        Add performance slot
      </button>
      {createPerformance.isError && <p className="form-error">{friendlyApiErrorMessage(createPerformance.error, 'Could not add a performance slot.')}</p>}
    </div>
  </article>
}

export function EventRosterPage({ seriesId, eventId, theme, mode }: { seriesId: string; eventId: string; theme: ThemeId; mode: ColorMode }) {
  const { context, isOrganizer } = useOrganizerProfile()
  const event = useEventDetail(seriesId, eventId)
  const roster = useEventRoster(eventId, isOrganizer)
  const [filter, setFilter] = useState<ProvenanceFilter>('all')
  const liveStatus = useRosterLiveUpdates(eventId, isOrganizer)

  const filtered = useMemo(() => {
    if (!roster.data) return []
    if (filter === 'all') return roster.data
    return roster.data.filter((registration) => provenanceOf(registration).key === filter)
  }, [roster.data, filter])

  const registrationCount = roster.data?.length ?? 0
  const isClosed = Boolean(event.data) && isRegistrationClosed(event.data!)
  const isFull = Boolean(event.data?.capacity && registrationCount >= event.data.capacity)

  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><a className="brand" href="/" aria-label="Open Mic home"><span className="brand-mark"><Sparkles size={17} /></span><span>open mic</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
    <section className="dashboard-page">
      <a className="back-link" href={`/dashboard/series/${seriesId}`}>← Back to events</a>
      <div className="eyebrow">Event operations</div>
      <h1>{event.data?.title ?? 'Event roster'}</h1>
      {event.data && isOrganizer && <div className="dashboard-series-card-actions"><a className="quiet-button" href={`/dashboard/series/${seriesId}/events/${eventId}/kiosk`}>Open kiosk</a></div>}
      {event.data && <div className="roster-summary">
        <span className="roster-badge">{registrationCount} registration{registrationCount === 1 ? '' : 's'}</span>
        {event.data.capacity && <span className={isFull ? 'roster-badge roster-badge-warning' : 'roster-badge'}>{isFull ? 'Full' : `Capacity ${event.data.capacity}`}</span>}
        <span className={isClosed ? 'roster-badge roster-badge-warning' : 'roster-badge'}>{isClosed ? 'Registrations closed' : 'Registrations open'}</span>
        {isOrganizer && <span
          className={liveStatus === 'live' ? 'roster-badge roster-badge-verified' : 'roster-badge roster-badge-warning'}
          role="status"
          aria-live="polite"
        >
          {liveStatus === 'live' ? 'Live updates on' : liveStatus === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
        </span>}
      </div>}

      {!context.account.data && <ReadState message="Sign in to manage this event's roster." />}
      {context.account.data && !isOrganizer && <ReadState message="Select an organizer profile to manage this event's roster." />}
      {isOrganizer && roster.isPending && <ReadState message="Loading roster…" />}
      {isOrganizer && roster.isError && <ReadState message={friendlyApiErrorMessage(roster.error, 'We could not load the roster.')} retry={() => void roster.refetch()} />}

      {isOrganizer && roster.isSuccess && <div className="roster-filters" role="group" aria-label="Filter roster by provenance">
        {PROVENANCE_FILTERS.map((option) => <button
          key={option}
          type="button"
          className={filter === option ? 'quiet-button roster-filter-active' : 'quiet-button'}
          aria-pressed={filter === option}
          onClick={() => setFilter(option)}
        >
          {option === 'all' ? 'All' : option.charAt(0).toUpperCase() + option.slice(1)}
        </button>)}
      </div>}

      {isOrganizer && roster.isSuccess && filtered.length === 0 && <ReadState message={roster.data.length === 0 ? 'No one has registered for this event yet.' : 'No registrations match this filter.'} />}
      {isOrganizer && roster.isSuccess && filtered.map((registration) => <RosterRow key={registration.id} eventId={eventId} registration={registration} />)}
    </section>
  </main>
}
