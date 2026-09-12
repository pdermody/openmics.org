import { MapPin, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useOrganizerOpenMics, useOrganizerProfile } from '../features/organizer'
import type { ColorMode, ThemeId } from '../theme'
import { HeaderMenu, ProfileSwitcher, ReadState, SignInButton } from './shared'

export function OrganizerSeriesPage({ theme, mode }: { theme: ThemeId; mode: ColorMode }) {
  const { t } = useTranslation()
  const { context, activeProfile: selected, isOrganizer } = useOrganizerProfile()
  const series = useOrganizerOpenMics(isOrganizer ? selected?.id : undefined, isOrganizer)

  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><a className="brand" href="/" aria-label={t('openMicHome')}><span className="brand-mark"><Sparkles size={17} /></span><span>open mic</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
    <section className="dashboard-page">
      <a className="back-link" href="/dashboard">{t('backToDashboard')}</a>
      <div className="eyebrow">{t('organizerWorkspace')}</div>
      <h1>{t('openMicSeries')}</h1>
      {!context.account.data && <ReadState message={t('signInDashboard')} />}
      {context.account.data && !isOrganizer && <ReadState message={t('selectOrganizer')} />}
      {isOrganizer && <a className="quiet-button" href="/dashboard/series/new">{t('createSeries')}</a>}
      {isOrganizer && series.isPending && <ReadState message="Loading your open mic series…" />}
      {isOrganizer && series.isError && <ReadState message="We could not load your open mic series." retry={() => void series.refetch()} />}
      {isOrganizer && series.isSuccess && series.data.length === 0 && <ReadState message={t('noSeriesOwned')} />}
      {isOrganizer && series.data?.map((openMic) => <article className="dashboard-series-card" key={openMic.id}><div><span className="panel-label">{openMic.status}</span><h2>{openMic.name}</h2><p>{openMic.description ?? t('noDescription')}</p><span className="event-meta"><MapPin size={15} /> {openMic.venue_name}, {openMic.city}</span></div><div className="dashboard-series-card-actions"><a className="quiet-button" href={`/dashboard/series/${openMic.id}/edit`}>{t('edit')}</a><a className="quiet-button" href={`/dashboard/series/${openMic.id}`}>{t('viewEvents')}</a></div></article>)}
    </section>
  </main>
}
