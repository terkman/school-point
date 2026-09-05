import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import {
  completeFirstPasswordActivation,
  completePasswordAuthenticatedActivation,
  sessionCanResumePasswordActivation,
  sessionHasPasswordAuthentication,
} from './firstPasswordActivation'

function createClient(options: {
  signInError?: string
  activationRequired?: boolean
  updateErrorCode?: string
  rpcErrors?: Array<string | null>
} = {}) {
  const calls: string[] = []
  let updateInput: { password?: string; data?: Record<string, unknown> } | undefined
  let signOutInput: { scope?: string } | undefined
  let signInInput: { email: string; password: string } | undefined
  let rpcName: string | undefined
  let rpcAttempt = 0
  const session = { access_token: 'test-access-token' } as Session
  const client = {
    auth: {
      updateUser: async (input: { password?: string; data?: Record<string, unknown> }) => {
        calls.push('updateUser')
        updateInput = input
        if (options.updateErrorCode) {
          return {
            data: { user: null },
            error: { code: options.updateErrorCode, message: 'sensitive auth detail' },
          }
        }
        return { data: { user: { id: 'user-1' } }, error: null }
      },
      signOut: async (input: { scope?: string }) => {
        calls.push('signOut')
        signOutInput = input
        return { error: null }
      },
      signInWithPassword: async (input: { email: string; password: string }) => {
        calls.push('signInWithPassword')
        signInInput = input
        if (options.signInError) {
          return { data: { session: null, user: null }, error: { message: options.signInError } }
        }
        return { data: { session, user: { id: 'user-1' } }, error: null }
      },
    },
    rpc: async (name: string) => {
      calls.push('rpc')
      rpcName = name
      const rpcError = options.rpcErrors?.[rpcAttempt]
      rpcAttempt += 1
      if (rpcError) return { data: null, error: { message: rpcError } }
      return { data: { ok: true, activated: true }, error: null }
    },
    from: () => {
      calls.push('fromProfiles')
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { activation_required: options.activationRequired ?? false },
              error: null,
            }),
          }),
        }),
      }
    },
  } as unknown as SupabaseClient

  return {
    calls,
    client,
    session,
    getUpdateInput: () => updateInput,
    getSignOutInput: () => signOutInput,
    getSignInInput: () => signInInput,
    getRpcName: () => rpcName,
  }
}

describe('completeFirstPasswordActivation', () => {
  it('reauthenticates with the deterministic email before completing and confirming activation', async () => {
    const fixture = createClient()

    const result = await completeFirstPasswordActivation(fixture.client, ' Student.01 ', 'Student2569')

    expect(result).toBe(fixture.session)
    expect(fixture.getUpdateInput()).toEqual({
      password: 'Student2569',
      data: { must_change_password: false },
    })
    expect(fixture.getSignOutInput()).toEqual({ scope: 'local' })
    expect(fixture.getSignInInput()).toEqual({
      email: 'student.01@accounts.school-point.invalid',
      password: 'Student2569',
    })
    expect(fixture.getRpcName()).toBe('complete_first_password_activation')
    expect(fixture.calls).toEqual([
      'updateUser',
      'signOut',
      'signInWithPassword',
      'rpc',
      'fromProfiles',
    ])
  })

  it('does not expose an internal identifier when password reauthentication fails', async () => {
    const fixture = createClient({ signInError: 'account student.01@private.invalid was not found' })

    await expect(
      completeFirstPasswordActivation(fixture.client, 'student.01', 'Student2569'),
    ).rejects.toThrow('ไม่สามารถเข้าสู่ระบบใหม่ได้')
    const confirmation = completeFirstPasswordActivation(
      createClient({ activationRequired: true }).client,
      'student.01',
      'Student2569',
    )
    await expect(confirmation).rejects.toThrow('ระบบยังยืนยันการเปิดใช้ไม่สำเร็จ')
    await expect(confirmation).rejects.not.toThrow('user-1')
  })

  it('continues with password reauthentication when updateUser reports same_password', async () => {
    const fixture = createClient({ updateErrorCode: 'same_password' })

    await expect(
      completeFirstPasswordActivation(fixture.client, 'student.01', 'Student2569'),
    ).resolves.toBe(fixture.session)
    expect(fixture.calls).toEqual([
      'updateUser',
      'signOut',
      'signInWithPassword',
      'rpc',
      'fromProfiles',
    ])
  })

  it('retries a transient RPC failure from the password-authenticated session without updating the password again', async () => {
    const fixture = createClient({ rpcErrors: ['temporary network failure', null] })

    await expect(
      completeFirstPasswordActivation(fixture.client, 'student.01', 'Student2569'),
    ).rejects.toThrow('ระบบยังยืนยันการเปิดใช้ไม่สำเร็จ')
    fixture.calls.length = 0

    await expect(
      completePasswordAuthenticatedActivation(fixture.client, 'user-1'),
    ).resolves.toBeUndefined()
    expect(fixture.calls).toEqual(['rpc', 'fromProfiles'])
  })
})

function sessionWithAmr(method: string): Pick<Session, 'access_token'> {
  const payload = btoa(JSON.stringify({ amr: [{ method, timestamp: 1 }] }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return { access_token: `header.${payload}.signature` }
}

function resumableSession(method: string, mustChangePassword: boolean): Pick<Session, 'access_token' | 'user'> {
  return {
    ...sessionWithAmr(method),
    user: { user_metadata: { must_change_password: mustChangePassword } } as unknown as Session['user'],
  }
}

describe('sessionHasPasswordAuthentication', () => {
  it('uses password AMR only as a resilient UI hint', () => {
    expect(sessionHasPasswordAuthentication(sessionWithAmr('password'))).toBe(true)
    expect(sessionHasPasswordAuthentication(sessionWithAmr('otp'))).toBe(false)
    expect(sessionHasPasswordAuthentication({ access_token: 'malformed-token' })).toBe(false)
  })
})

describe('sessionCanResumePasswordActivation', () => {
  it('never treats the temporary password handoff as a completed personal-password change', () => {
    expect(sessionCanResumePasswordActivation(resumableSession('password', true))).toBe(false)
    expect(sessionCanResumePasswordActivation(resumableSession('password', false))).toBe(true)
    expect(sessionCanResumePasswordActivation(resumableSession('otp', false))).toBe(false)
  })
})
