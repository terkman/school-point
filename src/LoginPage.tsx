import { useState, type FormEvent } from 'react'
import type { Account, DemoState, Role } from './domain'
import { PasswordInput } from './PasswordInput'
import { DemoBanner, Icon } from './ui'

interface LoginPageProps {
  state?: DemoState
  mode?: 'demo' | 'supabase'
  onLogin?: (account: Account) => void
  onAuthenticate?: (username: string, password: string) => Promise<void>
  onActivate?: (username: string, activationCode: string) => Promise<void>
}

const demos: Array<{ role: Role; label: string; username: string }> = [
  { role: 'student', label: 'นักเรียน', username: '69001' },
  { role: 'teacher', label: 'คุณครู', username: 'teacher.demo' },
  { role: 'admin', label: 'ผู้ดูแลระบบ', username: 'admin.demo' },
]

export function LoginPage({ state, mode = 'demo', onLogin, onAuthenticate, onActivate }: LoginPageProps) {
  const isDemo = mode === 'demo'
  const [username, setUsername] = useState(isDemo ? '69001' : '')
  const [password, setPassword] = useState(isDemo ? 'demo1234' : '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [activationMode, setActivationMode] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!isDemo) {
      const handler = activationMode ? onActivate : onAuthenticate
      if (!handler) return
      setBusy(true)
      setError('')
      try {
        await handler(username, password)
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : 'ไม่สามารถเข้าสู่ระบบได้')
      } finally {
        setBusy(false)
      }
      return
    }
    const account = state?.accounts.find(
      (item) => item.username.toLowerCase() === username.trim().toLowerCase() && item.password === password,
    )
    if (!account) {
      setError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
      return
    }
    setError('')
    onLogin?.(account)
  }

  function chooseDemo(nextUsername: string) {
    setUsername(nextUsername)
    setPassword('demo1234')
    setError('')
  }

  return (
    <div className="login-page">
      <DemoBanner />
      <div className="login-layout">
        <section className="login-intro" aria-labelledby="product-title">
          <div className="login-brand"><span>SP</span> School Point</div>
          <div>
            <p className="eyebrow">ระบบดูแลวินัยเชิงสร้างสรรค์</p>
            <h1 id="product-title">คะแนนที่ตรวจสอบได้<br />การดูแลที่เป็นธรรม</h1>
            <p className="intro-copy">
              บันทึกคะแนนตามระเบียบ ติดตามการปรับพฤติกรรม และเปิดทางให้นักเรียนอุทธรณ์อย่างโปร่งใส
            </p>
          </div>
          <ul className="login-benefits">
            <li><Icon name="shield" /> สิทธิ์แยกตามนักเรียน ห้องเรียน และผู้ดูแลระบบ</li>
            <li><Icon name="history" /> ทุกการเปลี่ยนคะแนนมีประวัติตรวจสอบย้อนหลัง</li>
            <li><Icon name="book" /> รองรับมาตรการติดตามต่อเนื่องข้ามภาคเรียน</li>
          </ul>
        </section>
        <section className="login-panel" aria-labelledby="login-title">
          <div className="login-heading">
            <p className="eyebrow">ยินดีต้อนรับ</p>
            <h2 id="login-title">{activationMode ? 'เปิดใช้บัญชีครั้งแรก' : 'เข้าสู่ระบบ'}</h2>
            <p>{isDemo ? 'เลือกบัญชีตัวอย่างหรือกรอกข้อมูลด้านล่าง' : activationMode ? 'กรอกชื่อผู้ใช้และรหัสเปิดใช้ครั้งเดียวที่ได้รับจากโรงเรียน' : 'กรอกชื่อผู้ใช้และรหัสผ่านของคุณ'}</p>
          </div>
          {isDemo ? <div className="demo-accounts" aria-label="เลือกบัญชีสาธิต">
            {demos.map((demo) => (
              <button
                key={demo.role}
                className={username === demo.username ? 'demo-account selected' : 'demo-account'}
                onClick={() => chooseDemo(demo.username)}
                type="button"
              >
                <Icon name={demo.role === 'student' ? 'score' : demo.role === 'teacher' ? 'users' : 'shield'} />
                <span>{demo.label}<small>{demo.username}</small></span>
              </button>
            ))}
          </div> : null}
          <form className="login-form" onSubmit={submit}>
            <label>
              ชื่อผู้ใช้ / รหัสนักเรียน
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                required
              />
            </label>
            {activationMode ? (
              <label>
                รหัสเปิดใช้ครั้งเดียว
                <input
                  type="text"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  required
                />
              </label>
            ) : (
              <PasswordInput
                label="รหัสผ่าน"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                disabled={busy}
              />
            )}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <button className="button primary full" type="submit" disabled={busy}>{busy ? 'กำลังตรวจสอบ…' : activationMode ? 'ตรวจรหัสและตั้งรหัสผ่าน' : 'เข้าสู่ระบบ'}</button>
            {!isDemo ? (
              <button
                className="button ghost full"
                type="button"
                disabled={busy}
                onClick={() => {
                  setActivationMode((value) => !value)
                  setPassword('')
                  setError('')
                }}
              >
                {activationMode ? 'กลับไปเข้าสู่ระบบปกติ' : 'เปิดใช้บัญชีครั้งแรก'}
              </button>
            ) : null}
          </form>
          <div className="login-note">
            <Icon name="alert" />
            <p><strong>ระบบไม่ใช้วันเกิดเป็นรหัสผ่านถาวร</strong><br />รหัสเปิดใช้มีอายุจำกัดและใช้ได้ครั้งเดียว จากนั้นผู้ใช้ต้องตั้งรหัสผ่านส่วนตัว</p>
          </div>
        </section>
      </div>
    </div>
  )
}
