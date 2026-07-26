import { useState, type ChangeEvent } from 'react'
import { Icon } from './ui'

interface PasswordInputProps {
  label: string
  value: string
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  autoComplete: 'current-password' | 'new-password'
  minLength?: number
  required?: boolean
  disabled?: boolean
}

export function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  required = false,
  disabled = false,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <label>
      {label}
      <span className="password-input-wrap">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          minLength={minLength}
          required={required}
          disabled={disabled}
        />
        <button
          type="button"
          className="password-visibility-button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? `ซ่อน${label}` : `แสดง${label}`}
          aria-pressed={visible}
          disabled={disabled}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} size={19} />
        </button>
      </span>
    </label>
  )
}
