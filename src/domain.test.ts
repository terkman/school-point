import { describe, expect, it } from 'vitest'
import { applyScoreDelta, canAppeal, canAppealUntil, clampScore } from './domain'

describe('score policy', () => {
  it('keeps scores inside 0–100', () => {
    expect(clampScore(-20)).toBe(0)
    expect(clampScore(120)).toBe(100)
    expect(applyScoreDelta(3, -5)).toEqual({
      requestedDelta: -5,
      appliedDelta: -3,
      before: 3,
      after: 0,
    })
    expect(applyScoreDelta(98, 5).after).toBe(100)
  })

  it('allows appeals through the seventh day only', () => {
    const occurredAt = '2026-07-01T03:00:00.000Z'
    expect(canAppeal(occurredAt, new Date('2026-07-08T03:00:00.000Z'))).toBe(true)
    expect(canAppeal(occurredAt, new Date('2026-07-08T03:00:00.001Z'))).toBe(false)
    expect(canAppealUntil('2026-07-08T03:00:00.000Z', new Date('2026-07-08T03:00:00.000Z'))).toBe(true)
  })
})
