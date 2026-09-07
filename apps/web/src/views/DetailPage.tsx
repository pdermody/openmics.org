import { Clock3, MapPin } from 'lucide-react'
import { friendlyApiErrorMessage } from '../api/client'
import { useAccountContext } from '../features/account'
import { useNextEvent, usePublicEvent, usePublicOpenMic, usePublicProfile } from '../features/publicReads'
import type { ThemeProps } from './shared'
import { ReadState, SiteHeader, SocialButton } from './shared'

function focusProfileSwitcher() {
  const select = document.getElementById('profile-switcher-select') as (HTMLSelectElement & { showPicker?: () => void }) | null
  if (!select) return
  select.focus()
  try { select.showPicker?.() } catch { /* showPicker requires a user gesture in some browsers; focus is enough of a fallback */ }
}

export function DetailPage({ kind, id, theme, mode }: { kind: 'event' | 'open-mic' | 'profile'; id: string } & ThemeProps) {
  const event = usePublicEvent(kind === 'event' ? id : undefined)
  const openMic = usePublicOpenMic(kind === 'open-mic' ? id : undefined)
  const nextEvent = useNextEvent(kind === 'open-mic' ? id : undefined)
  const profile = usePublicProfile(kind === 'profile' ? id : undefined)
  const parentOpenMic = usePublicOpenMic(kind === 'event' ? event.data?.open_mic_id : undefined)
  const accountContext = useAccountContext()
  const activeProfile = accountContext.profiles.data?.items.find((profileItem) => profileItem.id === accountContext.account.data?.current_profile_id)
  const needsPerformerProfile = Boolean(accountContext.account.data) && activeProfile?.profile_kind !== 'performer'
  const loading = kind === 'event' ? event.isPending : kind === 'open-mic' ? openMic.isPending : profile.isPending
  const error = kind === 'event' ? event.isError : kind === 'open-mic' ? openMic.isError : profile.isError
  const title = event.data?.title ?? openMic.data?.name ?? profile.data?.profile_name
  const errorObject = kind === 'event' ? event.error : kind === 'open-mic' ? openMic.error : profile.error
  const retry = () => void (kind === 'event' ? event.refetch() : kind === 'open-mic' ? openMic.refetch() : profile.refetch())
  const registrationMode = kind === 'event' ? parentOpenMic.data?.registration_mode : openMic.data?.registration_mode
  const registrationDisabled = registrationMode === 'on_night_only' || registrationMode === 'external'

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
            {kind === 'event' && (
              registrationDisabled ? (
                <button className="primary-button" type="button" disabled aria-disabled="true">
                  Registration unavailable
                </button>
              ) : needsPerformerProfile ? (
                <button className="primary-button" type="button" onClick={focusProfileSwitcher}>
                  Switch to a performer profile to register
                </button>
              ) : (
                <a className="primary-button" href={`/events/${event.data?.public_code}/register`}>Register for this event</a>
              )
            )}
            {kind === 'open-mic' && (
              nextEvent.data ? (
                <a className="primary-button" href={`/events/${nextEvent.data.public_code}`}>See next event</a>
              ) : needsPerformerProfile ? (
                <button className="primary-button" type="button" onClick={focusProfileSwitcher}>
                  Switch to a performer profile to register
                </button>
              ) : (
                <a className="primary-button" href={`/open-mics/${id}/register`}>View registration link</a>
              )
            )}
            {kind === 'profile' && <button className="primary-button" type="button">Follow profile</button>}
            <SocialButton label="React" icon="heart" /><SocialButton label="Comment" icon="message" />
          </div>
          {kind === 'event' && !registrationDisabled && needsPerformerProfile && (
            <p className="field-hint">Organizer profiles can’t register as the performer, even for their own events. Use the profile switcher above to pick a performer profile.</p>
          )}
        </>}
      </section>
    </main>
  )
}
