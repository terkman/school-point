import { describe, expect, it } from 'vitest'
import {
  browserHrefForLogicalRoute,
  logicalRouteFromLocation,
  usesHashRouting,
} from './browserRoute'

describe('browser route deployment contract', () => {
  it('keeps clean URLs on the primary host', () => {
    expect(usesHashRouting('/')).toBe(false)
    expect(browserHrefForLogicalRoute('/admin/today', '/')).toBe('/admin/today')
    expect(logicalRouteFromLocation({ pathname: '/admin/score', search: '', hash: '' }, '/'))
      .toEqual({ pathname: '/admin/score', search: '' })
  })

  it('uses durable hash routes under the GitHub Pages repository path', () => {
    expect(usesHashRouting('/school-point/')).toBe(true)
    expect(browserHrefForLogicalRoute('/admin/today', '/school-point/'))
      .toBe('/school-point/#/admin/today')
    expect(browserHrefForLogicalRoute('/admin/reports?tab=care', '/school-point/'))
      .toBe('/school-point/#/admin/reports?tab=care')
    expect(logicalRouteFromLocation({
      pathname: '/school-point/',
      search: '',
      hash: '#/admin/reports?tab=audit',
    }, '/school-point/')).toEqual({ pathname: '/admin/reports', search: '?tab=audit' })
  })

  it('maps the GitHub Pages root to the logical login route', () => {
    expect(browserHrefForLogicalRoute('/', '/school-point/')).toBe('/school-point/')
    expect(logicalRouteFromLocation({
      pathname: '/school-point/',
      search: '',
      hash: '',
    }, '/school-point/')).toEqual({ pathname: '/', search: '' })
  })
})
