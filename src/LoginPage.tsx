import { useState, type FormEvent } from 'react'
import type { Account, DemoState, Role } from './domain'
import { DemoBanner, Icon } from './ui'

interface LoginPageProps {
  state: DemoState
  onLogin: (account: Account) => void
}

const demos: Array<{ role: Role; label: string; username: string }> = [
  { role: 'student', label: 'นักเรียน', username: '69001' },
  { role: 'teacher', label: 'คุณครู', username: 'teacher.demo' },
  { role: 'admin', label: 'ผู้ดูแลระบบ', username: 'admin.demo' },
]

export function LoginPage({ state, onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('69001')
  const [password, setPassword] = useState('demo1234')
  const [error, setError] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const account = state.accounts.find(
      (item) => item.username.toLowerCase() === username.trim().toLowerCase() && item.password === password,
    )
    if (!account) {
      setError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
      return
    }
    setError('')
    onLogin(account)
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
            <h2 id="login-title">เข้าสู่ระบบ</h2>
            <p>เลือกบัญชีตัวอย่างหรือกรอกข้อมูลด้านล่าง</p>
          </div>
          <div className="demo-accounts" aria-label="เลือกบัญชีสาธิต">
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
          </div>
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
            <label>
              รหัสผ่าน
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <button className="button primary full" type="submit">เข้าสู่ระบบ</button>
          </form>
          <div className="login-note">
            <Icon name="alert" />
            <p><strong>ระบบจริงจะไม่ใช้วันเกิดเป็นรหัสผ่านถาวร</strong><br />ผู้ใช้จะได้รับรหัสเปิดใช้งานครั้งเดียว แล้วตั้งรหัสผ่านส่วนตัวด้วยตนเอง</p>
          </div>
        </section>
      </div>
    </div>
  )
}
