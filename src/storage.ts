import { createDemoState } from './demoData'
import type { DemoState, Role } from './domain'

const STORAGE_KEY = 'school-point:demo:v2'
const SESSION_KEY = 'school-point:session:v1'

export interface DemoSession {
  accountId: string
  role: Role
}

export function loadDemoState(): DemoState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createDemoState()
    const parsed = JSON.parse(raw) as DemoState
    if (parsed.version !== 2) return createDemoState()
    return parsed
  } catch {
    return createDemoState()
  }
}

export function saveDemoState(state: DemoState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Demo mode remains usable even when storage is unavailable.
  }
}

export function resetDemoState(): DemoState {
  const next = createDemoState()
  saveDemoState(next)
  return next
}

export function loadSession(): DemoSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as DemoSession) : null
  } catch {
    return null
  }
}

export function saveSession(session: DemoSession): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    // Session persistence is a convenience only in demo mode.
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Ignore unavailable session storage.
  }
}
