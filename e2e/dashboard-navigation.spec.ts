import { expect, test, type Page } from '@playwright/test'
import { createDemoState } from '../src/demoData'
import type { DemoState } from '../src/domain'

async function openAdminPath(page: Page, logicalPath: string) {
  const pathname = new URL(page.url()).pathname
  const href = pathname.startsWith('/school-point/') ? `/school-point/#${logicalPath}` : logicalPath
  await page.goto(href)
}

async function seed(page: Page, state = createDemoState(), route = '') {
  const account = state.accounts.find(item => item.role === 'admin')!
  await page.addInitScript(({ state, account }) => {
    if (!localStorage.getItem('school-point:demo:v2')) localStorage.setItem('school-point:demo:v2', JSON.stringify(state))
    if (!sessionStorage.getItem('school-point:session:v1')) sessionStorage.setItem('school-point:session:v1', JSON.stringify({ accountId: account.id, role: account.role }))
  }, { state, account })
  await page.goto('/')
  if (route) await openAdminPath(page, route)
  await expect(page.locator('.app-root')).toBeVisible()
}

test('Today opens the requested review category and retains filters after refresh and history navigation', async ({ page }) => {
  await seed(page)
  await page.getByRole('button', { name: /คำขอเพิ่มคะแนน จากคุณครู/ }).click()
  await expect(page.getByRole('tab', { name: /ขอเพิ่มคะแนน/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/type=addition/)
  await page.getByPlaceholder('ชื่อนักเรียน รหัส หรือหัวข้อ').fill('นักเรียน')
  await page.locator('.review-sort select').selectOption('newest')
  await page.reload()
  await expect(page.getByRole('tab', { name: /ขอเพิ่มคะแนน/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByPlaceholder('ชื่อนักเรียน รหัส หรือหัวข้อ')).toHaveValue('นักเรียน')
  await expect(page.locator('.review-sort select')).toHaveValue('newest')
  await page.getByRole('tab', { name: /คำอุทธรณ์/ }).click()
  await page.goBack()
  await expect(page.getByRole('tab', { name: /ขอเพิ่มคะแนน/ })).toHaveAttribute('aria-selected', 'true')
})

test('Today counts legacy deadlines consistently and opens the selected case across refresh and back', async ({ page }) => {
  const state = createDemoState()
  const original = state.seriousCases[0]!
  state.seriousCases = [
    original,
    { ...original, id: 'oldest-case', studentId: state.students[0]!.id, guardianNextReminderAt: undefined, guardianContactAttempts: [], createdAt: new Date(Date.now() - 5 * 86400000).toISOString() },
  ]
  await seed(page, state)
  await expect(page.locator('.today-status-strip').getByRole('button', { name: /ต้องติดตามวันนี้/ })).toContainText('2')
  await expect(page.locator('.today-followup-list article').first()).toContainText(state.students[0]!.name)
  await page.getByRole('button', { name: `ติดตามเคส ${state.students[0]!.name}` }).click()
  await expect(page).toHaveURL(/case=oldest-case/)
  await expect(page.locator('.case-detail-header h2')).toHaveText(state.students[0]!.name)
  await page.reload()
  await expect(page.locator('.case-detail-header h2')).toHaveText(state.students[0]!.name)
  await page.locator('.case-queue-list button').filter({ hasText: state.students[2]!.name }).click()
  await expect(page).toHaveURL(new RegExp(`case=${original.id}`))
  await page.goBack()
  await expect(page.locator('.case-detail-header h2')).toHaveText(state.students[0]!.name)
})

test('case summary filters have a visible way to return to all cases and invalid ids are explained', async ({ page }) => {
  await seed(page, createDemoState(), '/admin/cases?case=missing-case')
  await expect(page.getByRole('status').filter({ hasText: 'ไม่พบเคสที่เลือก' })).toBeVisible()
  await openAdminPath(page, '/admin/today')
  await page.locator('.today-status-strip').getByRole('button', { name: /ต้องติดตามวันนี้/ }).click()
  await expect(page).toHaveURL(/filter=due/)
  await page.getByRole('button', { name: 'แสดงทุกเคส', exact: true }).click()
  await expect(page).not.toHaveURL(/filter=/)
})

test('unavailable report tabs redirect to the existing analytics screen without losing filters', async ({ page }) => {
  await seed(page, createDemoState(), '/admin/reports?tab=audit&grade=M2')
  await expect(page.locator('.analytics-dashboard')).toBeVisible()
  await expect(page).toHaveURL(/tab=overview&grade=M2/)
  await expect(page.locator('.admin-today')).toHaveCount(0)
})

test('a deadline reached while Today stays open updates without a manual reload', async ({ page }) => {
  const now = Date.now()
  await page.clock.install({ time: now })
  const state: DemoState = createDemoState()
  state.seriousCases = [{ ...state.seriousCases[0]!, guardianNextReminderAt: new Date(now + 5000).toISOString() }]
  await seed(page, state)
  await expect(page.locator('.today-status-strip').getByRole('button', { name: /ต้องติดตามวันนี้/ })).toContainText('0')
  await page.clock.fastForward(31_000)
  await expect(page.locator('.today-status-strip').getByRole('button', { name: /ต้องติดตามวันนี้/ })).toContainText('1')
})
