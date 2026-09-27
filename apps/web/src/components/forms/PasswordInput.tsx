import { useState, type InputHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  fieldLabel: string
}

export function PasswordInput({ fieldLabel, ...inputProps }: PasswordInputProps) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const toggleLabel = t(visible ? 'hidePasswordField' : 'showPasswordField', { field: fieldLabel })

  return <span className="password-input-control">
    <input {...inputProps} type={visible ? 'text' : 'password'} />
    <button
      type="button"
      className="password-input-toggle"
      aria-label={toggleLabel}
      title={toggleLabel}
      aria-pressed={visible}
      onClick={() => setVisible((current) => !current)}
    >
      {visible ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
    </button>
  </span>
}