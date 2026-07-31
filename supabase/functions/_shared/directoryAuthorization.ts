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
