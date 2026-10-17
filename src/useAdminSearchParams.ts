import { useCallback, useSyncExternalStore } from 'react'
import { currentLogicalBrowserRoute, pushLogicalBrowserRoute, replaceLogicalBrowserRoute } from './browserRoute'

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange)
  window.addEventListener('hashchange', onChange)
  window.addEventListener('school-point:routechange', onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener('hashchange', onChange)
    window.removeEventListener('school-point:routechange', onChange)
  }
}

function snapshot() {
  return typeof window === 'undefined' ? '' : currentLogicalBrowserRoute().search
}

export function useAdminSearchParams() {
  const search = useSyncExternalStore(subscribe, snapshot, () => '')
  const update = useCallback((values: Record<string, string | null>, replace = false) => {
    if (typeof window === 'undefined') return
    const route = currentLogicalBrowserRoute()
    const params = new URLSearchParams(route.search)
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === '') params.delete(key)
      else params.set(key, value)
    }
    const query = params.toString()
    const href = `${route.pathname}${query ? `?${query}` : ''}`
    if (replace) replaceLogicalBrowserRoute(href)
    else pushLogicalBrowserRoute(href)
  }, [])
  return [new URLSearchParams(search), update] as const
}
