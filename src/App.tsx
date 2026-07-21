import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { AdminDashboard } from './AdminDashboard'
import type { Account, DemoState } from './domain'
import { LoginPage } from './LoginPage'
import { PasswordActivationPage } from './PasswordActivationPage'
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
import { dataMode, getSupabaseClient, usernameToInternalEmail } from './supabaseClient'
import { createSupabaseActions, getSessionUsername, loadSupabaseState } from './supabaseData'

function DemoApp() {
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

function StatusPage({ title, detail, action }: { title: string; detail: string; action?: { label: string; run: () => void } }) {
  return (
    <main className="status-page">
      <section className="status-card" aria-live="polite">
        <div className="brand-mark">SP</div>
        <h1>{title}</h1>
        <p>{detail}</p>
        {action ? <button className="button primary" type="button" onClick={action.run}>{action.label}</button> : null}
      </section>
    </main>
  )
}

function SupabaseApp({ client }: { client: SupabaseClient }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [state, setState] = useState<DemoState | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [activationRequired, setActivationRequired] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    if (!session?.user) {
      setActivationRequired(undefined)
      return
    }
    let active = true
    setActivationRequired(undefined)
    setLoadError('')
    void client
      .from('profiles')
      .select('activation_required')
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          setLoadError(`ตรวจสถานะเปิดใช้บัญชีไม่ได้: ${error.message}`)
          return
        }
        if (!data) {
          setLoadError('ไม่พบข้อมูลบัญชีโรงเรียน โปรดติดต่อผู้ดูแลระบบ')
          return
        }
        setActivationRequired(data.activation_required === true)
      })
    return () => {
      active = false
    }
  }, [client, session?.user])

  useEffect(() => {
    let active = true
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) {
        setLoadError(error.message)
        setSession(null)
        return
      }
      setSession(data.session)
    })
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (active) setSession(nextSession)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [client])

  const refresh = useCallback(async () => {
    if (!session?.user || activationRequired !== false) return
    const nextState = await loadSupabaseState(client, session.user)
    setState(nextState)
    setLoadError('')
  }, [activationRequired, client, session?.user])

  useEffect(() => {
    if (!session?.user || activationRequired !== false) {
      setState(null)
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setLoadError('')
    void loadSupabaseState(client, session.user)
      .then((nextState) => {
        if (active) setState(nextState)
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : 'ไม่สามารถโหลดข้อมูลได้')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [activationRequired, client, session?.user])

  const actions = useMemo(() => createSupabaseActions(client, refresh), [client, refresh])

  async function authenticate(username: string, password: string) {
    const email = usernameToInternalEmail(username)
    const { data, error } = await client.auth.signInWithPassword({ email, password })
    if (error) {
      if (error.message.toLowerCase().includes('invalid login credentials')) {
        throw new Error('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
      }
      throw new Error(error.message)
    }
    setSession(data.session)
  }

  async function activate(username: string, activationCode: string) {
    const email = usernameToInternalEmail(username)
    const { data, error } = await client.auth.verifyOtp({ email, token: activationCode.trim(), type: 'magiclink' })
    if (error || !data.session) throw new Error('รหัสเปิดใช้ไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว')
    setSession(data.session)
  }

  async function logout() {
    const { error } = await client.auth.signOut()
    if (error) {
      setLoadError(error.message)
      return
    }
    setSession(null)
    setState(null)
  }

  async function setPersonalPassword(password: string) {
    const { data, error } = await client.auth.updateUser({
      password,
      data: { must_change_password: false },
    })
    if (error) throw new Error(error.message)
    const { data: activation, error: activationError } = await client
      .from('profiles')
      .select('activation_required')
      .eq('user_id', data.user.id)
      .maybeSingle()
    if (activationError || !activation || activation.activation_required === true) {
      throw new Error('ตั้งรหัสผ่านแล้ว แต่ระบบยังยืนยันการเปิดใช้ไม่สำเร็จ โปรดติดต่อผู้ดูแลระบบ')
    }
    setSession((current) => current ? { ...current, user: data.user } : current)
    setActivationRequired(false)
  }

  if (session === undefined) return <StatusPage title="กำลังตรวจสอบการเข้าสู่ระบบ" detail="กรุณารอสักครู่" />
  if (!session) return <LoginPage mode="supabase" onAuthenticate={authenticate} onActivate={activate} />
  if (activationRequired === undefined) {
    return <StatusPage title={loadError ? 'ยังเปิดระบบไม่ได้' : 'กำลังตรวจสอบบัญชี'} detail={loadError || 'กรุณารอสักครู่'} />
  }
  if (activationRequired) {
    return (
      <PasswordActivationPage
        username={getSessionUsername(session.user)}
        onSetPassword={setPersonalPassword}
        onLogout={() => void logout()}
      />
    )
  }
  if (loading && !state) return <StatusPage title="กำลังโหลดข้อมูลโรงเรียน" detail="ระบบกำลังตรวจสอบสิทธิ์และเตรียมข้อมูลตามบทบาทของคุณ" />
  if (loadError && !state) {
    return <StatusPage title="ยังเปิดระบบไม่ได้" detail={loadError} action={{ label: 'ลองโหลดใหม่', run: () => void refresh().catch((error: unknown) => setLoadError(error instanceof Error ? error.message : 'ไม่สามารถโหลดข้อมูลได้')) }} />
  }
  const account = state?.accounts[0]
  if (!state || !account) return <StatusPage title="ไม่พบข้อมูลบัญชี" detail="โปรดติดต่อผู้ดูแลระบบเพื่อตรวจสอบการผูกบัญชีกับข้อมูลโรงเรียน" />

  if (account.role === 'student') {
    return <StudentDashboard account={account} state={state} onChange={setState} actions={actions} onLogout={() => void logout()} />
  }
  if (account.role === 'teacher') {
    return <TeacherDashboard account={account} state={state} onChange={setState} actions={actions} onLogout={() => void logout()} />
  }
  return <AdminDashboard account={account} state={state} onChange={setState} actions={actions} onLogout={() => void logout()} />
}

function SupabaseRoot() {
  try {
    return <SupabaseApp client={getSupabaseClient()} />
  } catch (error) {
    return <StatusPage title="ยังไม่ได้ตั้งค่า Supabase" detail={error instanceof Error ? error.message : 'ตรวจสอบ Environment Variables ของเว็บไซต์'} />
  }
}

export default function App() {
  return dataMode === 'supabase' ? <SupabaseRoot /> : <DemoApp />
}
