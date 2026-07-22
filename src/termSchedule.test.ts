import { describe, expect, it } from 'vitest'
import { validateTermSchedule } from './termSchedule'

describe('term schedule validation', () => {
  it('accepts a valid inclusive date range', () => {
    expect(validateTermSchedule('2026-05-18', '2026-10-09')).toBeNull()
    expect(validateTermSchedule('2026-05-18', '2026-05-18')).toBeNull()
  })

  it('requires real ISO dates in chronological order', () => {
    expect(validateTermSchedule('', '2026-10-09')).toContain('กรุณาระบุ')
    expect(validateTermSchedule('2026-02-31', '2026-10-09')).toContain('ไม่ถูกต้อง')
    expect(validateTermSchedule('2026-10-10', '2026-10-09')).toContain('ไม่มาก่อน')
  })
})
