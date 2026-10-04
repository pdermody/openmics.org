import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useAccountContext } from '../features/account'
import { themes, type ColorMode, type ThemeId } from '../theme'
import { ReadState, Required, RequiredFieldsNote, SiteHeader } from './shared'

const profileFormSchema = z.object({
  profile_name: z.string().trim().min(1, 'Profile name is required'),
  profile_image_url: z.string().trim().url('Enter a valid image URL').or(z.literal('')).optional(),
  bio: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  visibility: z.enum(['public', 'unlisted', 'private']),
  show_gig_media: z.boolean(),
  theme_name: z.string().optional(),
  color_mode: z.enum(['light', 'dark']).optional(),
})

type ProfileFormValues = z.infer<typeof profileFormSchema>

const DEFAULT_VALUES: ProfileFormValues = { profile_name: '', profile_image_url: '', bio: '', phone: '', visibility: 'public', show_gig_media: true, theme_name: '', color_mode: undefined }

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
      profile_image_url: profile.profile_image_url ?? '',
      bio: profile.bio ?? '',
      phone: profile.phone ?? '',
      visibility: (profile.visibility as ProfileFormValues['visibility']) ?? 'public',
      show_gig_media: profile.show_gig_media ?? true,
      theme_name: profile.theme_name ?? '',
      color_mode: (profile.color_mode as ProfileFormValues['color_mode']) ?? undefined,
    })
  }, [profile, reset])

  if (context.account.isPending || context.profiles.isPending) return <main className="app" data-theme={theme} data-mode={mode}><ReadState message={t('loading')} /></main>
  if (!context.account.data || !profile) return <main className="app" data-theme={theme} data-mode={mode}><ReadState message="This profile is not available to edit." /></main>

  function onSubmit(values: ProfileFormValues) {
    context.updateProfile.mutate({ id: profileId, profile_name: values.profile_name, profile_image_url: values.profile_image_url ?? '', bio: values.bio ?? '', phone: values.phone ?? '', visibility: values.visibility, show_gig_media: values.show_gig_media, theme_name: values.theme_name || null, color_mode: values.color_mode || null })
  }

  return <main className="app" data-theme={theme} data-mode={mode}>
    <SiteHeader />
    <section className="registration-page profile-editor">
      <Link className="back-link" to="/profiles/$profileId" params={{ profileId }}>{t('backToProfile')}</Link>
      <div className="eyebrow">{t('profileSettings')}</div>
      <h1>{t('editProfile')} {profile.profile_name}</h1>
      <form className="registration-form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <RequiredFieldsNote />
        <label><span>{t('profileName')}<Required /></span><input required {...register('profile_name')} /></label>
        {errors.profile_name && <p className="form-error" role="alert">{errors.profile_name.message}</p>}
        {profile.profile_kind === 'performer' && <>
          <label>{t('handleLabel')}<input value={profile.current_handle ? `@${profile.current_handle}` : ''} placeholder={t('handleNotSet')} disabled readOnly /></label>
          <p className="field-hint">{t('handleRenameUnavailable')}</p>
        </>}
        <label>{t('profileImageUrl')}<input type="url" {...register('profile_image_url')} /></label>
        {errors.profile_image_url && <p className="form-error" role="alert">{errors.profile_image_url.message}</p>}
        <label>{t('bio')}<textarea {...register('bio')} /></label>
        <label>{t('phone')} <span className="field-hint">{t('privateContact')}</span><input type="tel" {...register('phone')} /></label>
        <label>{t('visibility')}<select {...register('visibility')}><option value="public">{t('public')}</option><option value="unlisted">{t('unlisted')}</option><option value="private">{t('private')}</option></select></label>
        {profile.profile_kind === 'performer' && (
          <label className="media-show-gig-toggle">
            <input type="checkbox" {...register('show_gig_media')} />
            <span>{t('showGigMedia')}</span>
          </label>
        )}
        {profile.profile_kind === 'performer' && <p className="field-hint">{t('showGigMediaHint')}</p>}
        <label>{t('theme')}<select {...register('theme_name')}><option value="">{t('currentTheme')}</option>{themes.map((item) => <option value={item.id} key={item.id}>{t(`themes.${item.id}.name`)}</option>)}</select></label>
        <label>{t('colorMode')}<select {...register('color_mode')}><option value="">{t('currentMode')}</option><option value="light">{t('light')}</option><option value="dark">{t('dark')}</option></select></label>
        {context.updateProfile.isError && <p className="form-error" role="alert">{t('profileSaveError')}</p>}
        {context.updateProfile.isSuccess && <p className="form-success" role="status">{t('profileSaved')}</p>}
        <button className="primary-button" type="submit" disabled={context.updateProfile.isPending}>{context.updateProfile.isPending ? t('loading') : t('save')}</button>
      </form>
    </section>
  </main>
}
