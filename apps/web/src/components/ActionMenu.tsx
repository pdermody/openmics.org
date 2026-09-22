import { MoreVertical } from 'lucide-react'
import type { ReactNode } from 'react'
import { MenuContent, MenuItem, MenuRoot, MenuTrigger } from './radix-menu'

export type ActionMenuItem = {
  label: string
  icon?: ReactNode
  onClick: () => void
  disabled?: boolean
}

export function ActionMenu({ label, items }: { label: string; items: ActionMenuItem[] }) {
  return <MenuRoot>
    <MenuTrigger className="performer-card-arrow" label={label}><MoreVertical size={18} /></MenuTrigger>
    <MenuContent align="end">
      {items.map((item) => <MenuItem key={item.label} disabled={item.disabled} onSelect={item.onClick}>{item.icon}{item.label}</MenuItem>)}
    </MenuContent>
  </MenuRoot>
}
