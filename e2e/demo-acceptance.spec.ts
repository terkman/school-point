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
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  await expect(page.getByRole('main')).toBeVisible()
}

async function signInAsDemoRole(page: Page, account: RegExp) {
  await page.getByRole('button', { name: account }).click()
  await page.getByRole('button', { name: 'เข้าสู่ระบบ' }).click()
  await expect(page.getByRole('main')).toBeVisible()
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

    await page.getByRole('button', { name: 'ระบบ' }).last().click()
    await expectHealthyScreen(page)
    await expect(page.getByRole('heading', { name: 'จัดการระบบ' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
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
})
