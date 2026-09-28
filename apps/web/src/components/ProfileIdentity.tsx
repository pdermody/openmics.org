import { useTranslation } from 'react-i18next'
import { profileKindMeta } from '../features/profileKinds'

type ProfileIdentityProps = {
  profile: { profile_name: string; profile_kind: string; current_handle?: string | null }
  variant?: 'compact' | 'full'
}

// Kind is always shown as icon plus text so profiles sharing a display name stay distinguishable.
export function ProfileIdentity({ profile, variant = 'compact' }: ProfileIdentityProps) {
  const { t } = useTranslation()
  const kind = profileKindMeta(profile.profile_kind)
  const Icon = kind?.icon
  const kindLabel = kind ? t(kind.labelKey) : profile.profile_kind
  return <span className={`profile-identity profile-identity-${variant}`}>
    {Icon && <Icon className="profile-identity-icon" size={variant === 'full' ? 18 : 15} aria-hidden="true" />}
    <span className="profile-identity-text">
      <span className="profile-identity-name">{profile.profile_name}</span>
      <span className="profile-identity-meta">
        {kindLabel}
        {variant === 'full' && profile.current_handle && <> · @{profile.current_handle}</>}
      </span>
    </span>
  </span>
}
