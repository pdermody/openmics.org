import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAccountContext } from '../features/account'
import type { ColorMode, ThemeId } from '../theme'
import { Modal, ReadState, Required, SiteHeader } from './shared'

export function ProfileManagementPage({ theme, mode }: { theme: ThemeId; mode: ColorMode }) {
  const { t } = useTranslation()
  const context = useAccountContext()
  const [newProfileName, setNewProfileName] = useState('')
  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null)

  if (!context.account.data) return <main className="app" data-theme={theme} data-mode={mode}><SiteHeader /><ReadState message={t('signInDashboard')} /></main>
  if (context.profiles.isPending) return <main className="app" data-theme={theme} data-mode={mode}><SiteHeader /><ReadState message={t('loadingProfiles')} /></main>

  const profiles = context.profiles.data?.items ?? []
  function createPerformer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newProfileName.trim()
    if (!name) return
    context.createProfile.mutate({ profile_name: name, profile_kind: 'performer', visibility: 'private' }, { onSuccess: () => setNewProfileName('') })
  }

  return <main className="app" data-theme={theme} data-mode={mode}>
    <SiteHeader />
    <section className="dashboard-page">
      <Link className="back-link" to="/dashboard">{t('backToDashboard')}</Link>
      <div className="eyebrow">{t('profiles')}</div>
      <h1>{t('manageProfiles')}</h1>
      <p className="detail-lede">{t('manageProfilesIntro')}</p>
      <div className="dashboard-series-list">
        {profiles.map((profile) => <article className="dashboard-series-card" key={profile.id}>
          <div>
            <span className="panel-label">{profile.profile_kind}</span>
            <h2>{profile.profile_name}</h2>
            {profile.id === context.account.data?.current_profile_id && <p className="profile-context">{t('currentProfile')}</p>}
          </div>
          <div className="dashboard-series-card-actions">
            <button type="button" className="quiet-button" disabled={profile.id === context.account.data?.current_profile_id || context.currentProfile.isPending} onClick={() => context.currentProfile.mutate(profile.id)}>{t('switchProfile')}</button>
            <Link className="quiet-button" to="/profiles/$profileId/edit" params={{ profileId: profile.id }}>{t('editProfile')}</Link>
            <button type="button" className="link-button" disabled={context.deleteProfile.isPending} onClick={() => setDeleteProfileId(profile.id)}>{t('deleteProfile')}</button>
          </div>
        </article>)}
      </div>
      <form className="profile-create-form" onSubmit={createPerformer}>
        <label><span>{t('newPerformerProfile')}<Required /></span><input required value={newProfileName} onChange={(event) => setNewProfileName(event.target.value)} placeholder={t('profileName')} /></label>
        <button className="primary-button" type="submit" disabled={context.createProfile.isPending}>{context.createProfile.isPending ? t('creatingProfile') : t('createPerformerProfile')}</button>
      </form>
      <p className="field-hint">{t('newProfilesPrivateHint')}</p>
      {context.createProfile.isError && <p className="form-error" role="alert">{t('profileSaveError')}</p>}
      {context.deleteProfile.isError && <p className="form-error" role="alert">{t('profileDeleteError')}</p>}
      {deleteProfileId && <Modal title={t('deleteProfile')} onClose={() => setDeleteProfileId(null)}><p>{t('confirmDeleteProfile')}</p><div className="dashboard-series-card-actions"><button type="button" className="quiet-button" disabled={context.deleteProfile.isPending} onClick={() => void context.deleteProfile.mutateAsync(deleteProfileId, { onSuccess: () => setDeleteProfileId(null) })}>{t('confirm')}</button><button type="button" className="link-button" onClick={() => setDeleteProfileId(null)}>{t('cancel')}</button></div></Modal>}
    </section>
  </main>
}
