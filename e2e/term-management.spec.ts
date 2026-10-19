import { expect, test, type Page } from '@playwright/test'
import { createDemoState } from '../src/demoData'
import type { DemoState, Role } from '../src/domain'
import { demoPrepareNextTerm, demoTransitionTerm } from '../src/termManagement'

function dateOffset(days: number) {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
}
function fixture() {
  const state = createDemoState()
  state.term = { ...state.term, startsOn: dateOffset(-90), endsOn: dateOffset(-1) }
  state.students = state.students.map((student, index) => ({ ...student, score: index === 0 ? 70 : 100 }))
  state.additionRequests = []
  state.deductionRequests = []
  state.appeals = []
  state.seriousCases = []
  const actor = state.accounts.find(account => account.role === 'teacher')!
  state.transactions = state.students.flatMap((student, index) => [{
    id: `term-opening-${student.id}`, studentId: student.id, termId: state.term.id, kind: 'reset' as const,
    requestedDelta: 100, appliedDelta: 100, scoreBefore: 0, scoreAfter: 100,
    reason: 'เปิดคะแนนเทอม 1', occurredAt: new Date(Date.now() - 80 * 86400000).toISOString(), actorId: actor.id,
  }, ...(index === 0 ? [{
    id: 'old-term-deduction', studentId: student.id, termId: state.term.id, kind: 'deduction' as const,
    requestedDelta: -30, appliedDelta: -30, scoreBefore: 100, scoreAfter: 70,
    reason: 'คะแนนเดิมก่อนปิดเทอม 1', occurredAt: new Date(Date.now() - 5 * 86400000).toISOString(), actorId: actor.id,
  }] : [])])
  state.rules = state.rules.map((rule, index) => ({ ...rule, active: index === 0, ...(index === 0 ? { points: 5, severity: 'low' as const, guardianContactRequired: false } : {}) }))
  state.accounts.push({ id: 'term-director', username: 'director.demo', password: 'demo1234', displayName: 'ผู้อำนวยการทดสอบ', role: 'director' })
  return state
}
function closedFixture() {
  const state = fixture()
  const admin = state.accounts.find(account => account.role === 'admin')!
  const prepared = demoPrepareNextTerm(state, admin, { schoolYear: 2569, semester: 2, name: 'ภาคเรียนที่ 2/2569', startsOn: dateOffset(0), endsOn: dateOffset(90) })
  return demoTransitionTerm(prepared.state, admin, { currentTermId: state.term.id, nextTermId: prepared.result.termId, clientRequestId: 'daeb48d5-ae50-4cc1-aaf8-b0caf0c10e7f' }).state
}
async function seed(page: Page, state: DemoState, role: Role = 'admin') {
  const account = state.accounts.find(account => account.role === role)!
  await page.addInitScript(({ state, account }) => {
    if (!localStorage.getItem('school-point:demo:v2')) localStorage.setItem('school-point:demo:v2', JSON.stringify(state))
    if (!sessionStorage.getItem('school-point:session:v1')) sessionStorage.setItem('school-point:session:v1', JSON.stringify({ accountId: account.id, role: account.role }))
  }, { state, account })
  await page.goto('/')
  await expect(page.locator('.app-root')).toBeVisible()
}
async function workspace(page: Page, role: Role) {
  if (role === 'admin') {
    await page.getByRole('button', { name: 'จัดการระบบ', exact: true }).filter({ visible: true }).first().click()
    await page.getByRole('button', { name: /ภาคเรียนและการแก้ไขคะแนน/ }).filter({ visible: true }).first().click()
  } else {
    const label = role === 'teacher' ? 'ภาคเรียนเดิม' : role === 'student' ? 'แต่ละภาคเรียน' : 'ภาคเรียน'
    if (!(await page.getByRole('button', { name: label, exact: true }).filter({ visible: true }).count())) {
      await page.getByRole('button', { name: 'เพิ่มเติม', exact: true }).click()
    }
    await page.getByRole('button', { name: label, exact: true }).filter({ visible: true }).first().click()
  }
  await expect(page.getByLabel('เลือกภาคเรียน')).toBeVisible()
}
async function changeRole(page: Page, state: DemoState, role: Role) {
  await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).filter({ visible: true }).first().click()
  const account = state.accounts.find(account => account.role === role)!
  await page.getByLabel('ชื่อผู้ใช้ / รหัสนักเรียน').fill(account.username)
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click()
  await expect(page.locator('.app-root')).toBeVisible()
}
async function saved(page: Page): Promise<DemoState> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('school-point:demo:v2')!))
}

