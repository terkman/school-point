import { describe, expect, it } from 'vitest'
import { bangkokDay, scoreEntryDateBounds, validateScoreEntryDate } from './scoreEntryDates'
import { schoolServerError } from './serverErrors'

const term = { isActive: true, startsOn: '2026-05-18', endsOn: '2026-10-09' }
describe('term scoring dates', () => {
  it('leaves the date empty after term end rather than backdating an activity automatically', () => {
    const bounds = scoreEntryDateBounds(term, new Date('2026-10-20T09:00:00+07:00'))
    expect(bounds.initialValue).toBe('')
    expect(bounds.ended).toBe(true)
    expect(new Date(bounds.min!).toISOString()).toBe('2026-05-17T17:00:00.000Z')
    expect(new Date(bounds.max).toISOString()).toBe('2026-10-09T16:59:00.000Z')
  })
  it('validates term days in Bangkok even when a timestamp falls on a different UTC date', () => {
    const now = new Date('2026-10-20T12:00:00Z')
    expect(bangkokDay(new Date('2026-05-17T18:00:00Z'))).toBe('2026-05-18')
    expect(validateScoreEntryDate('2026-05-17T18:00:00Z', term, now)).toBe('')
    expect(validateScoreEntryDate('2026-05-17T16:00:00Z', term, now)).toContain('ไม่ก่อน')
    expect(validateScoreEntryDate('2026-10-09T18:00:00Z', term, now)).toContain('ไม่หลัง')
    expect(validateScoreEntryDate('2027-01-01T00:00:00Z', term, now)).toContain('อนาคต')
  })
  it('translates known server errors and retains unknown messages for diagnosis', () => {
    expect(schoolServerError({ code: '22023', message: 'Occurrence time must be inside the active term' })).toContain('ช่วงเปิด–ปิด')
    expect(schoolServerError({ message: 'Unexpected database issue 123' })).toBe('Unexpected database issue 123')
  })
})
