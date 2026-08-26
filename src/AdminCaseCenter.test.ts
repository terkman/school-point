import { describe, expect, it } from 'vitest'
import type { DemoState } from './domain'
import { isCurrentGuardianContactsRequest, resolveOpenCaseSelection } from './adminWorkflows'

describe('admin case selection', () => {
  it('falls back when the selected case closes and invalidates its in-flight contact request', () => {
    const openCases = [{ id: 'case-next' }] as DemoState['seriousCases']

    expect(resolveOpenCaseSelection(openCases, 'case-closed')).toBe('case-next')
    expect(resolveOpenCaseSelection([], 'case-closed')).toBe('')
    expect(isCurrentGuardianContactsRequest(8, 7)).toBe(false)
    expect(isCurrentGuardianContactsRequest(8, 8)).toBe(true)
  })
})
