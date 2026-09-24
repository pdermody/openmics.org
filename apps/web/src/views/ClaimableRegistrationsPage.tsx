import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client'
import { Select } from '../components/radix-select'
import { useAccountContext, type AccountProfile } from '../features/account'
import { useClaimableRegistrations, useClaimRegistration, type ClaimableRegistration } from '../features/claimableRegistrations'
import type { ColorMode, ThemeId } from '../theme'
import { ReadState, Required, SiteHeader } from './shared'

function formatRegistrationDate(value: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value))
}

function claimErrorMessage(error: unknown): string {
  return error instanceof ApiError && error.code === 'REGISTRATION_ALREADY_CLAIMED'
    ? 'Someone already claimed this registration.'
    : 'We could not claim this registration. Please try again.'
}

function ClaimRow({ registration, performerProfiles }: { registration: ClaimableRegistration; performerProfiles: AccountProfile[] }) {
  const { t, i18n } = useTranslation()
  const claim = useClaimRegistration()
  const [adoptedProfileId, setAdoptedProfileId] = useState('')

  return <article className="dashboard-series-card">
    <div>
      <span className="panel-label">{t('unclaimedRegistration')}</span>
      <h2>{registration.performer_name}</h2>
      <p className="event-meta">{registration.open_mic_name} · {registration.event_title}</p>
      <p className="event-meta">{formatRegistrationDate(registration.event_starts_at, i18n.language)}</p>
      {registration.song_names.length > 0 && <p>{registration.song_names.join(', ')}</p>}
    </div>
    <div className="profile-context-controls">
      <label><span>{t('adoptProfile')}<Required /></span></label>
      <Select
        required
        value={adoptedProfileId}
        onValueChange={setAdoptedProfileId}
        ariaLabel={t('adoptProfile')}
        placeholder={t('selectPerformerProfile')}
        options={performerProfiles.map((profile) => ({ value: profile.id, label: profile.profile_name }))}
      />
      <button className="quiet-button" type="button" disabled={claim.isPending || !adoptedProfileId} onClick={() => claim.mutate({ registrationId: registration.id, adoptedProfileId })}>
        {claim.isPending ? 'Claiming…' : 'Claim'}
      </button>
      {claim.isError && <p className="form-error" role="alert">{claimErrorMessage(claim.error)}</p>}
    </div>
  </article>
}

export function ClaimableRegistrationsPage({ theme, mode }: { theme: ThemeId; mode: ColorMode }) {
  const { t } = useTranslation()
  const context = useAccountContext()
  const claimable = useClaimableRegistrations(Boolean(context.account.data))
  const performerProfiles = context.profiles.data?.items.filter((profile) => profile.profile_kind === 'performer') ?? []
  const [newProfileName, setNewProfileName] = useState('')

  if (!context.account.data) return <main className="app" data-theme={theme} data-mode={mode}><SiteHeader /><ReadState message={t('signInDashboard')} /></main>
  if (claimable.isPending) return <main className="app" data-theme={theme} data-mode={mode}><SiteHeader /><ReadState message={t('loading')} /></main>
  if (claimable.isError) return <main className="app" data-theme={theme} data-mode={mode}><SiteHeader /><ReadState message="We could not load registrations you can claim." retry={() => void claimable.refetch()} /></main>

  return <main className="app" data-theme={theme} data-mode={mode}>
    <SiteHeader />
    <section className="dashboard-page">
      <Link className="back-link" to="/dashboard">{t('backToDashboard')}</Link>
      <div className="eyebrow">{t('claimableRegistrations')}</div>
      <h1>{t('claimableRegistrationsTitle')}</h1>
      <p className="detail-lede">{t('claimableRegistrationsIntro')}</p>
      {performerProfiles.length === 0 && <div className="profile-context profile-context-warning">
        <strong>{t('claimNeedsPerformerProfile')}</strong>
        <p>{t('claimNeedsPerformerProfileIntro')}</p>
        <form className="dashboard-series-card-actions" onSubmit={(event) => {
          event.preventDefault()
          if (newProfileName.trim()) context.createProfile.mutate({ profile_name: newProfileName.trim(), profile_kind: 'performer' }, { onSuccess: () => setNewProfileName('') })
        }}>
          <input aria-label={t('profileName')} placeholder={t('profileName')} value={newProfileName} onChange={(event) => setNewProfileName(event.target.value)} />
          <button className="quiet-button" type="submit" disabled={context.createProfile.isPending || !newProfileName.trim()}>{context.createProfile.isPending ? t('creatingProfile') : t('createPerformerProfile')}</button>
        </form>
        {context.createProfile.isError && <p className="form-error" role="alert">{t('profileSaveError')}</p>}
      </div>}
      {claimable.data.length === 0
        ? <ReadState message={t('noClaimableRegistrations')} />
        : <>
          <div className="dashboard-series-list">
            {claimable.data.map((registration) => <ClaimRow key={registration.id} registration={registration} performerProfiles={performerProfiles} />)}
          </div>
        </>}
    </section>
  </main>
}
