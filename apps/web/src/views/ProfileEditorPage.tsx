import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Sparkles } from 'lucide-react'
import { useAccountContext } from '../features/account'
import type { ColorMode, ThemeId } from '../theme'
import { HeaderMenu, ProfileSwitcher, ReadState, Required, RequiredFieldsNote, SignInButton } from './shared'

const profileFormSchema = z.object({
  profile_name: z.string().trim().min(1, 'Profile name is required'),
  bio: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  visibility: z.enum(['public', 'unlisted', 'private']),
})

type ProfileFormValues = z.infer<typeof profileFormSchema>

const DEFAULT_VALUES: ProfileFormValues = { profile_name: '', bio: '', phone: '', visibility: 'public' }

export function ProfileEditorPage({ profileId, theme, mode }: { profileId: string; theme: ThemeId; mode: ColorMode }) {
  const { t } = useTranslation()
  const context = useAccountContext()
  const profile = context.profiles.data?.items.find((item) => item.id === profileId)

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: DEFAULT_VALUES,
  })

  useEffect(() => {
    if (!profile) return
    reset({
      profile_name: profile.profile_name,
      bio: profile.bio ?? '',
      phone: profile.phone ?? '',
      visibility: (profile.visibility as ProfileFormValues['visibility']) ?? 'public',
    })
  }, [profile, reset])

  if (context.account.isPending || context.profiles.isPending) return <main className="app" data-theme={theme} data-mode={mode}><ReadState message={t('loading')} /></main>
  if (!context.account.data || !profile) return <main className="app" data-theme={theme} data-mode={mode}><ReadState message="This profile is not available to edit." /></main>

  function onSubmit(values: ProfileFormValues) {
    context.updateProfile.mutate({ id: profileId, profile_name: values.profile_name, bio: values.bio ?? '', phone: values.phone ?? '', visibility: values.visibility })
  }

  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><a className="brand" href="/" aria-label={t('openMicHome')}><span className="brand-mark"><Sparkles size={17} /></span><span>{t("appName")}</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
    <section className="registration-page profile-editor">
      <a className="back-link" href={`/profiles/${profileId}`}>← Back to profile</a>
      <div className="eyebrow">{t('profileSettings')}</div>
      <h1>{t('editProfile')} {profile.profile_name}</h1>
      <form className="registration-form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <RequiredFieldsNote />
        <label><span>{t('profileName')}<Required /></span><input required {...register('profile_name')} /></label>
        {errors.profile_name && <p className="form-error" role="alert">{errors.profile_name.message}</p>}
        <label>{t('bio')} <span className="field-hint">{t('optional')}</span><textarea {...register('bio')} /></label>
        <label>{t('phone')} <span className="field-hint">{t('privateContact')}</span><input type="tel" {...register('phone')} /></label>
        <label>{t('visibility')}<select {...register('visibility')}><option value="public">{t('public')}</option><option value="unlisted">{t('unlisted')}</option><option value="private">{t('private')}</option></select></label>
        {context.updateProfile.isError && <p className="form-error" role="alert">{t('profileSaveError')}</p>}
        {context.updateProfile.isSuccess && <p className="form-success" role="status">{t('profileSaved')}</p>}
        <button className="primary-button" type="submit" disabled={context.updateProfile.isPending}>{context.updateProfile.isPending ? t('loading') : t('save')}</button>
      </form>
    </section>
  </main>
}
