import { friendlyApiErrorMessage } from '../api/client'
import { Sparkles } from 'lucide-react'
import { usePublicOpenMics, useUpcomingEvents } from '../features/publicReads'
import type { ThemeProps } from './shared'
import { ReadState, SiteHeader } from './shared'
import { EventCard, SeriesCard } from './public-cards'

export function HomePage({ theme, mode }: ThemeProps) {
  const upcomingEvents = useUpcomingEvents()
  const openMics = usePublicOpenMics()

  return (
    <main className="app" data-theme={theme} data-mode={mode}>
      <SiteHeader />

      <section className="review-hero" id="discover">
        <div className="eyebrow"><Sparkles size={14} /> Open mic discovery</div>
        <div className="hero-grid">
          <div>
            <p className="kicker">A place for the next voice</p>
            <h1>Find your night.<br /><em>Take the mic.</em></h1>
            <p className="hero-copy">Browse welcoming open mics, see what is coming up, and find a room that feels like yours.</p>
            <div className="hero-actions">
              <button className="primary-button" type="button">Explore events</button>
            </div>
          </div>
        </div>
      </section>

      <section className="content-grid" id="events">
        <div className="section-heading">
          <div><span className="panel-label">This week</span><h2>Rooms worth showing up for</h2></div>
        </div>
        {upcomingEvents.isPending && <ReadState message="Finding upcoming rooms…" />}
        {upcomingEvents.isError && <ReadState message={friendlyApiErrorMessage(upcomingEvents.error, 'We could not load upcoming events. Please try again.')} retry={() => void upcomingEvents.refetch()} />}
        {upcomingEvents.data?.slice(0, 3).map((event) => <EventCard event={event} key={event.id} />)}

        <div className="section-heading series-heading">
          <div><span className="panel-label">Find your room</span><h2>Open mic series nearby</h2></div>
        </div>
        {openMics.isPending && <ReadState message="Finding open mic series…" />}
        {openMics.isError && <ReadState message={friendlyApiErrorMessage(openMics.error, 'We could not load open mic series. Please try again.')} retry={() => void openMics.refetch()} />}
        {openMics.data?.slice(0, 3).map((openMic) => <SeriesCard openMic={openMic} key={openMic.id} />)}
      </section>

      <footer className="footer"><span>Designed for voices, rooms, and the people who make them.</span><a className="footer-link" href="/settings/theme">Appearance</a></footer>
    </main>
  )
}
