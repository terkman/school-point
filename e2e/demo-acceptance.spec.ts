import { expect, test, type Page } from '@playwright/test'

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const

function collectBrowserErrors(page: Page) {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

async function expectHealthyScreen(page: Page) {
  await expect(page.locator('#root')).not.toBeEmpty()
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  await expect(page.getByText('Internal Server Error')).toHaveCount(0)
  await expect(page.getByText('เปิดหน้าตามบทบาทไม่สำเร็จ')).toHaveCount(0)
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(widths.scrollWidth).toBeLessThanOrEqual(widths.clientWidth + 1)
}

async function signInAsDemoAdmin(page: Page) {
  await page.getByRole('button', { name: /ผู้ดูแลระบบ admin\.demo/ }).click()
  await expect(page.getByLabel('ชื่อผู้ใช้ / รหัสนักเรียน')).toHaveValue('admin.demo')
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  await expect(page.getByRole('button', { name: 'ออกจากระบบ' }).first()).toBeVisible()
}

async function signInAsDemoRole(page: Page, account: RegExp) {
  await page.getByRole('button', { name: account }).click()
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  await expect(page.getByRole('button', { name: 'ออกจากระบบ' }).first()).toBeVisible()
}

async function signOutOfDemo(page: Page) {
  await page.getByRole('button', { name: 'ออกจากระบบ' }).first().click()
  await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeVisible()
}

test.describe('demo acceptance smoke checks', () => {
  test('renders the login screen without a blank page, overlay, or browser errors at target viewports', async ({ page }) => {
    const errors = collectBrowserErrors(page)

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await expectHealthyScreen(page)
      await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบ' })).toBeVisible()
      await expectNoHorizontalOverflow(page)
    }

    expect(errors).toEqual([])
  })

  test('keeps the active demo dashboard rendered after backgrounding and foregrounding its tab', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    const errors = collectBrowserErrors(page)
    await page.goto('/')
    await signInAsDemoAdmin(page)

    const backgroundTab = await context.newPage()
    await backgroundTab.goto('/')
    await backgroundTab.bringToFront()
    await page.bringToFront()

    await expectHealthyScreen(page)
    await expect(page.getByText('รายการคะแนนล่าสุด')).toBeVisible()
    await expect(page.getByText('กำลังโหลดข้อมูลโรงเรียน')).toHaveCount(0)
    await expect(page.getByText('กำลังเปิดหน้าของคุณ')).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
    expect(errors).toEqual([])
    await context.close()
  })

  test('responds to an admin navigation interaction on the narrow mobile viewport', async ({ page }) => {
    const errors = collectBrowserErrors(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await signInAsDemoAdmin(page)

    await page.getByRole('button', { name: 'ระบบ', exact: true }).click()
    await expectHealthyScreen(page)
    await expect(page.getByRole('heading', { name: 'จัดการระบบ' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    expect(errors).toEqual([])
  })

  test('shows a complete student-code-sorted grade roster across target viewports', async ({ page }) => {
    const errors = collectBrowserErrors(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await signInAsDemoAdmin(page)
    await page.getByRole('button', { name: 'สถิติ', exact: true }).click()
    await page.getByRole('combobox', { name: 'ระดับชั้นสำหรับสถิติ' }).selectOption('M2')

    const roster = page.getByRole('table', { name: 'รายชื่อนักเรียน ม.2 เรียงตามรหัสนักเรียน' })
    await expect(roster).toBeVisible()
    await expect(roster.locator('.analytics-student-entry')).toHaveCount(3)
    await expect(roster.locator('.analytics-student-name small')).toHaveText([
      /รหัส 69001/,
      /รหัส 69002/,
      /รหัส 69003/,
    ])
    await expect(roster.getByText('ไม่มีรายการในช่วงนี้')).toBeVisible()

    await roster.getByRole('button', { name: 'ดูประวัติของ นักเรียนตัวอย่าง 02' }).click()
    await expect(roster.getByText('นักเรียนคนนี้ไม่มีรายการคะแนนในช่วงที่เลือก')).toBeVisible()
    await page.getByRole('combobox', { name: 'ประเภทคะแนน' }).selectOption('addition')
    await expect(roster.locator('.analytics-student-entry')).toHaveCount(3)

    for (const viewport of viewports) {
      await page.setViewportSize(viewport)
      await expect(roster).toBeVisible()
      await expect(roster.getByText('นักเรียนตัวอย่าง 01', { exact: true })).toBeVisible()
      await expect(roster.getByText('นักเรียนตัวอย่าง 02', { exact: true })).toBeVisible()
      await expect(roster.getByText('นักเรียนตัวอย่าง 03', { exact: true })).toBeVisible()
      await expectNoHorizontalOverflow(page)
    }

    expect(errors).toEqual([])
  })

  test('carries a teacher deduction and addition request through admin approval to student history and appeal submission', async ({ page }) => {
    const errors = collectBrowserErrors(page)
    const positiveRule = 'อุทิศตนและเสียสละช่วยงานโรงเรียนหรืองานครูจนเป็นที่ยอมรับ'
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    await signInAsDemoRole(page, /คุณครู teacher\.demo/)
    await page.getByRole('button', { name: 'ตัดคะแนน' }).first().click()
    await expect(page.getByRole('heading', { name: 'ตัดคะแนนนักเรียน' })).toBeVisible()
    await page.getByRole('button', { name: 'ตรวจสอบก่อนยืนยัน' }).click()
    await page.getByRole('button', { name: 'ยืนยันตัดคะแนน 1 คน' }).click()
    await expect(page.getByRole('heading', { name: 'ตัดคะแนนจริงรวม 2 คะแนน' })).toBeVisible()

    await page.getByRole('button', { name: 'เพิ่มคะแนน' }).first().click()
    await expect(page.getByRole('heading', { name: 'สร้างคำขอเพิ่มคะแนน' })).toBeVisible()
    await page.getByLabel('เหตุผลในการเพิ่มคะแนน').selectOption({ label: positiveRule })
    await page.getByLabel('รายละเอียดเพิ่มเติม (ไม่บังคับ)').fill('E2E: ช่วยงานโรงเรียนครบถ้วน')
    await page.getByRole('button', { name: 'ส่งคำขอ 1 คนให้แอดมินตรวจสอบ' }).click()
    await expect(page.getByText('ส่งคำขอสำเร็จ 1 คน')).toBeVisible()

    await signOutOfDemo(page)
    await signInAsDemoAdmin(page)
    await page.getByRole('button', { name: /งานรอตรวจ/ }).first().click()
    await page.getByRole('tab', { name: /ขอเพิ่มคะแนน/ }).click()
    await page.getByRole('button', { name: new RegExp(positiveRule) }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: 'อนุมัติ +10 คะแนน' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    await signOutOfDemo(page)
    await signInAsDemoRole(page, /นักเรียน 69001/)
    await expect(page.locator('.score-ring strong')).toHaveText('100')
    await page.getByRole('button', { name: 'ประวัติคะแนน' }).first().click()
    await expect(page.getByText(positiveRule)).toBeVisible()
    await page.getByRole('button', { name: 'ยื่นอุทธรณ์' }).first().click()
    await expect(page.getByRole('heading', { name: 'ยื่นคำอุทธรณ์' })).toBeVisible()
    await page.getByLabel('เหตุผลการอุทธรณ์').fill('E2E: ขอให้ตรวจสอบข้อเท็จจริงของรายการตัดคะแนนนี้อีกครั้ง')
    await page.getByRole('button', { name: 'ส่งคำอุทธรณ์' }).click()
    await expect(page.getByText('ส่งคำอุทธรณ์เรียบร้อยแล้ว')).toHaveCount(1)
    await expect(page.getByRole('heading', { name: 'คำอุทธรณ์ของฉัน' })).toBeVisible()
    await expect(page.getByText('อยู่ระหว่างพิจารณา').first()).toBeVisible()
    await expectHealthyScreen(page)
    expect(errors).toEqual([])
  })

  test('carries a teacher rule proposal through admin approval and versioned editing', async ({ page }) => {
    const errors = collectBrowserErrors(page)
    const proposedTitle = 'ทิ้งขยะนอกจุดที่กำหนด'
    const revisedTitle = 'ทิ้งขยะไม่ถูกจุดที่โรงเรียนกำหนด'
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')

    await signInAsDemoRole(page, /คุณครู teacher\.demo/)
    await page.getByRole('button', { name: /เสนอเกณฑ์/ }).first().click()
    await expect(page.getByRole('heading', { name: 'สร้างข้อเสนอเกณฑ์คะแนน' })).toBeVisible()
    await page.getByLabel(/ชื่อเกณฑ์/).fill(proposedTitle)
    await page.getByLabel('จำนวนคะแนนที่เสนอให้ตัด').fill('8')
    await page.getByRole('button', { name: 'ส่งข้อเสนอให้แอดมิน' }).click()
    await expect(page.getByText('ส่งข้อเสนอเกณฑ์ให้แอดมินตรวจสอบแล้ว')).toBeVisible()
    await expect(page.getByRole('article').filter({ hasText: proposedTitle })).toBeVisible()

    await signOutOfDemo(page)
    await signInAsDemoAdmin(page)
    await page.getByRole('button', { name: 'จัดการระบบ', exact: true }).click()
    await page.getByRole('button', { name: /เกณฑ์คะแนน/ }).click()
    const proposal = page.locator('.rule-proposal-row').filter({ hasText: proposedTitle })
    await expect(proposal).toBeVisible()
    await proposal.getByRole('button', { name: 'อนุมัติ', exact: true }).click()
    await proposal.getByRole('button', { name: 'ยืนยันอนุมัติ' }).click()

    const publishedRule = page.locator('.rule-catalog-row').filter({ hasText: proposedTitle })
    await expect(publishedRule).toBeVisible()
    await publishedRule.getByRole('button', { name: 'แก้ไข' }).click()
    await page.getByLabel(/ชื่อเกณฑ์/).fill(revisedTitle)
    await page.getByRole('button', { name: 'บันทึกเป็นรุ่นใหม่' }).click()
    await expect(page.locator('.rule-catalog-row').filter({ hasText: revisedTitle })).toBeVisible()
    await expect(page.locator('.rule-catalog-row').filter({ hasText: proposedTitle })).toHaveCount(0)
    await expectHealthyScreen(page)
    expect(errors).toEqual([])
  })
})
