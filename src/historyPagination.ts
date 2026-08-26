export const INITIAL_HISTORY_LIMIT = 25
export const HISTORY_PAGE_SIZE = 25

export function visibleHistory<T>(items: readonly T[], limit: number) {
  const safeLimit = Math.max(INITIAL_HISTORY_LIMIT, limit)
  return {
    items: items.slice(0, safeLimit),
    hasMore: items.length > safeLimit,
  }
}
