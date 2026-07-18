import { useEffect, useState } from 'react'
import { AdminDashboard } from './AdminDashboard'
import type { Account, DemoState } from './domain'
import { LoginPage } from './LoginPage'
import { StudentDashboard } from './StudentDashboard'
import { TeacherDashboard } from './TeacherDashboard'
import {
  clearSession,
  loadDemoState,
  loadSession,
  resetDemoState,
  saveDemoState,
  saveSession,
} from './storage'

export default function App() {
  const [state, setState] = useState<DemoState>(loadDemoState)
  const [session, setSession] = useState(loadSession)

  useEffect(() => {
    saveDemoState(state)
  }, [state])

  const account = session ? state.accounts.find((item) => item.id === session.accountId) : undefined

  function login(nextAccount: Account) {
    const nextSession = { accountId: nextAccount.id, role: nextAccount.role }
    saveSession(nextSession)
    setSession(nextSession)
  }

  function logout() {
    clearSession()
    setSession(null)
  }

  function resetDemo() {
    const confirmed = window.confirm('ยืนยันคืนค่าข้อมูลสาธิตทั้งหมดในเบราว์เซอร์นี้?')
    if (!confirmed) return
    setState(resetDemoState())
  }

  if (!account) return <LoginPage state={state} onLogin={login} />

  if (account.role === 'student') {
    return <StudentDashboard account={account} state={state} onChange={setState} onLogout={logout} />
  }

  if (account.role === 'teacher') {
    return <TeacherDashboard account={account} state={state} onChange={setState} onLogout={logout} />
  }

  return <AdminDashboard account={account} state={state} onChange={setState} onResetDemo={resetDemo} onLogout={logout} />
}
