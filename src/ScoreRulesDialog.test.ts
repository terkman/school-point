import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createDemoState } from './demoData'
import { DeductionRuleSelect, PositiveRuleSelect, ScoreRulesDialog } from './ScoreRulesDialog'

describe('admin score rules controls', () => {
  it('renders deduction rules as a dropdown', () => {
    const demo = createDemoState()
    const activeRules = demo.rules.filter((rule) => rule.active)
    const markup = renderToStaticMarkup(createElement(DeductionRuleSelect, {
      rules: activeRules,
      value: activeRules[0]?.id ?? '',
      disabled: false,
      onChange: () => undefined,
    }))

    expect(markup).toContain('เหตุผลในการตัดคะแนน')
    expect(markup).toContain('<select')
    expect(markup).toContain('<option')
    expect(markup).toContain(activeRules[0]?.title ?? '')
    expect(markup).not.toContain(`−${activeRules[0]?.points} •`)
    expect(markup).not.toContain('rule-option')
  })

  it('shows only the reason title in the addition dropdown', () => {
    const demo = createDemoState()
    const activeRules = demo.positiveRules.filter((rule) => rule.active)
    const markup = renderToStaticMarkup(createElement(PositiveRuleSelect, {
      rules: activeRules,
      value: activeRules[0]?.id ?? '',
      disabled: false,
      onChange: () => undefined,
    }))

    expect(markup).toContain('เหตุผลในการเพิ่มคะแนน')
    expect(markup).toContain(activeRules[0]?.title ?? '')
    expect(markup).not.toContain(`${activeRules[0]?.code} •`)
  })

  it('shows both deduction and addition rule tabs in the popup', () => {
    const demo = createDemoState()
    const markup = renderToStaticMarkup(createElement(ScoreRulesDialog, {
      initialTab: 'deduction',
      deductionRules: demo.rules,
      positiveRules: demo.positiveRules,
      onClose: () => undefined,
    }))

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('เกณฑ์ตัดคะแนน')
    expect(markup).toContain('เกณฑ์เพิ่มคะแนน')
    expect(markup).toContain('ค้นหาระเบียบ')
    expect(markup).toContain('ปิดหน้าต่างระเบียบ')
  })
})
