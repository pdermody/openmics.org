import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client'
import { ProfileIdentity } from '../components/ProfileIdentity'
import { useAccountContext } from '../features/account'
import { PROFILE_KIND_ORDER, PROFILE_KINDS, type ProfileKind } from '../features/profileKinds'
import type { ColorMode, ThemeId } from '../theme'
import { Modal, ReadState, Required, SiteHeader } from './shared'

function deleteErrorKey(error: unknown): string {
  if (error instanceof ApiError && error.code === 'CURRENT_PROFILE') return 'cannotDeleteCurrentProfile'
  if (error instanceof ApiError && error.code === 'LAST_PROFILE') return 'cannotDeleteLastProfile'
  return 'profileDeleteError'
}

export function ProfileManagementPage({ theme, mode }: { theme: ThemeId; mode: ColorMode }) {
  const { t } = useTranslation()
  const context = useAccountContext()
  const [newProfileName, setNewProfileName] = useState('')
  const [newProfileKind, setNewProfileKind] = useState<ProfileKind>('performer')
  const [deleteProfileId, setDeleteProfileId] = useState<string | null>(null)

  if (!context.account.data) return <main className="app" data-theme={theme} data-mode={mode}><SiteHeader /><ReadState message={t('signInDashboard')} /></main>
  if (context.profiles.isPending) return <main className="app" data-theme={theme} data-mode={mode}><SiteHeader /><ReadState message={t('loadingProfiles')} /></main>

  const profiles = context.profiles.data?.items ?? []
  const currentProfileId = context.account.data.current_profile_id
  function createProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = newProfileName.trim()
    if (!name) return
    context.createProfile.mutate({ profile_name: name, profile_kind: newProfileKind, visibility: 'private' }, { onSuccess: () => setNewProfileName('') })
  }

  return <main className="app" data-theme={theme} data-mode={mode}>
    <SiteHeader />
    <section className="dashboard-page">
      <Link className="back-link" to="/dashboard">{t('backToDashboard')}</Link>
      <div className="eyebrow">{t('profiles')}</div>
      <h1>{t('manageProfiles')}</h1>
      <p className="detail-lede">{t('manageProfilesIntro')}</p>
      <div className="dashboard-series-list">
        {profiles.map((profile) => {
          const isCurrent = profile.id === currentProfileId
          const deleteBlockedKey = isCurrent ? 'cannotDeleteCurrentProfile' : profiles.length <= 1 ? 'cannotDeleteLastProfile' : null
          return <article className="dashboard-series-card" key={profile.id}>
            <div>
              <h2><ProfileIdentity profile={profile} variant="full" /></h2>
              {isCurrent && <p className="profile-context">{t('currentProfile')}</p>}
              {deleteBlockedKey && <p className="field-hint">{t(deleteBlockedKey)}</p>}
            </div>
            <div className="dashboard-series-card-actions">
              <button type="button" className="quiet-button" disabled={isCurrent || context.currentProfile.isPending} onClick={() => context.currentProfile.mutate(profile.id)}>{t('switchProfile')}</button>
              <Link className="quiet-button" to="/profiles/$profileId/edit" params={{ profileId: profile.id }}>{t('editProfile')}</Link>
              <button type="button" className="link-button" disabled={Boolean(deleteBlockedKey) || context.deleteProfile.isPending} onClick={() => setDeleteProfileId(profile.id)}>{t('deleteProfile')}</button>
            </div>
          </article>
        })}
      </div>
      <form className="profile-create-form" onSubmit={createProfile}>
        <div className="mode-switch" role="group" aria-label={t('profileKindLabel')}>
          {PROFILE_KIND_ORDER.map((kind) => <button key={kind} type="button" className={newProfileKind === kind ? 'selected' : ''} aria-pressed={newProfileKind === kind} onClick={() => setNewProfileKind(kind)}>{t(PROFILE_KINDS[kind].labelKey)}</button>)}
        </div>
        <label><span>{t('newProfile')}<Required /></span><input required value={newProfileName} onChange={(event) => setNewProfileName(event.target.value)} placeholder={t('profileName')} /></label>
        <button className="primary-button" type="submit" disabled={context.createProfile.isPending}>{context.createProfile.isPending ? t('creatingProfile') : t('createProfile')}</button>
      </form>
      {newProfileKind === 'organizer' && <p className="field-hint">{t('organizerNoHandleHint')}</p>}
      <p className="field-hint">{t('newProfilesPrivateHint')}</p>
      {context.createProfile.isError && <p className="form-error" role="alert">{t('profileSaveError')}</p>}
      {context.deleteProfile.isError && <p className="form-error" role="alert">{t(deleteErrorKey(context.deleteProfile.error))}</p>}
      {deleteProfileId && <Modal title={t('deleteProfile')} onClose={() => setDeleteProfileId(null)}><p>{t('confirmDeleteProfile')}</p><div className="dashboard-series-card-actions"><button type="button" className="quiet-button" disabled={context.deleteProfile.isPending} onClick={() => void context.deleteProfile.mutateAsync(deleteProfileId, { onSuccess: () => setDeleteProfileId(null) })}>{t('confirm')}</button><button type="button" className="link-button" onClick={() => setDeleteProfileId(null)}>{t('cancel')}</button></div></Modal>}
    </section>
  </main>
}
