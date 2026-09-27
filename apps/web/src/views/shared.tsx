import { lazy, Suspense, useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Heart, LogIn, LogOut, MessageCircle, Sparkles, UserPlus, UserRound, X } from 'lucide-react'
import { consumeSignInError, endSession } from '../auth/session'
import { useDismissOnOutsideOrEscape } from '../hooks/dismissable'
import { changeLanguage, supportedLanguages } from '../i18n'
import { useAccountContext } from '../features/account'
import { accountKeys } from '../features/account'
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from '../components/radix-menu'

export type ThemeProps = { theme: import('../theme').ThemeId; mode: import('../theme').ColorMode }

// Visual marker for a required form field, paired with a legend (see RequiredFieldsNote) so
// screen-reader users get an equivalent text explanation instead of relying on the asterisk alone.
export function Required() {
  return <span className="required-mark" aria-hidden="true"> *</span>
}

export function RequiredFieldsNote({ className = '' }: { className?: string }) {
  const { t } = useTranslation()
  return <p className={`field-hint required-fields-note ${className}`.trim()}><span className="required-mark" aria-hidden="true">*</span> {t('requiredFields')}</p>
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
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  // A route's Suspense fallback can still be in the DOM during render; pick the themed root
  // after commit so the portal is not attached to a fallback that React then removes.
  useLayoutEffect(() => {
    setPortalTarget(document.querySelector('.app') ?? document.body)
  }, [])
  if (!portalTarget) return null
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
  const [signingOut, setSigningOut] = useState(false)
  const signedIn = Boolean(context.account.data)

  useEffect(() => {
    const failure = consumeSignInError()
    if (failure) setMessage(failure)
  }, [])

  async function signOut() {
    setSigningOut(true)
    try {
      await endSession()
    } finally {
      queryClient.setQueryData(accountKeys.me, undefined)
      queryClient.removeQueries({ queryKey: ['account'] })
      queryClient.clear()
      setSigningOut(false)
      void navigate({ to: '/' })
    }
  }

  if (signedIn) {
    return <MenuItem disabled={signingOut} onSelect={() => { void signOut() }}><LogOut size={15} aria-hidden="true" />{t('signOut')}</MenuItem>
  }

  return <>{message && <span className="auth-note" role="status">{message}</span>}<MenuItem onSelect={() => { void navigate({ to: '/auth/$mode', params: { mode: 'sign-in' } }) }}><LogIn size={15} aria-hidden="true" />{t('signIn')}</MenuItem><MenuItem onSelect={() => { void navigate({ to: '/auth/$mode', params: { mode: 'sign-up' } }) }}><UserPlus size={15} aria-hidden="true" />{t('authCreateAccount')}</MenuItem></>
}

// Shared by any <details>-based popover/menu (the page HeaderMenu, and the roster page's
// per-card hamburger menus): closes the element when the user clicks outside it or presses
// Escape, matching native menu/dropdown dismiss behavior since we use plain <details> rather
// than a dedicated popover library. Lives in ../hooks/dismissable so a component file (this
// one) doesn't also export non-component hooks (keeps fast-refresh lint clean).

export function AccountMenuLink() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const context = useAccountContext()
  if (!context.account.data) return null
  return <MenuItem onSelect={() => void navigate({ to: '/account' })}>{t('account')}</MenuItem>
}

export function HeaderMenu() {
  const { t } = useTranslation()
  return <MenuRoot><MenuTrigger className="profile-menu-trigger" label={t('profileMenu')}><UserRound size={18} /></MenuTrigger><MenuContent className="profile-menu-content" align="end"><div className="profile-menu-panel"><ProfileSwitcher /><AccountMenuLink /><SignInButton /></div></MenuContent></MenuRoot>
}


const LazyProfileSwitcher = lazy(() => import('./profile-context').then((module) => ({ default: module.ProfileSwitcher })))
const LazyCurrentProfileLabel = lazy(() => import('./profile-context').then((module) => ({ default: module.CurrentProfileLabel })))
const LazyDashboardHeaderLink = lazy(() => import('./profile-context').then((module) => ({ default: module.DashboardHeaderLink })))
export function ProfileSwitcher() { return <div className="profile-context-slot"><Suspense fallback={null}><LazyProfileSwitcher /></Suspense></div> }

export function SiteHeader() {
  const { t } = useTranslation()
    return <header className="topbar"><Link className="brand" to="/" aria-label={t('openMicHome')}><span className="brand-mark"><Sparkles size={17} /></span><span>{t('appName')}</span></Link><Suspense fallback={null}><LazyDashboardHeaderLink /></Suspense><div className="profile-menu-root"><Suspense fallback={null}><LazyCurrentProfileLabel /></Suspense><HeaderMenu /></div></header>
}

export function LanguageSelector() {
  const { i18n, t } = useTranslation()
  const context = useAccountContext()
  const selectedLanguage = i18n.language.startsWith('es') ? 'es' : 'en'
  const selectedLanguageName = supportedLanguages.find((language) => language.code === selectedLanguage)?.name ?? selectedLanguage.toUpperCase()

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

  return <MenuRoot><MenuTrigger className="language-selector-trigger" label={t('language')}>{selectedLanguageName}</MenuTrigger><MenuContent className="language-menu-content" align="end">{supportedLanguages.map((language) => <MenuItem key={language.code} onSelect={() => void selectLanguage(language.code)}>{language.name}</MenuItem>)}</MenuContent></MenuRoot>
}

export function SiteFooter({ theme, mode }: ThemeProps) {
  const { t } = useTranslation()
  return <footer className="footer app" data-theme={theme} data-mode={mode}><div className="footer-content"><span>{t('copyrightNotice', { year: new Date().getFullYear() })}</span><LanguageSelector /><Link className="footer-link" to="/settings/theme">{t('appearance')}</Link></div></footer>
}
