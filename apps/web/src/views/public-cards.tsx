import { Clock3, MapPin } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useMyRegisteredEventIds } from '../features/myRegistrations'
import { isRegistrationClosed, usePublicOpenMic, type Event, type OpenMic } from '../features/publicReads'
import { SocialButton } from './shared'

export function EventCard({ event }: { event: Event }) {
  const { t } = useTranslation()
  const parentOpenMic = usePublicOpenMic(event.open_mic_id)
  const registeredEventIds = useMyRegisteredEventIds()
  const isRegistered = registeredEventIds.has(event.id)
  const date = new Date(event.starts_at)
  const day = Number.isNaN(date.getTime()) ? '--' : date.getDate()
  const month = Number.isNaN(date.getTime())
    ? '---'
    : date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()
  const time = Number.isNaN(date.getTime())
    ? 'Time to be announced'
    : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const registrationClosed = isRegistrationClosed(event)
  const registrationMode = parentOpenMic.data?.registration_mode
  const registrationDisabled = registrationClosed || registrationMode === 'on_night_only' || registrationMode === 'external'
  const registrationDisabledLabel = registrationClosed
    ? 'Registration closed'
    : registrationMode === 'external'
      ? 'External registration'
      : registrationMode === 'on_night_only'
        ? 'In-person registration only'
        : 'Registration unavailable'

  return (
    <article className="event-card">
      <div className="date-tile">
        <strong>{day}</strong>
        <span>{month}</span>
      </div>
      <div className="event-main">
        <div className="event-type">
          {event.capacity ? t('openMicWithCapacity', { count: event.capacity }) : t('openMicSeries')}
        </div>
        <h3>
          <Link className="card-link" to="/events/$eventId" params={{ eventId: event.public_code }}>
            {event.title}
          </Link>
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
        {isRegistered ? (
          <span className="profile-context" role="status">{t('registered')}</span>
        ) : registrationDisabled ? (
          <button className="primary-button" type="button" disabled aria-disabled="true">
            {registrationDisabledLabel}
          </button>
        ) : (
          <Link className="primary-button" to="/events/$eventId/register" params={{ eventId: event.public_code }}>
            Register
          </Link>
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
  const { t } = useTranslation()
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
        <div className="event-type">{t('openMicSeries')}</div>
        <h3>
          <Link className="card-link" to="/open-mics/$openMicId" params={{ openMicId: openMic.public_code }}>
            {openMic.name}
          </Link>
        </h3>
        <p>{openMic.description ?? 'A welcoming room for singers, poets, and the curious.'}</p>
        <div className="event-meta">
          <MapPin size={15} /> {openMic.city} · {openMic.status}
        </div>
      </div>
      <div className="series-side">
        <button className="follow-button" type="button" disabled>
          {t('follow')} <small>{t('soon')}</small>
        </button>
        <div className="social-row">
          <SocialButton label="React" icon="heart" />
          <SocialButton label="Comment" icon="message" />
        </div>
      </div>
    </article>
  )
}
