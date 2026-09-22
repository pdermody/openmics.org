import { Link } from '@tanstack/react-router'
import { MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useOrganizerOpenMics, useOrganizerProfile } from '../features/organizer'
import type { ColorMode, ThemeId } from '../theme'
import { ReadState, SiteHeader } from './shared'

export function OrganizerSeriesPage({ theme, mode }: { theme: ThemeId; mode: ColorMode }) {
  const { t } = useTranslation()
  const { context, activeProfile: selected, isOrganizer, isOrganizerPending } = useOrganizerProfile()
  const series = useOrganizerOpenMics(isOrganizer ? selected?.id : undefined, isOrganizer)

  return <main className="app" data-theme={theme} data-mode={mode}>
    <SiteHeader />
    <section className="dashboard-page">
      <Link className="back-link" to="/dashboard">{t('backToDashboard')}</Link>
      <div className="eyebrow">{t('organizerWorkspace')}</div>
      <h1>{t('openMicSeries')}</h1>
      {isOrganizerPending && <ReadState message={t('loading')} />}
      {!isOrganizerPending && !context.account.data && <ReadState message={t('signInDashboard')} />}
      {!isOrganizerPending && context.account.data && !isOrganizer && <ReadState message={t('selectOrganizer')} />}
      {isOrganizer && <Link className="quiet-button" to="/dashboard/series/new">{t('createSeries')}</Link>}
      {isOrganizer && series.isPending && <ReadState message="Loading your open mic series…" />}
      {isOrganizer && series.isError && <ReadState message="We could not load your open mic series." retry={() => void series.refetch()} />}
      {isOrganizer && series.isSuccess && series.data.length === 0 && <ReadState message={t('noSeriesOwned')} />}
      {isOrganizer && series.data?.map((openMic) => <article className="dashboard-series-card" key={openMic.id}><div><span className="panel-label">{openMic.status}</span><h2>{openMic.name}</h2><p>{openMic.description ?? t('noDescription')}</p><span className="event-meta"><MapPin size={15} /> {openMic.venue_name}, {openMic.city}</span></div><div className="dashboard-series-card-actions"><Link className="quiet-button" to="/dashboard/series/$seriesId/edit" params={{ seriesId: openMic.id }}>{t('edit')}</Link><Link className="quiet-button" to="/dashboard/series/$seriesId" params={{ seriesId: openMic.id }}>{t('viewEvents')}</Link></div></article>)}
    </section>
  </main>
}
