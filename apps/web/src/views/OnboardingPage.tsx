import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { ApiError } from '../api/client'
import { useAccountContext } from '../features/account'
import { useHandleAvailability } from '../features/handles'
import { suggestHandle } from '../features/slugify'
import { themes, type ColorMode, type ThemeId } from '../theme'
import { Required, RequiredFieldsNote, SiteHeader } from './shared'

type OnboardingPageProps = {
  theme: ThemeId
  mode: ColorMode
  setTheme: (theme: ThemeId) => void
  setMode: (mode: ColorMode) => void
}

function onboardingErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong creating your profile. Please try again.'
  if (error.code === 'HANDLE_UNAVAILABLE') return 'That handle is already taken. Please choose another.'
  return 'Something went wrong creating your profile. Please try again.'
}


export function OnboardingPage({ theme, mode, setTheme, setMode }: OnboardingPageProps) {
  const { t } = useTranslation()
  const context = useAccountContext()
  const [kind, setKind] = useState<'performer' | 'organizer'>('performer')
  const [profileName, setProfileName] = useState('')
  const [handle, setHandle] = useState('')
  const [handleDirty, setHandleDirty] = useState(false)
  const activeTheme = themes.find((item) => item.id === theme) ?? themes[0]
  const themeText = (id: ThemeId, field: 'name' | 'source' | 'note') => t(`themes.${id}.${field}`)
  const handleCheck = useHandleAvailability(handle, true)

  // Suggest a starting name from the account once it loads, but let the user override it —
  // account display_name/email are not guaranteed to be a good profile name (e.g. a Cognito
  // user pool may not have collected a real name at sign-up).
  useEffect(() => {
    if (profileName) return
    const suggestion = context.account.data?.display_name || context.account.data?.email.split('@')[0]
    if (suggestion) setProfileName(suggestion)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.account.data])

  // Suggest a handle from the profile name until the user edits it directly, mirroring
  // OpenMicFormPage's pattern so the user always confirms/picks their own handle.
  useEffect(() => {
    if (handleDirty) return
    setHandle(suggestHandle(profileName))
  }, [profileName, handleDirty])

  // Only block on a definitively bad handle (unavailable/invalid format); if the availability
  // check hasn't resolved yet (idle/checking, e.g. a slow network or a request hiccup), let the
  // submission proceed and rely on the server's authoritative check — a perpetually-disabled
  // button with no visible error is worse than an occasional server-side HANDLE_UNAVAILABLE.
  const canSubmit = Boolean(handle) && handleCheck.state !== 'unavailable' && handleCheck.state !== 'invalid'

  function handleSubmit() {
    if (!canSubmit) return
    context.createProfile.mutate({
      profile_name: profileName.trim() || 'My profile',
      profile_kind: kind,
      theme_name: theme,
      color_mode: mode,
      handle,
    })
  }

  return (
    <main className="app" data-theme={theme} data-mode={mode}>
      <SiteHeader />
      <section className="theme-page">
        <div className="eyebrow">{t('welcome')}</div>
        <h1>{t('firstProfile')}</h1>
        <p className="detail-lede">{t('profileIntro')}</p>

        <RequiredFieldsNote />
        <label className="onboarding-name-field"><span>{t('profileName')}<Required /></span><input required type="text" value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="e.g. your stage name or open mic series name" /></label>

        <label className="onboarding-name-field"><span>{t('handle')}<Required /></span> <span className="field-hint">{t('handleHintOnboarding')}</span><span className="handle-input"><span aria-hidden="true">@</span><input required type="text" value={handle} onChange={(event) => { setHandleDirty(true); setHandle(event.target.value) }} /></span></label>
        {handle && <p className={`handle-feedback ${handleCheck.state === 'available' ? 'form-success' : handleCheck.state === 'checking' ? 'field-hint' : 'form-error'}`} role={handleCheck.state === 'unavailable' || handleCheck.state === 'invalid' ? 'alert' : 'status'}>
          {handleCheck.state === 'available' && <CircleCheck aria-hidden="true" size={16} />}
          {(handleCheck.state === 'unavailable' || handleCheck.state === 'invalid') && <CircleAlert aria-hidden="true" size={16} />}
          {handleCheck.state === 'checking' ? t('checkingAvailability') : handleCheck.message}
        </p>}

        <div className="mode-switch" role="group" aria-label={t('profileKindLabel')}>
          <button className={kind === 'performer' ? 'selected' : ''} type="button" onClick={() => setKind('performer')}>{t('iPerform')}</button>
          <button className={kind === 'organizer' ? 'selected' : ''} type="button" onClick={() => setKind('organizer')}>{t('iOrganize')}</button>
        </div>

        <aside className="theme-panel theme-page-panel" aria-label={t('colorModeControls')}>
          <div className="panel-heading"><div><span className="panel-label">{t('currentTheme')}</span><strong>{themeText(activeTheme.id, 'name')}</strong></div><span className="source-pill">{themeText(activeTheme.id, 'source')}</span></div>
          <p>{themeText(activeTheme.id, 'note')}</p>
          <div className="mode-switch" role="group" aria-label={t('colorMode')}>
            <button className={mode === 'light' ? 'selected' : ''} type="button" onClick={() => setMode('light')}>{t('light')}</button>
            <button className={mode === 'dark' ? 'selected' : ''} type="button" onClick={() => setMode('dark')}>{t('dark')}</button>
          </div>
        </aside>

        <div className="theme-grid theme-page-grid" aria-label={t('themeGallery')}>
          {themes.map((item) => <button className={`theme-chip ${theme === item.id ? 'selected' : ''}`} key={item.id} type="button" onClick={() => setTheme(item.id)}><span className="swatches" aria-hidden="true">{item.swatches.map((color) => <i key={color} style={{ backgroundColor: color }} />)}</span><span><strong>{themeText(item.id, 'name')}</strong><small>{themeText(item.id, 'source')}</small></span></button>)}
        </div>

        {context.createProfile.isError && <p className="form-error" role="alert">{onboardingErrorMessage(context.createProfile.error)}</p>}
        <button className="primary-button" type="button" disabled={context.createProfile.isPending || !canSubmit} onClick={handleSubmit}>{context.createProfile.isPending ? t('creatingProfile') : t('continue')}</button>
      </section>
    </main>
  )
}
