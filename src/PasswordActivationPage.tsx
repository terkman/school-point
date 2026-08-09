import { useState, type FormEvent } from 'react'
import { PasswordInput } from './PasswordInput'
import { Icon } from './ui'
import { brand } from './brand'

export const ONE_TIME_ACTIVATION_COPY = 'ยืนยันด้วยรหัสเปิดใช้ครั้งเดียวหรือรหัสกู้บัญชีแล้ว'

interface PasswordActivationPageProps {
  username: string
  onSetPassword: (password: string) => Promise<void>
  onResumeActivation?: () => Promise<void>
  passwordAuthenticated?: boolean
  initialError?: string
  onLogout: () => void
}

export function validatePersonalPassword(password: string): string | null {
  if (password.length < 10) return 'รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร'
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'รหัสผ่านต้องมีทั้งตัวอักษรภาษาอังกฤษและตัวเลข'
  }
  return null
}

export function PasswordActivationPage({
  username,
  onSetPassword,
  onResumeActivation,
  passwordAuthenticated = false,
  initialError = '',
  onLogout,
}: PasswordActivationPageProps) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState(initialError)
  const [busy, setBusy] = useState(false)
  const canResume = passwordAuthenticated && Boolean(onResumeActivation)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canResume) {
      const validationError = validatePersonalPassword(password)
      if (validationError) {
        setError(validationError)
        return
      }
      if (password !== confirmation) {
        setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน')
        return
      }
    }
    setBusy(true)
    setError('')
    try {
      if (canResume) {
        await onResumeActivation?.()
      } else {
        await onSetPassword(password)
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'ไม่สามารถเปิดใช้บัญชีได้')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="status-page activation-page">
      <section className="status-card activation-card" aria-labelledby="activation-title">
        <div className="brand-mark">{brand.shortMark}</div>
        <p className="eyebrow">{canResume ? 'ดำเนินการตั้งค่าบัญชีต่อ' : 'ยืนยันตัวตนสำเร็จ'}</p>
        <h1 id="activation-title">{canResume ? 'ยืนยันการเปิดใช้บัญชี' : 'ตั้งรหัสผ่านส่วนตัว'}</h1>
        <p>
          {canResume ? (
            <>บัญชี <strong>{username}</strong> เข้าสู่ระบบด้วยรหัสผ่านส่วนตัวแล้ว กรุณาดำเนินการยืนยันบัญชีให้เสร็จสมบูรณ์</>
          ) : (
            <>บัญชี <strong>{username}</strong> {ONE_TIME_ACTIVATION_COPY} กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งานระบบ</>
          )}
        </p>
        <form className="login-form" onSubmit={submit}>
          {canResume ? null : (
            <>
              <PasswordInput
                label="รหัสผ่านใหม่"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={10}
                required
                disabled={busy}
              />
              <PasswordInput
                label="ยืนยันรหัสผ่านใหม่"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="new-password"
                minLength={10}
                required
                disabled={busy}
              />
              <div className="activation-hint">
                <Icon name="shield" />
                <span>อย่างน้อย 10 ตัวอักษร และมีทั้งตัวอักษรภาษาอังกฤษกับตัวเลข</span>
              </div>
            </>
          )}
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button primary full" type="submit" disabled={busy}>
            {busy ? (canResume ? 'กำลังยืนยัน…' : 'กำลังบันทึก…') : (canResume ? 'ยืนยันและเข้าสู่ระบบ' : 'ตั้งรหัสผ่านและเข้าสู่ระบบ')}
          </button>
          <button className="button ghost full" type="button" onClick={onLogout} disabled={busy}>ออกจากระบบ</button>
        </form>
      </section>
    </main>
  )
}
