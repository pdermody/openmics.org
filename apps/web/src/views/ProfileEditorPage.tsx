import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useAccountContext } from '../features/account'
import type { ColorMode, ThemeId } from '../theme'
import { HeaderMenu, ProfileSwitcher, ReadState, SignInButton } from './shared'

export function ProfileEditorPage({ profileId, theme, mode }: { profileId: string; theme: ThemeId; mode: ColorMode }) {
  const context = useAccountContext()
  const profile = context.profiles.data?.items.find((item) => item.id === profileId)
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [phone, setPhone] = useState('')
  const [visibility, setVisibility] = useState('public')

  useEffect(() => {
    if (!profile) return
    setName(profile.profile_name)
    setBio(profile.bio ?? '')
    setPhone(profile.phone ?? '')
    setVisibility(profile.visibility)
  }, [profile])

  if (context.account.isPending || context.profiles.isPending) return <main className="app" data-theme={theme} data-mode={mode}><ReadState message="Loading profile settings…" /></main>
  if (!context.account.data || !profile) return <main className="app" data-theme={theme} data-mode={mode}><ReadState message="This profile is not available to edit." /></main>

  return <main className="app" data-theme={theme} data-mode={mode}>
    <header className="topbar"><a className="brand" href="/" aria-label="Open Mic home"><span className="brand-mark"><Sparkles size={17} /></span><span>open mic</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
    <section className="registration-page profile-editor">
      <a className="back-link" href={`/profiles/${profileId}`}>← Back to profile</a>
      <div className="eyebrow">Profile settings</div>
      <h1>Edit {profile.profile_name}</h1>
      <form className="registration-form" onSubmit={(event) => { event.preventDefault(); context.updateProfile.mutate({ id: profileId, profile_name: name, bio, phone, visibility }) }}>
        <label>Profile name<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>Bio <span className="field-hint">Optional</span><textarea value={bio} onChange={(event) => setBio(event.target.value)} /></label>
        <label>Phone <span className="field-hint">Private contact detail</span><input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
        <label>Visibility<select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select></label>
        {context.updateProfile.isError && <p className="form-error" role="alert">We could not save your profile. Please check the fields and try again.</p>}
        {context.updateProfile.isSuccess && <p className="form-success" role="status">Profile saved.</p>}
        <button className="primary-button" type="submit" disabled={context.updateProfile.isPending}>{context.updateProfile.isPending ? 'Saving…' : 'Save profile'}</button>
      </form>
    </section>
  </main>
}
