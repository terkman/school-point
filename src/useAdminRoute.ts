import { useCallback, useEffect, useState } from 'react'
import { adminHrefForTab, adminTabFromLocation, type AdminTab } from './adminRoute'

function currentTab(fallback: AdminTab): AdminTab {
  if (typeof window === 'undefined') return fallback
  return adminTabFromLocation(window.location.pathname, window.location.search, fallback)
}

export function useAdminRoute(initialTab: AdminTab): readonly [AdminTab, (nextTab: AdminTab) => void] {
  const [tab, setTab] = useState<AdminTab>(() => currentTab(initialTab))

  useEffect(() => {
    function handlePopState() {
      setTab(currentTab('overview'))
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const navigate = useCallback((nextTab: AdminTab) => {
    if (typeof window !== 'undefined') {
      const nextHref = adminHrefForTab(nextTab)
      const currentHref = `${window.location.pathname}${window.location.search}`
      if (currentHref !== nextHref) window.history.pushState({}, '', nextHref)
    }
    setTab(nextTab)
  }, [])

  return [tab, navigate] as const
}
