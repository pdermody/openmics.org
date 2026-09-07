import { Clock3, MapPin } from 'lucide-react'
import { friendlyApiErrorMessage } from '../api/client'
import { useNextEvent, usePublicEvent, usePublicOpenMic, usePublicProfile } from '../features/publicReads'
import type { ThemeProps } from './shared'
import { ReadState, SiteHeader, SocialButton } from './shared'

export function DetailPage({ kind, id, theme, mode }: { kind: 'event' | 'open-mic' | 'profile'; id: string } & ThemeProps) {
  const event = usePublicEvent(kind === 'event' ? id : undefined)
  const openMic = usePublicOpenMic(kind === 'open-mic' ? id : undefined)
  const nextEvent = useNextEvent(kind === 'open-mic' ? id : undefined)
  const profile = usePublicProfile(kind === 'profile' ? id : undefined)
  const loading = kind === 'event' ? event.isPending : kind === 'open-mic' ? openMic.isPending : profile.isPending
  const error = kind === 'event' ? event.isError : kind === 'open-mic' ? openMic.isError : profile.isError
  const title = event.data?.title ?? openMic.data?.name ?? profile.data?.profile_name
  const errorObject = kind === 'event' ? event.error : kind === 'open-mic' ? openMic.error : profile.error
  const retry = () => void (kind === 'event' ? event.refetch() : kind === 'open-mic' ? openMic.refetch() : profile.refetch())

  return (
    <main className="app" data-theme={theme} data-mode={mode}>
      <SiteHeader />
      <section className="detail-page">
        <a className="back-link" href="/">← Back to discovery</a>
        {loading && <ReadState message="Loading this room…" />}
        {error && <ReadState message={friendlyApiErrorMessage(errorObject, 'This page could not be loaded. Please try again.')} retry={retry} />}
        {!loading && !error && title && <>
          <div className="eyebrow">{kind === 'event' ? 'Event detail' : kind === 'open-mic' ? 'Open mic series' : 'Public profile'}</div>
          <h1>{title}</h1>
          <p className="detail-lede">{event.data?.notes ?? openMic.data?.description ?? profile.data?.bio ?? 'A welcoming room for new voices.'}</p>
          <div className="detail-facts">
            {(event.data || openMic.data) && <span><MapPin size={16} /> {event.data?.venue_name ?? openMic.data?.venue_name}, {event.data?.city ?? openMic.data?.city}</span>}
            {event.data?.starts_at && <span><Clock3 size={16} /> {new Date(event.data.starts_at).toLocaleString()}</span>}
            {profile.data?.profile_kind && <span>{profile.data.profile_kind}</span>}
          </div>
          <div className="detail-actions">
            {kind === 'event' && <a className="primary-button" href={`/events/${event.data?.public_code}/register`}>Register for this event</a>}
            {kind === 'open-mic' && <a className="primary-button" href={nextEvent.data ? `/events/${nextEvent.data.public_code}` : `/open-mics/${id}/register`}>{nextEvent.data ? 'See next event' : 'View registration link'}</a>}
            {kind === 'profile' && <button className="primary-button" type="button">Follow profile</button>}
            <SocialButton label="React" icon="heart" /><SocialButton label="Comment" icon="message" />
          </div>
        </>}
      </section>
    </main>
  )
}
