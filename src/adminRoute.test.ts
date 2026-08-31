import { describe, expect, it } from 'vitest'
import {
  adminHref,
  adminHrefForTab,
  adminTabFromLocation,
  isAdminPath,
  resolveAdminRoute,
  routeAfterRoleChange,
} from './adminRoute'

describe('admin URL contract', () => {
  it('maps current admin tabs to stable shareable URLs', () => {
    expect(adminHrefForTab('overview')).toBe('/admin/today')
    expect(adminHrefForTab('analytics')).toBe('/admin/reports?tab=overview')
    expect(adminHrefForTab('score')).toBe('/admin/score')
    expect(adminHrefForTab('directory')).toBe('/admin/system/students')
    expect(adminHrefForTab('rules')).toBe('/admin/system/rules')
    expect(adminHrefForTab('paper')).toBe('/admin/system/paper')
    expect(adminHrefForTab('approvals')).toBe('/admin/reviews')
    expect(adminHrefForTab('cases')).toBe('/admin/cases')
    expect(adminHrefForTab('manage')).toBe('/admin/system/staff')
  })

  it('resolves report filters and future system pages without losing the legacy screen', () => {
    expect(resolveAdminRoute('/admin/reports', '?tab=care').id).toBe('reports-care')
    expect(resolveAdminRoute('/admin/reports', '?tab=audit').id).toBe('reports-audit')
    expect(adminTabFromLocation('/admin/reports', '?tab=overview&grade=P3&month=2026-07')).toBe('analytics')
    expect(adminTabFromLocation('/admin/system/rules')).toBe('rules')
    expect(adminTabFromLocation('/admin/system/paper')).toBe('paper')
    expect(adminTabFromLocation('/admin/score')).toBe('score')
    expect(adminHref('reports-overview')).toBe('/admin/reports?tab=overview')
  })

  it('keeps a caller fallback outside admin and defaults unknown admin URLs safely', () => {
    expect(isAdminPath('/teacher/score')).toBe(false)
    expect(adminTabFromLocation('/teacher/score', '', 'cases')).toBe('cases')
    expect(adminTabFromLocation('/admin/not-a-page')).toBe('overview')
  })

  it('clears a stale admin URL for every non-admin role', () => {
    expect(routeAfterRoleChange('/admin/score', 'teacher')).toBe('/')
    expect(routeAfterRoleChange('/admin/cases', 'student')).toBe('/')
    expect(routeAfterRoleChange('/admin/reports', 'director')).toBe('/')
    expect(routeAfterRoleChange('/admin/score', 'admin')).toBeNull()
    expect(routeAfterRoleChange('/', 'teacher')).toBeNull()
  })
})
