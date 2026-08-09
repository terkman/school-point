export type DirectoryAdminProfile = {
  role?: unknown
  is_active?: unknown
  activation_required?: unknown
} | null | undefined

export function isActiveDirectoryAdmin(profile: DirectoryAdminProfile): boolean {
  return profile?.role === 'admin'
    && profile.is_active === true
    && profile.activation_required !== true
}

/**
 * The token is verified with Auth before this helper is called. This check only
 * narrows a validated session to password authentication for sensitive admin
 * actions such as account recovery.
 */
export function tokenHasPasswordAuthentication(accessToken: string): boolean {
  try {
    const payloadSegment = accessToken.split('.')[1]
    if (!payloadSegment) return false
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!payload || typeof payload !== 'object' || !('amr' in payload)) return false
    const { amr } = payload as { amr?: unknown }
    return Array.isArray(amr) && amr.some(
      (entry) => Boolean(entry && typeof entry === 'object' && (entry as { method?: unknown }).method === 'password'),
    )
  } catch {
    return false
  }
}
