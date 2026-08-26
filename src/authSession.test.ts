import type { Session } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { sessionUserId } from './authSession'

describe('sessionUserId', () => {
  it('preserves school data after hidden → visible produces same-user SIGNED_IN', () => {
    const initialSession = {
      access_token: 'initial-token',
      user: { id: 'student-1' },
    } as Session
    const focusRecoveredSession = {
      access_token: 'refreshed-token',
      user: { id: 'student-1' },
    } as Session
    expect(sessionUserId(focusRecoveredSession)).toBe(sessionUserId(initialSession))
  })

  it('preserves school data after hidden → visible refreshes the same user token', () => {
    const initialSession = { access_token: 'initial-token', user: { id: 'student-1' } } as Session
    const refreshedSession = { access_token: 'refreshed-token', user: { id: 'student-1' } } as Session
    expect(sessionUserId(refreshedSession)).toBe(sessionUserId(initialSession))
  })

  it('changes only when the signed-in user changes', () => {
    expect(sessionUserId(null)).toBeUndefined()
    expect(sessionUserId({ user: { id: 'student-2' } } as Session)).toBe('student-2')
  })

  it('resets session-bound data when a different user signs in', () => {
    const currentSession = { user: { id: 'student-1' } } as Session
    const nextSession = { user: { id: 'student-2' } } as Session
    expect(sessionUserId(nextSession)).toBe('student-2')
    expect(sessionUserId(nextSession)).not.toBe(sessionUserId(currentSession))
  })

  it('keeps USER_UPDATED session information without reloading same-user school data', () => {
    const currentSession = { user: { id: 'student-1' } } as Session
    const updatedSession = { user: { id: 'student-1', updated_at: '2026-08-26T10:00:00Z' } } as Session
    expect(sessionUserId(updatedSession)).toBe(sessionUserId(currentSession))
  })

  it('resets session-bound data when the user signs out', () => {
    const currentSession = { user: { id: 'student-1' } } as Session
    expect(sessionUserId(null)).toBeUndefined()
    expect(sessionUserId(null)).not.toBe(sessionUserId(currentSession))
  })
})
