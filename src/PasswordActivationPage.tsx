import { useState, type FormEvent } from 'react'
import { Icon } from './ui'

interface PasswordActivationPageProps {
  username: string
  onSetPassword: (password: string) => Promise<void>
  onLogout: () => void
}

export function validatePersonalPassword(password: string): string | null {
  if (password.length < 10) return 'รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร'
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'รหัสผ่านต้องมีทั้งตัวอักษรภาษาอังกฤษและตัวเลข'
  }
  return null
}

export function PasswordActivationPage({ username, onSetPassword, onLogout }: PasswordActivationPageProps) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = validatePersonalPassword(password)
    if (validationError) {
      setError(validationError)
      return
    }
    if (password !== confirmation) {
      setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน')
      return
    }
    setBusy(true)
    setError('')
    try {
      await onSetPassword(password)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'ไม่สามารถตั้งรหัสผ่านได้')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="status-page activation-page">
      <section className="status-card activation-card" aria-labelledby="activation-title">
        <div className="brand-mark">SP</div>
        <p className="eyebrow">เปิดใช้งานบัญชีครั้งแรก</p>
        <h1 id="activation-title">ตั้งรหัสผ่านส่วนตัว</h1>
        <p>
          บัญชี <strong>{username}</strong> เข้าสู่ระบบด้วยรหัสชั่วคราวแล้ว กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งานระบบ
        </p>
        <form className="login-form" onSubmit={submit}>
          <label>
            รหัสผ่านใหม่
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
            />
          </label>
          <label>
            ยืนยันรหัสผ่านใหม่
            <input
              type="password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
            />
          </label>
          <div className="activation-hint">
            <Icon name="shield" />
            <span>อย่างน้อย 10 ตัวอักษร และมีทั้งตัวอักษรภาษาอังกฤษกับตัวเลข</span>
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button primary full" type="submit" disabled={busy}>
            {busy ? 'กำลังบันทึก…' : 'ตั้งรหัสผ่านและเข้าสู่ระบบ'}
          </button>
          <button className="button ghost full" type="button" onClick={onLogout} disabled={busy}>ออกจากระบบ</button>
        </form>
      </section>
    </main>
  )
}
