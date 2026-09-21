import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Heart, Menu, MessageCircle, Sparkles, X } from 'lucide-react'
import { consumeSignInError, endSession } from '../auth/session'
import { useDismissableDetails, useDismissOnOutsideOrEscape } from '../hooks/dismissable'
import { changeLanguage, supportedLanguages } from '../i18n'
import { useAccountContext } from '../features/account'

export type ThemeProps = { theme: import('../theme').ThemeId; mode: import('../theme').ColorMode }

// Visual marker for a required form field, paired with a legend (see RequiredFieldsNote) so
// screen-reader users get an equivalent text explanation instead of relying on the asterisk alone.
export function Required() {
  return <span className="required-mark" aria-hidden="true"> *</span>
}

export function RequiredFieldsNote() {
  const { t } = useTranslation()
  return <p className="field-hint required-fields-note"><span className="required-mark" aria-hidden="true">*</span> {t('requiredFields')}</p>
}

export function SocialButton({ label, icon }: { label: string; icon: 'heart' | 'message' }) {
  const Icon = icon === 'heart' ? Heart : MessageCircle
  return <button className="social-button" type="button" disabled aria-label={`${label} coming soon`}><Icon size={16} strokeWidth={1.8} /><span>{label}</span></button>
}

// Portal-rendered dialog used anywhere a page needs a real modal (as opposed to an inline
// <details> popover): it's mounted on document.body so it's never clipped by a scrolling
// ancestor (e.g. the roster board's horizontally-scrolling kanban columns), and closes on
// Escape or a backdrop click via the same dismiss hook used by other popovers on the page.
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation()
  const panelRef = useDismissOnOutsideOrEscape<HTMLDivElement>(true, onClose)
  // Portal into the themed `.app` root (not document.body): it's still an ancestor of any
  // scrolling container we need to escape for clipping purposes, but staying inside `.app`
  // keeps the theme's CSS custom properties (--surface, --ink, etc., scoped to `.app[data-theme]`
  // selectors) in scope, so the modal isn't rendered with a transparent background/black text.
  const portalTarget = document.querySelector('.app') ?? document.body
  return createPortal(
    <div className="modal-backdrop">
      <div className="modal-panel" ref={panelRef} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="modal-close" aria-label={t('close')} onClick={onClose}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>,
    portalTarget,
  )
}

export function ReadState({ message, retry }: { message: string; retry?: () => void }) {
  const { t } = useTranslation()
  return <div className="read-state" role="status"><span>{message}</span>{retry && <button className="link-button" type="button" onClick={retry}>{t('tryAgain')}</button>}</div>
}

export function SignInButton() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const context = useAccountContext()
  const [message, setMessage] = useState('')
  const signedIn = Boolean(context.account.data)

  useEffect(() => {
    const failure = consumeSignInError()
    if (failure) setMessage(failure)
  }, [])

  if (signedIn) {
    return <div className="auth-slot"><button className="text-button" type="button" onClick={() => {
      void endSession().then(() => {
        queryClient.clear()
        void navigate({ to: '/' })
      })
    }}>{t('signOut')}</button></div>
  }

  return <div className="auth-slot"><button className="text-button" type="button" onClick={() => { void navigate({ to: '/auth/$mode', params: { mode: 'sign-in' } }) }}>{t('signIn')}</button>{message && <span className="auth-note" role="status">{message}</span>}</div>
}

// Shared by any <details>-based popover/menu (the page HeaderMenu, and the roster page's
// per-card hamburger menus): closes the element when the user clicks outside it or presses
// Escape, matching native menu/dropdown dismiss behavior since we use plain <details> rather
// than a dedicated popover library. Lives in ../hooks/dismissable so a component file (this
// one) doesn't also export non-component hooks (keeps fast-refresh lint clean).

export function HeaderMenu() {
  const { t } = useTranslation()
  const menuRef = useDismissableDetails()

  return <>
    <nav className="header-actions" aria-label={t('menu')}><Suspense fallback={null}><LazyDashboardMenuLink /></Suspense><Link to="/settings/theme">{t('theme')}</Link></nav>
    <details className="header-menu" ref={menuRef}><summary aria-label={t('menu')}><Menu size={18} /><span>{t('menu')}</span></summary><nav aria-label={t('menu')}><Suspense fallback={null}><LazyDashboardMenuLink /></Suspense><Link to="/settings/theme">{t('theme')}</Link></nav></details>
  </>
}


const LazyProfileSwitcher = lazy(() => import('./profile-context').then((module) => ({ default: module.ProfileSwitcher })))
const LazyDashboardMenuLink = lazy(() => import('./profile-context').then((module) => ({ default: module.DashboardMenuLink })))
export function ProfileSwitcher() { return <div className="profile-context-slot"><Suspense fallback={null}><LazyProfileSwitcher /></Suspense></div> }

export function SiteHeader() {
  const { t } = useTranslation()
  return <header className="topbar"><Link className="brand" to="/" aria-label={t('openMicHome')}><span className="brand-mark"><Sparkles size={17} /></span><span>{t('appName')}</span></Link><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
}

export function LanguageSelector() {
  const { i18n, t } = useTranslation()
  const context = useAccountContext()
  const selectedLanguage = i18n.language.startsWith('es') ? 'es' : 'en'

  useEffect(() => {
    const accountLanguage = context.account.data?.preferred_language
    if (accountLanguage === 'en' || accountLanguage === 'es') void changeLanguage(accountLanguage)
  }, [context.account.data?.preferred_language])

  async function selectLanguage(language: 'en' | 'es') {
    await changeLanguage(language)
    if (context.account.data?.id) {
      await context.updateAccount.mutateAsync({ preferred_language: language })
    }
  }

  return <label className="language-selector"><span className="sr-only">{t('language')}</span><select aria-label={t('language')} value={selectedLanguage} onChange={(event) => void selectLanguage(event.target.value as 'en' | 'es')}>
    {supportedLanguages.map((language) => <option value={language.code} key={language.code}>{language.name}</option>)}
  </select></label>
}

export function SiteFooter({ theme, mode }: ThemeProps) {
  const { t } = useTranslation()
  return <footer className="footer app" data-theme={theme} data-mode={mode}><div className="footer-content"><span>{t('footerCopy')}</span><LanguageSelector /><Link className="footer-link" to="/settings/theme">{t('appearance')}</Link></div></footer>
}
