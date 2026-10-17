import { describe, expect, it } from 'vitest'
import { caseGuardianReminderAt, compareGuardianCases } from './adminWorkflows'
import { createDemoState } from './demoData'

describe('shared guardian reminder deadlines', () => {
  const original = createDemoState().seriousCases[0]!

  it('honors a scheduled reminder over the contact history', () => {
    const scheduled = '2026-10-20T03:00:00.000Z'
    expect(caseGuardianReminderAt({ ...original, guardianNextReminderAt: scheduled })).toBe(scheduled)
  })

  it('uses the latest contact attempt regardless of input order for legacy cases', () => {
    const template = original.guardianContactAttempts![0]!
    expect(caseGuardianReminderAt({
      ...original,
      guardianNextReminderAt: undefined,
      guardianContactAttempts: [
        { ...template, createdAt: '2026-10-10T03:00:00.000Z' },
        { ...template, createdAt: '2026-10-14T03:00:00.000Z' },
      ],
    })).toBe('2026-10-15T03:00:00.000Z')
  })

  it('falls back to case creation and does not invent deadlines for invalid dates', () => {
    expect(caseGuardianReminderAt({ ...original, guardianNextReminderAt: undefined, guardianContactAttempts: [], createdAt: '2026-10-10T03:00:00.000Z' })).toBe('2026-10-11T03:00:00.000Z')
    expect(caseGuardianReminderAt({ ...original, guardianNextReminderAt: 'invalid', guardianContactAttempts: [], createdAt: 'invalid' })).toBeUndefined()
  })

  it('puts older pending deadlines first and completed notifications last', () => {
    const newer = { ...original, id: 'newer', guardianNextReminderAt: '2026-10-15T03:00:00.000Z' }
    const older = { ...original, id: 'older', guardianNextReminderAt: '2026-10-12T03:00:00.000Z' }
    const completed = { ...older, id: 'completed', guardianContactStatus: 'completed' as const }
    expect([newer, completed, older].sort(compareGuardianCases).map(item => item.id)).toEqual(['older', 'newer', 'completed'])
  })
})
