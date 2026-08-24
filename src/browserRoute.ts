export interface BrowserRouteLocation {
  pathname: string
  search: string
  hash: string
}

export interface LogicalBrowserRoute {
  pathname: string
  search: string
}

function normalizeBaseUrl(baseUrl: string): string {
  const withLeadingSlash = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

function splitLogicalHref(href: string): LogicalBrowserRoute {
  const questionMarkIndex = href.indexOf('?')
  if (questionMarkIndex === -1) return { pathname: href || '/', search: '' }
  return {
    pathname: href.slice(0, questionMarkIndex) || '/',
    search: href.slice(questionMarkIndex),
  }
}

export function usesHashRouting(baseUrl: string): boolean {
  return normalizeBaseUrl(baseUrl) !== '/'
}

export function logicalRouteFromLocation(
  location: BrowserRouteLocation,
  baseUrl: string,
): LogicalBrowserRoute {
  if (usesHashRouting(baseUrl) && location.hash.startsWith('#/')) {
    return splitLogicalHref(location.hash.slice(1))
  }

  const normalizedBase = normalizeBaseUrl(baseUrl)
  const pathname = usesHashRouting(baseUrl) && location.pathname.startsWith(normalizedBase)
    ? `/${location.pathname.slice(normalizedBase.length).replace(/^\/+/, '')}`
    : location.pathname
  return { pathname: pathname || '/', search: location.search }
}

export function browserHrefForLogicalRoute(logicalHref: string, baseUrl: string): string {
  if (!usesHashRouting(baseUrl)) return logicalHref
  const normalizedBase = normalizeBaseUrl(baseUrl)
  return logicalHref === '/' ? normalizedBase : `${normalizedBase}#${logicalHref}`
}

export function currentLogicalBrowserRoute(): LogicalBrowserRoute {
  if (typeof window === 'undefined') return { pathname: '/', search: '' }
  return logicalRouteFromLocation(window.location, import.meta.env.BASE_URL)
}

export function replaceLogicalBrowserRoute(nextHref: string) {
  if (typeof window === 'undefined') return
  const current = currentLogicalBrowserRoute()
  if (`${current.pathname}${current.search}` === nextHref) return
  window.history.replaceState({}, '', browserHrefForLogicalRoute(nextHref, import.meta.env.BASE_URL))
}

export function pushLogicalBrowserRoute(nextHref: string) {
  if (typeof window === 'undefined') return
  const current = currentLogicalBrowserRoute()
  if (`${current.pathname}${current.search}` === nextHref) return
  window.history.pushState({}, '', browserHrefForLogicalRoute(nextHref, import.meta.env.BASE_URL))
}

export function publicAssetUrl(path: string): string {
  const normalizedBase = normalizeBaseUrl(import.meta.env.BASE_URL)
  return `${normalizedBase}${path.replace(/^\/+/, '')}`
}
