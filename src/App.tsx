import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import type { Account, DemoState } from './domain'
import {
  completeFirstPasswordActivation,
  completePasswordAuthenticatedActivation,
  sessionHasPasswordAuthentication,
} from './firstPasswordActivation'
import { LoginPage } from './LoginPage'
import { PasswordActivationPage } from './PasswordActivationPage'
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
import { sessionUserId } from './authSession'
import { brand } from './brand'
import { routeAfterRoleChange } from './adminRoute'
import { currentLogicalBrowserRoute, replaceLogicalBrowserRoute } from './browserRoute'

const AdminDashboard = lazy(() => import('./AdminDashboard').then((module) => ({ default: module.AdminDashboard })))
const DirectorDashboard = lazy(() => import('./DirectorDashboard').then((module) => ({ default: module.DirectorDashboard })))
const StudentDashboard = lazy(() => import('./StudentDashboard').then((module) => ({ default: module.StudentDashboard })))
const TeacherDashboard = lazy(() => import('./TeacherDashboard').then((module) => ({ default: module.TeacherDashboard })))

class DashboardErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // The fallback below is intentionally user-facing; details are available in browser diagnostics.
  }

  render() {
    if (this.state.error) {
      return <StatusPage title="เปิดหน้าตามบทบาทไม่สำเร็จ" detail="ลองโหลดหน้าใหม่อีกครั้ง หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ" action={{ label: 'โหลดหน้าใหม่', run: () => window.location.reload() }} />
    }
    return this.props.children
  }
}

function RoleDashboard({ children, syncWarning }: { children: ReactNode; syncWarning?: string }) {
  return (
    <DashboardErrorBoundary>
      {syncWarning ? <div className="warning-note" role="status"><span>บันทึกข้อมูลสำเร็จแล้ว แต่ยังโหลดข้อมูลล่าสุดไม่สำเร็จ: {syncWarning}</span></div> : null}
      <Suspense fallback={<StatusPage title="กำลังเปิดหน้าของคุณ" detail="กำลังเตรียมเครื่องมือที่ตรงกับบทบาทของคุณ" />}>
        {children}
      </Suspense>
    </DashboardErrorBoundary>
  )
}

function alignBrowserRouteWithRole(role: Account['role']) {
  if (typeof window === 'undefined') return
  const currentRoute = currentLogicalBrowserRoute()
  const nextHref = routeAfterRoleChange(currentRoute.pathname, role)
  if (nextHref) replaceLogicalBrowserRoute(nextHref)
}

function DemoApp() {
  const [state, setState] = useState<DemoState>(loadDemoState)
  const [session, setSession] = useState(loadSession)
  const restoredSessionRoutePendingRef = useRef(session !== null)

  useEffect(() => {
    saveDemoState(state)
  }, [state])

  const account = session ? state.accounts.find((item) => item.id === session.accountId) : undefined

  useEffect(() => {
    if (!restoredSessionRoutePendingRef.current || !account) return
    alignBrowserRouteWithRole(account.role)
    restoredSessionRoutePendingRef.current = false
  }, [account])

  function login(nextAccount: Account) {
    const nextSession = { accountId: nextAccount.id, role: nextAccount.role }
    alignBrowserRouteWithRole(nextAccount.role)
    saveSession(nextSession)
    setSession(nextSession)
  }

  function logout() {
    replaceLogicalBrowserRoute('/')
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
    return <RoleDashboard><StudentDashboard account={account} state={state} onChange={setState} onLogout={logout} /></RoleDashboard>
  }

  if (account.role === 'teacher') {
    return <RoleDashboard><TeacherDashboard account={account} state={state} onChange={setState} onLogout={logout} /></RoleDashboard>
  }
  if (account.role === 'director') {
    return <RoleDashboard><DirectorDashboard account={account} state={state} onLogout={logout} /></RoleDashboard>
  }

  return <RoleDashboard><AdminDashboard account={account} state={state} onChange={setState} onResetDemo={resetDemo} onLogout={logout} /></RoleDashboard>
}

interface StatusPageAction {
  label: string
  run: () => void
}

