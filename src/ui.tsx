import type { ReactNode } from 'react'
import type { Account, DemoState, Severity } from './domain'
import { ProfileAvatar } from './ProfileAvatar'
import { dataMode } from './supabaseClient'

export type IconName =
  | 'home'
  | 'score'
  | 'users'
  | 'history'
  | 'approval'
  | 'shield'
  | 'settings'
  | 'logout'
  | 'alert'
  | 'check'
  | 'plus'
  | 'book'
  | 'eye'
  | 'eyeOff'
  | 'upload'

const paths: Record<IconName, ReactNode> = {
  home: <path d="M3 11.5 12 4l9 7.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-8Z M9 21v-6h6v6" />,
  score: <path d="M8 3h8l2 3h3v15H3V6h3l2-3Z M8 11h8M8 15h5" />,
  users: <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
  history: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />,
  approval: <path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10ZM9 12l2 2 4-4" />,
  settings: <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2.3v-4h.1A1.7 1.7 0 0 0 4.1 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.5 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2.3h4v.1A1.7 1.7 0 0 0 15 4.1a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.5a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1A1.7 1.7 0 0 0 19.4 15Z" />,
  logout: <path d="M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-6" />,
  alert: <path d="M12 9v4M12 17h.01M10.3 3.7 2.4 18a2 2 0 0 0 1.75 3h15.7a2 2 0 0 0 1.75-3L13.7 3.7a2 2 0 0 0-3.4 0Z" />,
  check: <path d="m5 12 4 4L19 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  book: <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5V5a2 2 0 0 1 2-2h14v18H6.5A2.5 2.5 0 0 1 4 18.5Z" />,
  eye: <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />,
  eyeOff: <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17.3 17.3 0 0 1-2.1 3.1M6.6 6.6C3.6 8.5 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.1-.9" />,
  upload: <path d="M12 16V4M7 9l5-5 5 5M5 15v5h14v-5" />,
}

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

export function DemoBanner() {
  if (dataMode !== 'demo') return null
  return (
    <div className="demo-banner" role="status">
      <span className="demo-dot" />
      โหมดสาธิต — ใช้ข้อมูลสมมติเท่านั้น ยังไม่เชื่อมฐานข้อมูลจริง
    </div>
  )
}

export interface NavItem<T extends string> {
  id: T
  label: string
  icon: IconName
  count?: number
}

interface AppShellProps<T extends string> {
  account: Account
  state: DemoState
  items: NavItem<T>[]
  active: T
  onNavigate: (id: T) => void
  onLogout: () => void
  children: ReactNode
}

const roleLabels = {
  student: 'นักเรียน',
  teacher: 'คุณครู',
  admin: 'ผู้ดูแลระบบ',
}

export function AppShell<T extends string>({
  account,
  state,
  items,
  active,
  onNavigate,
  onLogout,
  children,
}: AppShellProps<T>) {
  return (
    <div className="app-root">
      <a className="skip-link" href="#main-content">ข้ามไปยังเนื้อหา</a>
      <DemoBanner />
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">SP</div>
        <div className="brand-copy">
          <strong>School Point</strong>
          <span>ระบบคะแนนความประพฤติ</span>
        </div>
        <div className="topbar-actions">
          <div className="term-chip">{state.term.label}</div>
          <button className="topbar-logout" type="button" onClick={onLogout}>
            <Icon name="logout" size={18} />
            <span>ออกจากระบบ</span>
          </button>
        </div>
      </header>
      <div className="app-layout">
        <aside className="sidebar" aria-label="เมนูหลัก">
          <div className="profile-block">
            <ProfileAvatar account={account} />
            <div>
              <strong>{account.displayName}</strong>
              <span>{roleLabels[account.role]}</span>
            </div>
          </div>
          <nav className="nav-list">
            {items.map((item) => (
              <button
                key={item.id}
                className={active === item.id ? 'nav-item active' : 'nav-item'}
                onClick={() => onNavigate(item.id)}
                aria-current={active === item.id ? 'page' : undefined}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {item.count ? <b className="nav-count">{item.count}</b> : null}
              </button>
            ))}
          </nav>
          <button className="nav-item logout" onClick={onLogout}>
            <Icon name="logout" />
            <span>ออกจากระบบ</span>
          </button>
        </aside>
        <main id="main-content" className="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
      <nav className="mobile-nav" aria-label="เมนูมือถือ">
        {items.slice(0, 4).map((item) => (
          <button
            key={item.id}
            className={active === item.id ? 'active' : ''}
            onClick={() => onNavigate(item.id)}
            aria-label={item.label}
          >
            <Icon name={item.icon} size={19} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

export function StatusBadge({ severity }: { severity: Severity }) {
  const labels: Record<Severity, string> = {
    low: 'เล็กน้อย',
    medium: 'ปานกลาง',
    serious: 'ร้ายแรง',
    critical: 'วิกฤต',
  }
  return <span className={`badge severity-${severity}`}>{labels[severity]}</span>
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name="check" size={24} /></div>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  )
}
