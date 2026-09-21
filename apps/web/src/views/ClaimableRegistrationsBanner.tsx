import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useAccountContext } from '../features/account'
import { useClaimableRegistrations } from '../features/claimableRegistrations'
import { ReadState } from './shared'

export function ClaimableRegistrationsBanner() {
  const { t } = useTranslation()
  const context = useAccountContext()
  const claimable = useClaimableRegistrations(Boolean(context.account.data))

  if (!context.account.data) return null
  if (claimable.isPending) return <ReadState message="Checking for registrations you can claim…" />
  if (claimable.isError || !claimable.data || claimable.data.length === 0) return null

  return <div className="profile-context" role="status">
    <p><strong>{claimable.data.length}</strong> guest registration{claimable.data.length === 1 ? '' : 's'} match your verified email. Claim them to link them to your account.</p>
    <Link className="quiet-button" to="/claim-registrations">{t('reviewClaimableRegistrations')}</Link>
  </div>
}
