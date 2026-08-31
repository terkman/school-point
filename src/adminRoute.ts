export type AdminTab = 'overview' | 'analytics' | 'score' | 'directory' | 'paper' | 'approvals' | 'cases' | 'manage'

export type AdminRouteId =
  | 'today'
  | 'score'
  | 'reviews'
  | 'cases'
  | 'system-students'
  | 'system-staff'
  | 'system-rules'
  | 'system-import'
  | 'system-paper'
  | 'system-academic-years'
  | 'system-progression'
  | 'reports-overview'
  | 'reports-care'
  | 'reports-audit'

export interface AdminRouteDefinition {
  id: AdminRouteId
  pathname: string
  search?: string
  legacyTab: AdminTab
}

export const adminRoutes: readonly AdminRouteDefinition[] = [
  { id: 'today', pathname: '/admin/today', legacyTab: 'overview' },
  { id: 'score', pathname: '/admin/score', legacyTab: 'score' },
  { id: 'reviews', pathname: '/admin/reviews', legacyTab: 'approvals' },
  { id: 'cases', pathname: '/admin/cases', legacyTab: 'cases' },
  { id: 'system-students', pathname: '/admin/system/students', legacyTab: 'directory' },
  { id: 'system-staff', pathname: '/admin/system/staff', legacyTab: 'manage' },
  { id: 'system-rules', pathname: '/admin/system/rules', legacyTab: 'manage' },
  { id: 'system-import', pathname: '/admin/system/import', legacyTab: 'manage' },
  { id: 'system-paper', pathname: '/admin/system/paper', legacyTab: 'paper' },
  { id: 'system-academic-years', pathname: '/admin/system/academic-years', legacyTab: 'manage' },
  { id: 'system-progression', pathname: '/admin/system/progression', legacyTab: 'manage' },
  { id: 'reports-overview', pathname: '/admin/reports', search: '?tab=overview', legacyTab: 'analytics' },
  { id: 'reports-care', pathname: '/admin/reports', search: '?tab=care', legacyTab: 'overview' },
  { id: 'reports-audit', pathname: '/admin/reports', search: '?tab=audit', legacyTab: 'overview' },
] as const

const routeById = new Map(adminRoutes.map((route) => [route.id, route]))

const legacyRouteByTab: Record<AdminTab, AdminRouteId> = {
  overview: 'today',
  analytics: 'reports-overview',
  score: 'score',
  directory: 'system-students',
  approvals: 'reviews',
  cases: 'cases',
  manage: 'system-staff',
  paper: 'system-paper',
}

function normalizePathname(pathname: string): string {
  const withoutTrailingSlashes = pathname.replace(/\/+$/, '')
  return withoutTrailingSlashes || '/'
}

export function isAdminPath(pathname: string): boolean {
  const normalized = normalizePathname(pathname)
  return normalized === '/admin' || normalized.startsWith('/admin/')
}

export function routeAfterRoleChange(pathname: string, role: 'admin' | 'director' | 'teacher' | 'student'): string | null {
  if (role === 'admin' || !isAdminPath(pathname)) return null
  return '/'
}

export function resolveAdminRoute(pathname: string, search = ''): AdminRouteDefinition {
  const normalizedPathname = normalizePathname(pathname)
  if (normalizedPathname === '/admin/reports') {
    const tab = new URLSearchParams(search).get('tab')
    const reportId: AdminRouteId = tab === 'care'
      ? 'reports-care'
      : tab === 'audit'
        ? 'reports-audit'
        : 'reports-overview'
    return routeById.get(reportId)!
  }

  const exact = adminRoutes.find((route) => route.pathname === normalizedPathname && !route.search)
  if (exact) return exact

  if (normalizedPathname === '/admin/system') return routeById.get('system-staff')!
  if (normalizedPathname.startsWith('/admin/system/')) return routeById.get('system-staff')!
  return routeById.get('today')!
}

export function adminHref(routeId: AdminRouteId): string {
  const route = routeById.get(routeId)
  if (!route) return '/admin/today'
  return `${route.pathname}${route.search ?? ''}`
}

export function adminHrefForTab(tab: AdminTab): string {
  return adminHref(legacyRouteByTab[tab])
}

export function adminTabFromLocation(pathname: string, search = '', fallback: AdminTab = 'overview'): AdminTab {
  if (!isAdminPath(pathname)) return fallback
  return resolveAdminRoute(pathname, search).legacyTab
}
