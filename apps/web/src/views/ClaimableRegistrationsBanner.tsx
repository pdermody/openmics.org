import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client'
import { useAccountContext, type AccountProfile } from '../features/account'
import { useClaimableRegistrations, useClaimRegistration, type ClaimableRegistration } from '../features/claimableRegistrations'
import { ReadState } from './shared'

function ClaimRow({ registration, performerProfiles }: { registration: ClaimableRegistration; performerProfiles: AccountProfile[] }) {
  const { t } = useTranslation()
  const claim = useClaimRegistration()
  const [adoptedProfileId, setAdoptedProfileId] = useState('')

  return <li className="dashboard-series-card">
    <div>
      <span className="panel-label">{t('unclaimedRegistration')}</span>
      <h2>{registration.performer_name}</h2>
      {registration.song_names.length > 0 && <p>{registration.song_names.join(', ')}</p>}
    </div>
    <div className="profile-context-controls">
      {performerProfiles.length > 0 && <label><span className="sr-only">{t('adoptProfile')}</span><select value={adoptedProfileId} onChange={(event) => setAdoptedProfileId(event.target.value)}>
        <option value="">{t('keepGuest')}</option>
        {performerProfiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.profile_name}</option>)}
      </select></label>}
      <button
        className="quiet-button"
        type="button"
        disabled={claim.isPending}
        onClick={() => claim.mutate({ registrationId: registration.id, adoptedProfileId: adoptedProfileId || undefined })}
      >
        {claim.isPending ? 'Claiming…' : 'Claim'}
      </button>
    </div>
    {claim.isError && <p className="form-error" role="alert">
      {claim.error instanceof ApiError && claim.error.code === 'REGISTRATION_ALREADY_CLAIMED'
        ? 'Someone already claimed this registration.'
        : 'We could not claim this registration. Please try again.'}
    </p>}
  </li>
}

export function ClaimableRegistrationsBanner() {
  const context = useAccountContext()
  const claimable = useClaimableRegistrations(Boolean(context.account.data))
  const claimAll = useClaimRegistration()
  const performerProfiles = context.profiles.data?.items.filter((profile) => profile.profile_kind === 'performer') ?? []

  if (!context.account.data) return null
  if (claimable.isPending) return <ReadState message="Checking for registrations you can claim…" />
  if (claimable.isError || !claimable.data || claimable.data.length === 0) return null

  return <div className="profile-context" role="status">
    <p><strong>{claimable.data.length}</strong> guest registration{claimable.data.length === 1 ? '' : 's'} match your verified email. Claim them to link them to your account.</p>
    <button
      className="quiet-button"
      type="button"
      disabled={claimAll.isPending}
      onClick={() => claimable.data!.forEach((registration) => claimAll.mutate({ registrationId: registration.id }))}
    >
      {claimAll.isPending ? 'Claiming…' : 'Claim all'}
    </button>
    <ul className="dashboard-grid">
      {claimable.data.map((registration) => <ClaimRow registration={registration} performerProfiles={performerProfiles} key={registration.id} />)}
    </ul>
  </div>
}