test('starts Term 2 at 100 and completes original-term remediation without changing the new 95-point balance', async ({ page }, testInfo) => {
  const state = fixture()
  const student = state.students[0]!
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await seed(page, state)
  await workspace(page, 'admin')
  const prepare = page.getByRole('form', { name: 'เตรียมภาคเรียนถัดไป' })
  await prepare.getByLabel('วันเปิดภาคเรียน', { exact: true }).fill(dateOffset(0))
  await prepare.getByLabel('วันปิดภาคเรียน', { exact: true }).fill(dateOffset(90))
  await prepare.getByRole('button', { name: 'เตรียมภาคเรียนถัดไป', exact: true }).click()
  await page.getByRole('checkbox', { name: /ตรวจรายชื่อแล้ว/ }).check()
  await page.getByRole('button', { name: 'ปิดภาคเรียนเดิมและเปิดภาคเรียนใหม่', exact: true }).click()
  await expect(page.locator('.term-chip')).toContainText('2/2569')
  expect((await saved(page)).students.find(item => item.id === student.id)!.score).toBe(100)
  await page.reload()
  await expect(page.locator('.term-chip')).toContainText('2/2569')

  await changeRole(page, state, 'teacher')
  await page.getByRole('button', { name: 'ตัดคะแนน', exact: true }).filter({ visible: true }).first().click()
  await page.getByRole('button', { name: 'ตรวจสอบก่อนยืนยัน', exact: true }).click()
  await page.getByRole('button', { name: 'ยืนยันตัดคะแนน 1 คน', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'ตัดคะแนนจริงรวม 5 คะแนน', exact: true })).toBeVisible()
  expect((await saved(page)).students.find(item => item.id === student.id)!.score).toBe(95)
  await workspace(page, 'teacher')
  const caseCard = page.getByRole('article', { name: `เคสแก้ไขคะแนน ${student.name}`, exact: true })
  await expect(caseCard).toContainText('70 / 80')
  await caseCard.getByRole('button', { name: 'ขอเพิ่มคะแนนแก้ไข' }).click()
  await caseCard.getByLabel('รายละเอียดกิจกรรมแก้ไขพฤติกรรม').fill('ทำกิจกรรมจิตอาสาตามแผนแก้ไขครบแล้ว')
  await caseCard.getByRole('button', { name: 'ส่งคำขอให้ผู้ดูแลอนุมัติ' }).click()
  await expect(caseCard).toContainText('รออนุมัติ')

  await changeRole(page, state, 'admin')
  await workspace(page, 'admin')
  const adminCase = page.getByRole('article', { name: `เคสแก้ไขคะแนน ${student.name}`, exact: true })
  await adminCase.getByRole('button', { name: 'อนุมัติ', exact: true }).click()
  await page.getByRole('checkbox', { name: /แสดงเคสที่ผ่านเกณฑ์แล้ว/ }).check()
  await expect(adminCase).toContainText('ผ่านเกณฑ์แล้ว')
  await expect(adminCase).toContainText('80 / 80')
  const after = await saved(page)
  expect(after.students.find(item => item.id === student.id)!.score).toBe(95)
  expect(after.termRecords!.snapshots.find(item => item.studentId === student.id)).toMatchObject({ closingScore: 70, latestScore: 80 })
  expect(after.transactions.filter(item => item.remediationRequestId)).toHaveLength(1)
  await page.getByLabel('เลือกภาคเรียน').selectOption(state.term.id)
  await expect(page.locator('.term-history-panel')).toContainText('คะแนนล่าสุดของภาคนี้')
  await page.screenshot({ path: testInfo.outputPath('term1-remediation-passed-desktop.png'), fullPage: true })

  await changeRole(page, state, 'student')
  await workspace(page, 'student')
  await page.getByLabel('เลือกภาคเรียน').selectOption(state.term.id)
  await expect(page.locator('.term-history-panel')).toContainText('80')
  await expect(page.locator('.term-history-panel')).not.toContainText(state.students[1]!.name)
  await expect(page.getByRole('button', { name: 'ขอเพิ่มคะแนนแก้ไข' })).toHaveCount(0)
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('blocks a transition with pending ordinary score requests and preserves the original term', async ({ page }) => {
  const state = fixture()
  state.additionRequests = createDemoState().additionRequests
  await seed(page, state)
  await workspace(page, 'admin')
  const form = page.getByRole('form', { name: 'เตรียมภาคเรียนถัดไป' })
  await form.getByLabel('วันเปิดภาคเรียน', { exact: true }).fill(dateOffset(0))
  await form.getByLabel('วันปิดภาคเรียน', { exact: true }).fill(dateOffset(90))
  await form.getByRole('button', { name: 'เตรียมภาคเรียนถัดไป', exact: true }).click()
  await expect(page.getByText('ยังมีคำขอเพิ่มคะแนนรอพิจารณา', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ปิดภาคเรียนเดิมและเปิดภาคเรียนใหม่', exact: true })).toBeDisabled()
  const after = await saved(page)
  expect(after.term.id).toBe(state.term.id)
  expect(after.students[0]!.score).toBe(70)
  expect(after.termRecords!.snapshots).toHaveLength(0)
})

test('keeps outstanding pupils who left the new roster and restricts the director to reading', async ({ page }) => {
  const state = closedFixture()
  const departed = state.students.shift()!
  await seed(page, state, 'director')
  await workspace(page, 'director')
  await expect(page.getByRole('article', { name: `เคสแก้ไขคะแนน ${departed.name}`, exact: true })).toContainText('ไม่อยู่ในรายชื่อภาคเรียนปัจจุบัน')
  await expect(page.getByRole('button', { name: 'ขอเพิ่มคะแนนแก้ไข' })).toHaveCount(0)
  await expect(page.getByRole('form', { name: 'เตรียมภาคเรียนถัดไป' })).toHaveCount(0)
  await page.getByLabel('เลือกภาคเรียน').selectOption('term-2569-1')
  await expect(page.locator('.term-history-panel')).toContainText(departed.name)
})

test('exposes semester history and existing profile controls on mobile without overflow', async ({ page }, testInfo) => {
  const state = closedFixture()
  await page.setViewportSize({ width: 390, height: 844 })
  await seed(page, state, 'teacher')
  await workspace(page, 'teacher')
  await expect(page.locator('.remediation-case')).toHaveCount(1)
  await page.getByRole('button', { name: 'เพิ่มเติม', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'เมนูทั้งหมด', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'เมนูทั้งหมด', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('teacher-term-history-mobile.png'), fullPage: true })
  await changeRole(page, state, 'student')
  await workspace(page, 'student')
  await page.getByRole('button', { name: 'เพิ่มเติม', exact: true }).click()
  await page.getByRole('button', { name: 'รูปโปรไฟล์', exact: true }).filter({ visible: true }).click()
  await expect(page.getByRole('heading', { name: 'รูปโปรไฟล์ของฉัน', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true)
})
