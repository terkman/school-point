import { test, expect, type Page } from '@playwright/test'
import { createDemoState } from '../src/demoData'
import type { DemoState, Role } from '../src/domain'

async function seed(page: Page, state: DemoState, role: Role = 'admin') {
  const account = state.accounts.find((item) => item.role === role)!
  await page.route('https://*.supabase.co/**', (route) => route.abort())
  await page.addInitScript(({ state, account }) => {
    if (!localStorage.getItem('school-point:demo:v2')) localStorage.setItem('school-point:demo:v2', JSON.stringify(state))
    if (!sessionStorage.getItem('school-point:session:v1')) sessionStorage.setItem('school-point:session:v1', JSON.stringify({ accountId: account.id, role: account.role }))
  }, { state, account })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'ออกจากระบบ' }).first()).toBeVisible()
}

async function openPaper(page: Page) {
  await page.getByRole('button', { name: 'จัดการระบบ', exact: true }).click()
  await page.getByRole('button', { name: /เอกสารกระดาษ/ }).click()
  await page.getByRole('option', { name: /นักเรียนตัวอย่าง 01/ }).click()
}

test('a zero-applied deduction cannot restore a phantom point', async ({ page }, testInfo) => {
  const state = createDemoState()
  const source = state.transactions.find((item) => item.studentId === state.students[0]!.id && item.kind === 'deduction')!
  source.appliedDelta = 0
  source.scoreBefore = 0
  source.scoreAfter = 0
  state.students[0]!.score = 0
  state.appeals = [{ id: 'appeal-zero-fixture', transactionId: source.id, studentId: source.studentId, statement: 'กรณีตรวจอุทธรณ์คะแนนศูนย์', status: 'submitted', createdAt: new Date().toISOString() }]
  const ledgerCount = state.transactions.length
  await seed(page, state)
  await page.getByRole('button', { name: /งานรอตรวจ/ }).first().click()
  await page.getByRole('tab', { name: /คำอุทธรณ์/ }).click()
  await page.getByRole('button', { name: /กรณีตรวจอุทธรณ์คะแนนศูนย์/ }).click()
  await expect(page.getByRole('radio', { name: /^คืนคะแนน/ })).toBeDisabled()
  await expect(page.getByRole('radio', { name: /^ไม่คืนคะแนน/ })).toBeChecked()
  await expect(page.getByText(/รายการนี้ไม่ได้ตัดคะแนนจริง/)).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('zero-restoration.png') })
  await page.getByLabel(/คำชี้แจงให้นักเรียนเห็น/).fill('ตรวจสอบแล้วรายการนี้ไม่ได้ลดคะแนนจริง')
  await page.getByRole('button', { name: 'ยืนยันไม่คืนคะแนน', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('school-point:demo:v2')!) as DemoState)
  expect(saved.students[0]!.score).toBe(0)
  expect(saved.transactions).toHaveLength(ledgerCount)
  expect(saved.appeals[0]!.restoredPoints).toBe(0)
})

test('paper appeals honor stored deadlines and expire old records with no deadline', async ({ page }) => {
  const state = createDemoState()
  const original = state.transactions.find((item) => item.studentId === state.students[0]!.id && item.kind === 'deduction')!
  const now = Date.now()
  const recent = { ...original, id: 'recent-incident', incidentId: 'recent-incident', reason: 'เหตุการณ์ที่ยังอุทธรณ์ได้', occurredAt: new Date(now - 2 * 86400000).toISOString(), appealDeadline: undefined }
  const expired = { ...recent, id: 'expired-incident', incidentId: 'expired-incident', reason: 'เหตุการณ์ที่หมดเวลาแล้ว', occurredAt: new Date(now - 10 * 86400000).toISOString() }
  const stored = { ...expired, id: 'stored-deadline', incidentId: 'stored-deadline', reason: 'เหตุการณ์ย้อนหลังที่ยังมีเส้นตาย', appealDeadline: new Date(now + 3 * 86400000).toISOString() }
  state.transactions = [recent, expired, stored]
  state.appeals = []
  await seed(page, state)
  await openPaper(page)
  await page.getByRole('radio', { name: /แบบฟอร์มอุทธรณ์รายการคะแนน/ }).check()
  const select = page.getByLabel('รายการตัดคะแนนที่ต้องการอุทธรณ์')
  await expect(select.getByRole('option', { name: /เหตุการณ์ที่หมดเวลาแล้ว/ })).toHaveCount(0)
  await expect(select.getByRole('option', { name: /เหตุการณ์ที่ยังอุทธรณ์ได้/ })).toHaveCount(1)
  await expect(select.getByRole('option', { name: /เหตุการณ์ย้อนหลังที่ยังมีเส้นตาย/ })).toHaveCount(1)
  await select.selectOption(stored.id)
  await page.getByRole('button', { name: 'เตรียมเอกสาร', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'เตรียมเอกสาร' })).toContainText('เรียบร้อยแล้ว')
  await expect(page.locator('.paper-preview-workspace')).not.toContainText('Invalid Date')
})

test('teacher internal notes stay out of public paper output', async ({ page }) => {
  const state = createDemoState()
  state.term.startsOn = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10)
  state.term.endsOn = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
  const note = 'E2E INTERNAL NOTE: ใช้ภายในเท่านั้น'
  await seed(page, state, 'teacher')
  await page.getByRole('button', { name: 'ตัดคะแนน' }).first().click()
  await page.getByLabel('รายละเอียดเหตุการณ์เพิ่มเติม (ไม่บังคับ)').fill(note)
  await page.getByRole('button', { name: 'ตรวจสอบก่อนยืนยัน' }).click()
  await page.getByRole('button', { name: 'ยืนยันตัดคะแนน 1 คน' }).click()
  await expect(page.getByRole('heading', { name: 'ตัดคะแนนจริงรวม 2 คะแนน' })).toBeVisible()
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('school-point:demo:v2')!) as DemoState)
  const transaction = saved.transactions.find((item) => item.internalReason === note)!
  expect(transaction).toBeTruthy()
  expect(transaction.reason).not.toContain(note)
  const admin = state.accounts.find((item) => item.role === 'admin')!
  await page.evaluate((account) => sessionStorage.setItem('school-point:session:v1', JSON.stringify({ accountId: account.id, role: account.role })), admin)
  await page.reload()
  await openPaper(page)
  await page.getByRole('radio', { name: /ใบสรุปคะแนนความประพฤติ/ }).check()
  await page.getByRole('button', { name: 'เตรียมเอกสาร', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'เตรียมเอกสาร' })).toContainText('เรียบร้อยแล้ว')
  await expect(page.locator('.paper-preview-workspace').getByText(transaction.reason, { exact: true }).first()).toBeVisible()
  await expect(page.locator('.paper-preview-workspace')).not.toContainText(note)
})
