import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { PasswordInput } from '../components/forms/PasswordInput'
import {
  changePassword,
  confirmPasswordReset,
  confirmSignUpCode,
  markPendingSignInRedirect,
  requestPasswordReset,
  signInWithPassword,
  signUpWithPassword,
} from '../auth/session'
import type { ColorMode, ThemeId } from '../theme'
import { Required, RequiredFieldsNote, SiteFooter, SiteHeader } from './shared'

type AuthMode = 'sign-in' | 'sign-up' | 'confirm-sign-up' | 'forgot-password' | 'reset-password' | 'change-password'

export function AuthPage({ mode, theme, colorMode }: { mode: AuthMode; theme: ThemeId; colorMode: ColorMode }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [currentMode, setCurrentMode] = useState(mode)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setCurrentMode(mode)
    setError('')
    setMessage('')
  }, [mode])

  const title = {
    'sign-in': t('authSignInTitle'), 'sign-up': t('authSignUpTitle'), 'confirm-sign-up': t('authConfirmTitle'),
    'forgot-password': t('authForgotTitle'), 'reset-password': t('authResetTitle'), 'change-password': t('authChangeTitle'),
  }[currentMode]

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true); setError(''); setMessage('')
    try {
      if (currentMode === 'sign-in') {
        const result = await signInWithPassword(username, password)
        if (result.isSignedIn) { markPendingSignInRedirect(); void navigate({ to: '/' }) }
        else setMessage(t('authContinueMessage'))
      } else if (currentMode === 'sign-up') {
        const result = await signUpWithPassword(username, password)
        setMessage(t('authCheckEmail'))
        if (!result.isSignUpComplete) setCurrentMode('confirm-sign-up')
      } else if (currentMode === 'confirm-sign-up') {
        await confirmSignUpCode(username, code)
        setMessage(t('authConfirmed'))
        setCurrentMode('sign-in')
      } else if (currentMode === 'forgot-password') {
        await requestPasswordReset(username)
        setMessage(t('authResetCodeSent'))
        setCurrentMode('reset-password')
      } else if (currentMode === 'reset-password') {
        await confirmPasswordReset(username, code, newPassword)
        setMessage(t('authPasswordReset'))
        setCurrentMode('sign-in')
      } else {
        await changePassword(password, newPassword)
        setPassword(''); setNewPassword(''); setMessage(t('authPasswordChanged'))
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('authGenericError'))
    } finally { setBusy(false) }
  }

  const needsCode = currentMode === 'confirm-sign-up' || currentMode === 'reset-password'
  const needsPassword = currentMode === 'sign-in' || currentMode === 'sign-up' || currentMode === 'change-password'
  const needsNewPassword = currentMode === 'sign-up' || currentMode === 'reset-password' || currentMode === 'change-password'

  return <main className="app auth-page" data-theme={theme} data-mode={colorMode}>
    <SiteHeader />
    <section className="auth-panel">
      <div className="eyebrow">{t('account')}</div>
      <h1>{title}</h1>
      <p className="detail-lede">{t(`auth${currentMode === 'sign-in' ? 'SignIn' : 'Secure'}Intro`)}</p>
      <form className="registration-form" onSubmit={submit} noValidate>
        <RequiredFieldsNote />
        {currentMode !== 'change-password' && <label><span>{t('email')}<Required /></span><input required type="email" autoComplete="email" value={username} onChange={(event) => setUsername(event.target.value)} /></label>}
        {needsCode && <label><span>{t('authCode')}<Required /></span><input required inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value)} /></label>}
        {needsPassword && <label><span>{currentMode === 'change-password' ? t('authCurrentPassword') : t('password')}<Required /></span><PasswordInput fieldLabel={currentMode === 'change-password' ? t('authCurrentPassword') : t('password')} required autoComplete={currentMode === 'sign-in' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} /></label>}
        {needsNewPassword && <label><span>{t('authNewPassword')}<Required /></span><PasswordInput fieldLabel={t('authNewPassword')} required autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p className="form-success" role="status">{message}</p>}
        <button className="primary-button" type="submit" disabled={busy}>{busy ? t('loading') : t('continue')}</button>
      </form>
      <div className="auth-links">
        {currentMode === 'sign-in' && <><button type="button" className="link-button" onClick={() => setCurrentMode('forgot-password')}>{t('authForgotPassword')}</button><button type="button" className="link-button" onClick={() => setCurrentMode('sign-up')}>{t('authCreateAccount')}</button></>}
        {currentMode === 'sign-up' && <button type="button" className="link-button" onClick={() => setCurrentMode('sign-in')}>{t('authBackToSignIn')}</button>}
        {currentMode === 'forgot-password' && <button type="button" className="link-button" onClick={() => setCurrentMode('sign-in')}>{t('authBackToSignIn')}</button>}
      </div>
    </section>
    <SiteFooter theme={theme} mode={colorMode} />
  </main>
}
