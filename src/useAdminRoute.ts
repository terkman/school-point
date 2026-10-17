import { useCallback, useEffect, useState } from 'react'
import { adminHrefForTab, adminTabFromLocation, canonicalReportSearch, type AdminTab } from './adminRoute'
import { currentLogicalBrowserRoute, pushLogicalBrowserRoute, replaceLogicalBrowserRoute } from './browserRoute'

function currentTab(fallback: AdminTab): AdminTab {
  if (typeof window === 'undefined') return fallback
  const currentRoute = currentLogicalBrowserRoute()
  return adminTabFromLocation(currentRoute.pathname, currentRoute.search, fallback)
}

export function useAdminRoute(initialTab: AdminTab): readonly [AdminTab, (nextTab: AdminTab, values?: Record<string, string>) => void] {
  const [tab, setTab] = useState<AdminTab>(() => currentTab(initialTab))

  useEffect(() => {
    function handlePopState() {
      const route = currentLogicalBrowserRoute()
      const canonical = route.pathname === '/admin/reports' ? canonicalReportSearch(route.search) : null
      if (canonical) replaceLogicalBrowserRoute(`${route.pathname}${canonical}`)
      setTab(currentTab('overview'))
    }

    handlePopState()
    window.addEventListener('popstate', handlePopState)
    window.addEventListener('hashchange', handlePopState)
    window.addEventListener('school-point:routechange', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('hashchange', handlePopState)
      window.removeEventListener('school-point:routechange', handlePopState)
    }
  }, [])

  const navigate = useCallback((nextTab: AdminTab, values: Record<string, string> = {}) => {
    if (typeof window !== 'undefined') {
      const nextHref = adminHrefForTab(nextTab, values)
      pushLogicalBrowserRoute(nextHref)
    }
    setTab(nextTab)
  }, [])

  return [tab, navigate] as const
}
