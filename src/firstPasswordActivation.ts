import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { usernameToInternalEmail } from './supabaseClient'

const PASSWORD_SAVE_ERROR = 'ไม่สามารถบันทึกรหัสผ่านใหม่ได้ โปรดลองอีกครั้ง'
const REAUTHENTICATION_ERROR = 'ตั้งรหัสผ่านแล้ว แต่ไม่สามารถเข้าสู่ระบบใหม่ได้ โปรดเข้าสู่ระบบด้วยรหัสผ่านใหม่อีกครั้ง'
const ACTIVATION_CONFIRMATION_ERROR = 'ตั้งรหัสผ่านแล้ว แต่ระบบยังยืนยันการเปิดใช้ไม่สำเร็จ โปรดลองอีกครั้งหรือติดต่อผู้ดูแลระบบ'

function internalEmailForActivation(username: string): string {
  try {
    return usernameToInternalEmail(username)
  } catch {
    throw new Error('ไม่สามารถเตรียมบัญชีสำหรับเปิดใช้ได้ โปรดติดต่อผู้ดูแลระบบ')
  }
}

async function runActivationStep<T>(operation: () => PromiseLike<T>, safeError: string): Promise<T> {
  try {
    return await operation()
  } catch {
    throw new Error(safeError)
  }
}

/**
 * This decoded AMR is only a UI hint for choosing the retry screen. The signed
 * token and activation permission are still verified by Supabase and the RPC.
 */
export function sessionHasPasswordAuthentication(session: Pick<Session, 'access_token'>): boolean {
  try {
    const payloadSegment = session.access_token.split('.')[1]
    if (!payloadSegment) return false
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!payload || typeof payload !== 'object' || !('amr' in payload)) return false
    const { amr } = payload as { amr?: unknown }
    return Array.isArray(amr) && amr.some(
      (entry) => Boolean(entry && typeof entry === 'object' && (entry as { method?: unknown }).method === 'password'),
    )
  } catch {
    return false
  }
}

/**
 * The temporary Edge handoff is password-authenticated too. Metadata only
 * controls which screen is shown; the database state machine remains the
 * security boundary when activation is completed.
 */
export function sessionCanResumePasswordActivation(
  session: Pick<Session, 'access_token' | 'user'>,
): boolean {
  return sessionHasPasswordAuthentication(session)
    && session.user.user_metadata?.must_change_password !== true
}

/** Complete activation from an existing password-authenticated session. */
export async function completePasswordAuthenticatedActivation(
  client: SupabaseClient,
  userId: string,
): Promise<void> {
  const activationResult = await runActivationStep(
    () => client.rpc('complete_first_password_activation'),
    ACTIVATION_CONFIRMATION_ERROR,
  )
  if (activationResult.error) {
    throw new Error(ACTIVATION_CONFIRMATION_ERROR)
  }

  const profileResult = await runActivationStep(
    () => client
      .from('profiles')
      .select('activation_required')
      .eq('user_id', userId)
      .maybeSingle(),
    ACTIVATION_CONFIRMATION_ERROR,
  )
  if (profileResult.error || !profileResult.data || profileResult.data.activation_required !== false) {
    throw new Error(ACTIVATION_CONFIRMATION_ERROR)
  }
}

/**
 * Finish first-password activation with a fresh password-authenticated session.
 * The profile read is the source of truth; the RPC response is deliberately not trusted.
 */
export async function completeFirstPasswordActivation(
  client: SupabaseClient,
  username: string,
  password: string,
): Promise<Session> {
  const email = internalEmailForActivation(username)

  const passwordResult = await runActivationStep(
    () => client.auth.updateUser({
      password,
      data: { must_change_password: false },
    }),
    PASSWORD_SAVE_ERROR,
  )
  const passwordWasAlreadySet = passwordResult.error?.code === 'same_password'
  if ((!passwordWasAlreadySet && passwordResult.error) || (!passwordWasAlreadySet && !passwordResult.data.user)) {
    throw new Error(PASSWORD_SAVE_ERROR)
  }

  const signOutResult = await runActivationStep(
    () => client.auth.signOut({ scope: 'local' }),
    REAUTHENTICATION_ERROR,
  )
  if (signOutResult.error) {
    throw new Error(REAUTHENTICATION_ERROR)
  }

  const signInResult = await runActivationStep(
    () => client.auth.signInWithPassword({ email, password }),
    REAUTHENTICATION_ERROR,
  )
  if (signInResult.error || !signInResult.data.session || !signInResult.data.user) {
    throw new Error(REAUTHENTICATION_ERROR)
  }

  await completePasswordAuthenticatedActivation(client, signInResult.data.user.id)

  return signInResult.data.session
}
