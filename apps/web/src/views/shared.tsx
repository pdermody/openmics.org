import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Heart, Menu, MessageCircle, Sparkles } from 'lucide-react'
import { beginSignIn } from '../auth/session'

export type ThemeProps = { theme: import('../theme').ThemeId; mode: import('../theme').ColorMode }

export function SocialButton({ label, icon }: { label: string; icon: 'heart' | 'message' }) {
  const Icon = icon === 'heart' ? Heart : MessageCircle
  return <button className="social-button" type="button" disabled aria-label={`${label} coming soon`}><Icon size={16} strokeWidth={1.8} /><span>{label}</span></button>
}

export function ReadState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="read-state" role="status"><span>{message}</span>{retry && <button className="link-button" type="button" onClick={retry}>Try again</button>}</div>
}

export function SignInButton() {
  const [message, setMessage] = useState('')
  return <div className="auth-slot"><button className="text-button" type="button" onClick={() => void beginSignIn().catch((error: Error) => setMessage(error.message))}>Sign in</button>{message && <span className="auth-note" role="status">{message}</span>}</div>
}

export function HeaderMenu() {
  const menuRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    function closeWhenOutside(event: PointerEvent) {
      const menu = menuRef.current
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      const menu = menuRef.current
      if (event.key === 'Escape' && menu?.open) {
        menu.open = false
        menu.querySelector('summary')?.focus()
      }
    }

    document.addEventListener('pointerdown', closeWhenOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeWhenOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  return <details className="header-menu" ref={menuRef}><summary aria-label="Open menu"><Menu size={18} /><span>Menu</span></summary><nav aria-label="Page menu"><Suspense fallback={null}><LazyDashboardMenuLink /></Suspense><a href="/settings/theme">Theme</a><a href="/#events">Events</a><a href="/">Discover</a></nav></details>
}

const LazyProfileSwitcher = lazy(() => import('./profile-context').then((module) => ({ default: module.ProfileSwitcher })))
const LazyDashboardMenuLink = lazy(() => import('./profile-context').then((module) => ({ default: module.DashboardMenuLink })))
export function ProfileSwitcher() { return <div className="profile-context-slot"><Suspense fallback={null}><LazyProfileSwitcher /></Suspense></div> }

export function SiteHeader() {
  return <header className="topbar"><a className="brand" href="/" aria-label="Open Mic home"><span className="brand-mark"><Sparkles size={17} /></span><span>open mic</span></a><HeaderMenu /><ProfileSwitcher /><SignInButton /></header>
}
