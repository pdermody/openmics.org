// A minimal client-side router shim: App.tsx renders purely off `window.location.pathname`,
// so without this, every internal <a href> click would fall through to the browser's default
// full-page navigation instead of a same-page re-render.
type Listener = () => void
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((listener) => listener())
}

/** Pushes a new URL and re-renders the app in place, instead of a full browser navigation. */
export function navigate(path: string) {
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (path === current) return
  window.history.pushState(null, '', path)
  emit()
}

/** useSyncExternalStore subscribe function: reacts to both back/forward and navigate(). */
export function subscribeToLocation(listener: Listener): () => void {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

export function getCurrentPath(): string {
  return window.location.pathname
}

// Delegated on `document` (rather than one handler per <a>) so every existing/future internal
// link in the app is covered for free. Only plain left-clicks on same-origin, same-tab links are
// intercepted — modified clicks, new-tab targets, downloads, and external/hash/mailto/tel links
// are left to the browser's normal handling.
export function installLinkInterceptor() {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const anchor = (event.target as HTMLElement).closest('a')
    if (!anchor || !anchor.href) return
    if (anchor.target && anchor.target !== '_self') return
    if (anchor.hasAttribute('download')) return
    const href = anchor.getAttribute('href') ?? ''
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return
    const url = new URL(anchor.href, window.location.origin)
    if (url.origin !== window.location.origin) return
    event.preventDefault()
    navigate(`${url.pathname}${url.search}${url.hash}`)
  })
}
