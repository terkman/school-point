import { describe, expect, it } from 'vitest'
import { normalizeUsername, usernameToInternalEmail } from './supabaseClient'

describe('Supabase username authentication contract', () => {
  it('normalizes a supported username into the internal auth email', () => {
    expect(normalizeUsername('  Teacher.Demo_01 ')).toBe('teacher.demo_01')
    expect(usernameToInternalEmail(' 69001 ', 'accounts.example.test')).toBe('69001@accounts.example.test')
  })

  it('rejects usernames that cannot safely become an email local part', () => {
    expect(() => normalizeUsername('ครู01')).toThrow()
    expect(() => normalizeUsername('.teacher')).toThrow()
    expect(() => normalizeUsername('teacher..one')).toThrow()
    expect(() => normalizeUsername('a'.repeat(65))).toThrow()
  })
})
