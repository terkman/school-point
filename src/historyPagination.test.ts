import { describe, expect, it } from 'vitest'
import { HISTORY_PAGE_SIZE, INITIAL_HISTORY_LIMIT, visibleHistory } from './historyPagination'

describe('history pagination', () => {
  it('renders a safe initial window and reports when more history is available', () => {
    const history = Array.from({ length: 51 }, (_, index) => index)
    expect(visibleHistory(history, INITIAL_HISTORY_LIMIT)).toEqual({
      items: history.slice(0, 25),
      hasMore: true,
    })
  })

  it('shows the complete final page after a load-more step', () => {
    const history = Array.from({ length: 51 }, (_, index) => index)
    expect(visibleHistory(history, INITIAL_HISTORY_LIMIT + HISTORY_PAGE_SIZE * 2)).toEqual({
      items: history,
      hasMore: false,
    })
  })
})
