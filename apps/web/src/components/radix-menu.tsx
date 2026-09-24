import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'

export function MenuRoot({ children }: { children: ReactNode }) {
  return <DropdownMenuPrimitive.Root>{children}</DropdownMenuPrimitive.Root>
}

export function MenuTrigger({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return <DropdownMenuPrimitive.Trigger asChild><button type="button" className={className} aria-label={label}>{children}</button></DropdownMenuPrimitive.Trigger>
}

export function MenuContent({ children, className = '', align = 'end' }: { children: ReactNode; className?: string; align?: 'start' | 'center' | 'end' }) {
  return <DropdownMenuPrimitive.Portal><DropdownMenuPrimitive.Content align={align} collisionPadding={12} className={`radix-menu-content ${className}`}>{children}</DropdownMenuPrimitive.Content></DropdownMenuPrimitive.Portal>
}

export function MenuItem({ children, onSelect, disabled = false, className = '', closeOnSelect = true }: { children: ReactNode; onSelect: () => void; disabled?: boolean; className?: string; closeOnSelect?: boolean }) {
  return <DropdownMenuPrimitive.Item className={`radix-menu-item ${className}`} disabled={disabled} onSelect={(event) => { if (!closeOnSelect) event.preventDefault(); onSelect() }}>{children}</DropdownMenuPrimitive.Item>
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <DropdownMenuPrimitive.Label className="radix-menu-label">{children}</DropdownMenuPrimitive.Label>
}

export function MenuSeparator() {
  return <DropdownMenuPrimitive.Separator className="radix-menu-separator" />
}
