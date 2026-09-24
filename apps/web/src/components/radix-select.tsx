import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'

export type SelectOption = { value: string; label: string }

// Shared by any page needing a themed dropdown (as opposed to a native <select>, which can't
// pick up the app's CSS custom properties consistently across browsers). Portals into the
// themed `.app` root — not document.body — so the popover content stays in scope of the
// current theme/mode's CSS custom properties (see Modal in views/shared.tsx for the same reasoning).
export function Select({ value, onValueChange, options, placeholder, ariaLabel, id, name, required, disabled }: {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  ariaLabel?: string
  id?: string
  name?: string
  required?: boolean
  disabled?: boolean
}) {
  return <SelectPrimitive.Root value={value} onValueChange={onValueChange} name={name} required={required} disabled={disabled}>
    <SelectPrimitive.Trigger id={id} className="select-trigger" aria-label={ariaLabel}>
      <SelectPrimitive.Value placeholder={placeholder} />
      <SelectPrimitive.Icon className="select-icon"><ChevronDown size={16} /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
    <SelectPrimitive.Portal container={document.querySelector('.app')}>
      <SelectPrimitive.Content className="select-content" position="popper" sideOffset={6}>
        <SelectPrimitive.Viewport>
          {options.map((option) => <SelectPrimitive.Item key={option.value} value={option.value} className="select-item">
            <SelectPrimitive.ItemIndicator className="select-indicator"><Check size={14} /></SelectPrimitive.ItemIndicator>
            <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
          </SelectPrimitive.Item>)}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  </SelectPrimitive.Root>
}
