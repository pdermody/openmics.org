import { useEffect, useRef } from 'react'

// Shared by any <details>-based popover/menu (the page HeaderMenu, and the roster page's
// per-card hamburger menus): closes the element when the user clicks outside it or presses
// Escape, matching native menu/dropdown dismiss behavior since we use plain <details> rather
// than a dedicated popover library.
export function useDismissableDetails<T extends HTMLDetailsElement = HTMLDetailsElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    function closeWhenOutside(event: PointerEvent) {
      const menu = ref.current
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      const menu = ref.current
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

  return ref
}

// For plain absolutely-positioned popups (not <details>-based), e.g. the roster page's
// registration-details tooltip: closes it on outside click or Escape, same semantics as
// useDismissableDetails but driven by external open/close state instead of the native
// <details> "open" attribute.
export function useDismissOnOutsideOrEscape<T extends HTMLElement = HTMLDivElement>(active: boolean, onDismiss: () => void) {
  const ref = useRef<T>(null)

  useEffect(() => {
    if (!active) return
    function onPointerDown(event: PointerEvent) {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) onDismiss()
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismiss()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [active, onDismiss])

  return ref
}
