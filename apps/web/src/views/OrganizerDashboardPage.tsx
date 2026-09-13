import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useOrganizerOpenMics, useOrganizerProfile } from '../features/organizer'
import type { ColorMode, ThemeId } from '../theme'
import { ClaimableRegistrationsBanner } from './ClaimableRegistrationsBanner'
import { HeaderMenu, ProfileSwitcher, ReadState, SignInButton } from './shared'

export function OrganizerDashboardPage({ theme, mode }: { theme: ThemeId; mode: ColorMode }) {
  const { t } = useTranslation()
  const { context, activeProfile: selected, isOrganizer, isOrganizerPending } = useOrganizerProfile()
  const openMics = useOrganizerOpenMics(selected?.id, isOrganizer)
  const hasNoOpenMics = isOrganizer && !openMics.isPending && (openMics.data?.length ?? 0) === 0

  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><a className="brand" href="/" aria-label={t('openMicHome')}><span className="brand-mark"><Sparkles size={17} /></span><span>{t("appName")}</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
    <section className="dashboard-page">
      <div className="eyebrow">{t('dashboard')}</div>
      <h1>{t('dashboardTitle')}</h1>
      {isOrganizerPending && <ReadState message={t('loading')} />}
      {!isOrganizerPending && !context.account.data && <ReadState message={t('signInDashboard')} />}
      <ClaimableRegistrationsBanner />
      {!isOrganizerPending && context.account.data && !isOrganizer && <ReadState message={t('selectOrganizer')} />}
      {isOrganizer && selected && <>
        <p className="detail-lede">{t('workingAs', { name: selected.profile_name })}</p>
        {hasNoOpenMics && <div className="dashboard-card"><span className="panel-label">{t('getStarted')}</span><h2>{t('setupFirst')}</h2><p>{t('noSeriesYet')}</p><a className="quiet-button" href="/dashboard/series/new">{t('setupFirstLink')}</a></div>}
        <div className="dashboard-grid">
          <article className="dashboard-card"><span className="panel-label">{t('seriesLabel')}</span><h2>{t('openMicSeries')}</h2><p>{t('noSeriesYet')}</p><a className="quiet-button" href="/dashboard/series">{t('manageSeries')}</a></article>
          <article className="dashboard-card"><span className="panel-label">{t('tonight')}</span><h2>{t('eventOperations')}</h2><p>{t('viewOperations')}</p><a className="quiet-button" href="/dashboard/series">{t('viewOperations')}</a></article>
        </div>
      </>}
    </section>
  </main>
}
