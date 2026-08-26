import type { Session } from '@supabase/supabase-js'

/**
 * A stable identity for data that belongs to the signed-in person.
 *
 * Supabase replaces the Session object when it refreshes an access token after
 * the browser regains focus. The user id does not change in that case, so UI
 * effects that load person-specific data must depend on this value instead of
 * the Session/User object identity.
 */
export function sessionUserId(session: Session | null | undefined): string | undefined {
  return session?.user.id
}
