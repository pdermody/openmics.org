import { Clock3, MapPin } from 'lucide-react'
import { usePublicOpenMic, type Event, type OpenMic } from '../features/publicReads'
import { SocialButton } from './shared'

export function EventCard({ event }: { event: Event }) {
  const parentOpenMic = usePublicOpenMic(event.open_mic_id)
  const date = new Date(event.starts_at)
  const day = Number.isNaN(date.getTime()) ? '--' : date.getDate()
  const month = Number.isNaN(date.getTime())
    ? '---'
    : date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()
  const time = Number.isNaN(date.getTime())
    ? 'Time to be announced'
    : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const registrationDisabled = parentOpenMic.data?.registration_mode === 'on_night_only' || parentOpenMic.data?.registration_mode === 'external'

  return (
    <article className="event-card">
      <div className="date-tile">
        <strong>{day}</strong>
        <span>{month}</span>
      </div>
      <div className="event-main">
        <div className="event-type">
          Open mic{event.capacity ? ` · ${event.capacity} spots` : ''}
        </div>
        <h3>
          <a className="card-link" href={`/events/${event.public_code}`}>
            {event.title}
          </a>
        </h3>
        <p className="event-meta">
          <Clock3 size={15} /> {time}
        </p>
        <p className="event-meta">
          <MapPin size={15} /> {event.venue_name}, {event.city}
        </p>
        <div className="tag-row">
          {(event.activities ?? []).slice(0, 3).map((activity) => (
            <span key={activity}>{activity}</span>
          ))}
        </div>
      </div>
      <div className="event-action">
        {registrationDisabled ? (
          <button className="primary-button" type="button" disabled aria-disabled="true">
            Register
          </button>
        ) : (
          <a className="primary-button" href={`/events/${event.public_code}/register`}>
            Register
          </a>
        )}
        <div className="social-row">
          <SocialButton label="React" icon="heart" />
          <SocialButton label="Comment" icon="message" />
        </div>
      </div>
    </article>
  )
}

export function SeriesCard({ openMic }: { openMic: OpenMic }) {
  const initials = openMic.name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <article className="series-card">
      <div className="series-art">
        <span>{initials}</span>
      </div>
      <div className="series-copy">
        <div className="event-type">Open mic series</div>
        <h3>
          <a className="card-link" href={`/open-mics/${openMic.id}`}>
            {openMic.name}
          </a>
        </h3>
        <p>{openMic.description ?? 'A welcoming room for singers, poets, and the curious.'}</p>
        <div className="event-meta">
          <MapPin size={15} /> {openMic.city} · {openMic.status}
        </div>
      </div>
      <div className="series-side">
        <button className="follow-button" type="button" disabled>
          Follow <small>soon</small>
        </button>
        <div className="social-row">
          <SocialButton label="React" icon="heart" />
          <SocialButton label="Comment" icon="message" />
        </div>
      </div>
    </article>
  )
}
