import { useCallback, useEffect, useState } from 'react'
import { adminHrefForTab, adminTabFromLocation, type AdminTab } from './adminRoute'
import { currentLogicalBrowserRoute, pushLogicalBrowserRoute } from './browserRoute'

function currentTab(fallback: AdminTab): AdminTab {
  if (typeof window === 'undefined') return fallback
  const currentRoute = currentLogicalBrowserRoute()
  return adminTabFromLocation(currentRoute.pathname, currentRoute.search, fallback)
}

export function useAdminRoute(initialTab: AdminTab): readonly [AdminTab, (nextTab: AdminTab) => void] {
  const [tab, setTab] = useState<AdminTab>(() => currentTab(initialTab))

  useEffect(() => {
    function handlePopState() {
      setTab(currentTab('overview'))
    }

    window.addEventListener('popstate', handlePopState)
    window.addEventListener('hashchange', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener('hashchange', handlePopState)
    }
  }, [])

  const navigate = useCallback((nextTab: AdminTab) => {
    if (typeof window !== 'undefined') {
      const nextHref = adminHrefForTab(nextTab)
      pushLogicalBrowserRoute(nextHref)
    }
    setTab(nextTab)
  }, [])

  return [tab, navigate] as const
}