export function StatusPage({
  title,
  detail,
  action,
  secondaryAction,
}: {
  title: string
  detail: string
  action?: StatusPageAction
  secondaryAction?: StatusPageAction
}) {
  return (
    <main className="status-page">
      <section className="status-card" aria-live="polite">
        <div className="brand-mark">{brand.shortMark}</div>
        <h1>{title}</h1>
        <p>{detail}</p>
        {action || secondaryAction ? (
          <div className="status-actions">
            {action ? <button className="button primary" type="button" onClick={action.run}>{action.label}</button> : null}
            {secondaryAction ? <button className="button secondary" type="button" onClick={secondaryAction.run}>{secondaryAction.label}</button> : null}
          </div>
        ) : null}
      </section>
    </main>
  )
}

function SupabaseApp({ client }: { client: SupabaseClient }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const signedInUserId = sessionUserId(session)
  const [state, setState] = useState<DemoState | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [syncWarning, setSyncWarning] = useState('')
  const [activationRequired, setActivationRequired] = useState<boolean | undefined>(undefined)
  const [activationInProgress, setActivationInProgress] = useState(false)
  const [activationLoginError, setActivationLoginError] = useState('')
  const [activationError, setActivationError] = useState('')
  const activationInProgressRef = useRef(false)

  useEffect(() => {
    if (!signedInUserId) {
      setActivationRequired(undefined)
      return
    }
    if (activationInProgress) return
    let active = true
    setActivationRequired(undefined)
    setLoadError('')
    void client
      .from('profiles')
      .select('activation_required')
      .eq('user_id', signedInUserId)
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
        const required = data.activation_required === true
        setActivationRequired(required)
        if (!required) setActivationError('')
      })
    return () => {
      active = false
    }
  }, [activationInProgress, client, signedInUserId])

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
      if (!active) return
      // Keep the activation page mounted during the intentional sign-out/sign-in handoff.
      if (activationInProgressRef.current && !nextSession) return
      setSession(nextSession)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [client])

  const refresh = useCallback(async () => {
    if (!signedInUserId || activationRequired !== false || !session?.user) return
    const nextState = await loadSupabaseState(client, session.user)
    const nextAccount = nextState.accounts[0]
    if (nextAccount) alignBrowserRouteWithRole(nextAccount.role)
    setState(nextState)
    setLoadError('')
    setSyncWarning('')
  }, [activationRequired, client, signedInUserId])

  useEffect(() => {
    if (!signedInUserId || activationRequired !== false || !session?.user) {
      setState(null)
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setLoadError('')
    void loadSupabaseState(client, session.user)
      .then((nextState) => {
        if (active) {
          const nextAccount = nextState.accounts[0]
          if (nextAccount) alignBrowserRouteWithRole(nextAccount.role)
          setState(nextState)
          setSyncWarning('')
        }
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
  }, [activationRequired, client, signedInUserId])

  const actions = useMemo(
    () => createSupabaseActions(client, refresh, (warning) => setSyncWarning(warning.message)),
    [client, refresh],
  )

  async function authenticate(username: string, password: string) {
    setActivationLoginError('')
    setActivationError('')
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
    setActivationLoginError('')
    setActivationError('')
    const email = usernameToInternalEmail(username)
    const { data, error } = await client.auth.verifyOtp({ email, token: activationCode.trim(), type: 'magiclink' })
    if (error || !data.session) throw new Error('รหัสเปิดใช้ไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว')
    setSession(data.session)
  }

  async function logout() {
    setActivationLoginError('')
    setActivationError('')
    setSyncWarning('')
    const { error } = await client.auth.signOut()
    if (error) {
      setLoadError(error.message)
      return
    }
    replaceLogicalBrowserRoute('/')
    setSession(null)
    setState(null)
  }

  async function setPersonalPassword(password: string) {
    if (!session?.user) throw new Error('เซสชันเปิดใช้บัญชีหมดอายุ โปรดเริ่มเปิดใช้บัญชีใหม่')
    const username = getSessionUsername(session.user)
    activationInProgressRef.current = true
    setActivationInProgress(true)
    setActivationLoginError('')
    setActivationError('')
    try {
      const nextSession = await completeFirstPasswordActivation(client, username, password)
      setSession(nextSession)
      setActivationRequired(false)
    } catch (error) {
      let recoveredSession: Session | null = null
      try {
        const currentSession = await client.auth.getSession()
        recoveredSession = currentSession.data.session
      } catch {
        // A failed session recovery is handled as a signed-out activation failure below.
      }
      if (recoveredSession) {
        setSession(recoveredSession)
        setActivationRequired(true)
        setActivationError(error instanceof Error ? error.message : 'ไม่สามารถเปิดใช้บัญชีได้ โปรดลองอีกครั้ง')
      } else {
        setSession(null)
        setState(null)
        setActivationLoginError(error instanceof Error ? error.message : 'ไม่สามารถเปิดใช้บัญชีได้ โปรดลองเข้าสู่ระบบอีกครั้ง')
      }
      throw error
    } finally {
      activationInProgressRef.current = false
      setActivationInProgress(false)
    }
  }

  async function resumePasswordActivation() {
    if (!session?.user) throw new Error('เซสชันเปิดใช้บัญชีหมดอายุ โปรดเข้าสู่ระบบใหม่')
    activationInProgressRef.current = true
    setActivationInProgress(true)
    setActivationError('')
    try {
      await completePasswordAuthenticatedActivation(client, session.user.id)
      setActivationRequired(false)
    } catch (error) {
      setActivationError(error instanceof Error ? error.message : 'ไม่สามารถเปิดใช้บัญชีได้ โปรดลองอีกครั้ง')
      throw error
    } finally {
      activationInProgressRef.current = false
      setActivationInProgress(false)
    }
  }

  if (session === undefined) return <StatusPage title="กำลังตรวจสอบการเข้าสู่ระบบ" detail="กรุณารอสักครู่" />
  if (!session && activationLoginError) {
    return (
      <StatusPage
        title="เปิดใช้บัญชียังไม่สำเร็จ"
        detail={activationLoginError}
        action={{ label: 'กลับไปเข้าสู่ระบบ', run: () => setActivationLoginError('') }}
      />
    )
  }
  if (!session) return <LoginPage mode="supabase" onAuthenticate={authenticate} onActivate={activate} />
  if (activationRequired === undefined) {
    return (
      <StatusPage
        title={loadError ? 'ยังเปิดระบบไม่ได้' : 'กำลังตรวจสอบบัญชี'}
        detail={loadError || 'กรุณารอสักครู่'}
        action={loadError ? { label: 'ออกจากระบบ', run: () => void logout() } : undefined}
      />
    )
  }
  if (activationRequired) {
    return (
      <PasswordActivationPage
        username={getSessionUsername(session.user)}
        onSetPassword={setPersonalPassword}
        onResumeActivation={resumePasswordActivation}
        passwordAuthenticated={sessionHasPasswordAuthentication(session)}
        initialError={activationError}
        onLogout={() => void logout()}
      />
    )
  }
  if (loading && !state) return <StatusPage title="กำลังโหลดข้อมูลโรงเรียน" detail="ระบบกำลังตรวจสอบสิทธิ์และเตรียมข้อมูลตามบทบาทของคุณ" />
  if (loadError && !state) {
    return (
      <StatusPage
        title="ยังเปิดระบบไม่ได้"
        detail={loadError}
        action={{ label: 'ลองโหลดใหม่', run: () => void refresh().catch((error: unknown) => setLoadError(error instanceof Error ? error.message : 'ไม่สามารถโหลดข้อมูลได้')) }}
        secondaryAction={{ label: 'ออกจากระบบ', run: () => void logout() }}
      />
    )
  }
  const account = state?.accounts[0]
  if (!state || !account) {
    return (
      <StatusPage
        title="ไม่พบข้อมูลบัญชี"
        detail="โปรดติดต่อผู้ดูแลระบบเพื่อตรวจสอบการผูกบัญชีกับข้อมูลโรงเรียน"
        action={{ label: 'ออกจากระบบ', run: () => void logout() }}
      />
    )
  }

  if (account.role === 'student') {
    return <RoleDashboard syncWarning={syncWarning}><StudentDashboard account={account} state={state} onChange={setState} actions={actions} onLogout={() => void logout()} /></RoleDashboard>
  }
  if (account.role === 'teacher') {
    return <RoleDashboard syncWarning={syncWarning}><TeacherDashboard account={account} state={state} onChange={setState} actions={actions} onLogout={() => void logout()} /></RoleDashboard>
  }
  if (account.role === 'director') {
    return <RoleDashboard syncWarning={syncWarning}><DirectorDashboard account={account} state={state} actions={actions} onLogout={() => void logout()} /></RoleDashboard>
  }
  return <RoleDashboard syncWarning={syncWarning}><AdminDashboard account={account} state={state} onChange={setState} actions={actions} onLogout={() => void logout()} /></RoleDashboard>
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
