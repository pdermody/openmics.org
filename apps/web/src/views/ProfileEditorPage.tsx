import { useEffect } from 'react'
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

  if (context.account.isPending || context.profiles.isPending) return <main className="app" data-theme={theme} data-mode={mode}><ReadState message="Loading profile settings…" /></main>
  if (!context.account.data || !profile) return <main className="app" data-theme={theme} data-mode={mode}><ReadState message="This profile is not available to edit." /></main>

  function onSubmit(values: ProfileFormValues) {
    context.updateProfile.mutate({ id: profileId, profile_name: values.profile_name, bio: values.bio ?? '', phone: values.phone ?? '', visibility: values.visibility })
  }

  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><a className="brand" href="/" aria-label="Open Mic home"><span className="brand-mark"><Sparkles size={17} /></span><span>open mic</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
    <section className="registration-page profile-editor">
      <a className="back-link" href={`/profiles/${profileId}`}>← Back to profile</a>
      <div className="eyebrow">Profile settings</div>
      <h1>Edit {profile.profile_name}</h1>
      <form className="registration-form" onSubmit={handleSubmit(onSubmit)} noValidate>
        <RequiredFieldsNote />
        <label><span>Profile name<Required /></span><input required {...register('profile_name')} /></label>
        {errors.profile_name && <p className="form-error" role="alert">{errors.profile_name.message}</p>}
        <label>Bio <span className="field-hint">Optional</span><textarea {...register('bio')} /></label>
        <label>Phone <span className="field-hint">Private contact detail</span><input type="tel" {...register('phone')} /></label>
        <label>Visibility<select {...register('visibility')}><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select></label>
        {context.updateProfile.isError && <p className="form-error" role="alert">We could not save your profile. Please check the fields and try again.</p>}
        {context.updateProfile.isSuccess && <p className="form-success" role="status">Profile saved.</p>}
        <button className="primary-button" type="submit" disabled={context.updateProfile.isPending}>{context.updateProfile.isPending ? 'Saving…' : 'Save profile'}</button>
      </form>
    </section>
  </main>
}
