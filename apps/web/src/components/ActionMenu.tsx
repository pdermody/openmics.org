import { MoreVertical } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDismissOnOutsideOrEscape } from '../hooks/dismissable'

export type ActionMenuItem = {
  label: string
  icon?: ReactNode
  onClick: () => void
  disabled?: boolean
}

export function ActionMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useDismissOnOutsideOrEscape<HTMLDivElement>(open, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  useEffect(() => {
    if (!open || !buttonRef.current || !panelRef.current) return
    const margin = 8
    const button = buttonRef.current.getBoundingClientRect()
    const panel = panelRef.current.getBoundingClientRect()
    const top = button.bottom + panel.height > window.innerHeight - margin
      ? Math.max(margin, button.top - panel.height - 4)
      : button.bottom + 4
    const left = Math.max(margin, Math.min(button.right - panel.width, window.innerWidth - panel.width - margin))
    setPosition({ top, left })
  }, [open, items.length])

  function toggle() {
    if (!open && buttonRef.current) {
      const button = buttonRef.current.getBoundingClientRect()
      setPosition({ top: button.bottom + 4, left: Math.max(8, button.right - 190) })
    }
    setOpen((value) => !value)
  }

  return <>
    <button type="button" ref={buttonRef} className="performer-card-arrow" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
      <MoreVertical size={18} />
    </button>
    {open && position && createPortal(
      <div className="performer-card-menu-panel" ref={panelRef} role="menu" style={{ top: position.top, left: position.left }}>
        {items.map((item) => <button key={item.label} type="button" role="menuitem" disabled={item.disabled} onClick={() => { setOpen(false); item.onClick() }}>{item.icon}{item.label}</button>)}
      </div>,
      document.querySelector('.app') ?? document.body,
    )}
  </>
}
