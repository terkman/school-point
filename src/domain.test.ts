import { describe, expect, it } from 'vitest'
import { applyScoreDelta, canAppeal, canAppealUntil, clampScore } from './domain'

describe('score policy', () => {
  it('allows accumulated scores over 100 while preventing a negative balance', () => {
    expect(clampScore(-20)).toBe(0)
    expect(clampScore(120)).toBe(120)
    expect(applyScoreDelta(3, -5)).toEqual({
      requestedDelta: -5,
      appliedDelta: -3,
      before: 3,
      after: 0,
    })
    const addition = applyScoreDelta(95, 20)
    expect(addition).toEqual({ requestedDelta: 20, appliedDelta: 20, before: 95, after: 115 })
    expect(applyScoreDelta(addition.after, -30)).toEqual({ requestedDelta: -30, appliedDelta: -30, before: 115, after: 85 })
  })

  it('allows appeals through the seventh day only', () => {
    const occurredAt = '2026-07-01T03:00:00.000Z'
    expect(canAppeal(occurredAt, new Date('2026-07-08T03:00:00.000Z'))).toBe(true)
    expect(canAppeal(occurredAt, new Date('2026-07-08T03:00:00.001Z'))).toBe(false)
    expect(canAppealUntil('2026-07-08T03:00:00.000Z', new Date('2026-07-08T03:00:00.000Z'))).toBe(true)
  })
})
