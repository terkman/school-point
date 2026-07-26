import { useEffect, useMemo, useState } from 'react'
import type { BehaviorRule, PositiveBehaviorRule } from './domain'
import { Icon, StatusBadge } from './ui'

export type ScoreRulesDialogTab = 'deduction' | 'addition'

interface DeductionRuleSelectProps {
  rules: BehaviorRule[]
  value: string
  disabled: boolean
  onChange: (ruleId: string) => void
}

export function DeductionRuleSelect({
  rules,
  value,
  disabled,
  onChange,
}: DeductionRuleSelectProps) {
  return (
    <>
      <label>เกณฑ์การตัดคะแนน
        <select
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
        >
          <option value="" disabled>เลือกเกณฑ์</option>
          {rules.map((rule) => (
            <option key={rule.id} value={rule.id}>−{rule.points} • {rule.title}</option>
          ))}
        </select>
      </label>
      {rules.length === 0
        ? <p className="form-error">ยังไม่มีเกณฑ์การตัดคะแนนที่เปิดใช้งาน</p>
        : null}
    </>
  )
}

interface ScoreRulesDialogProps {
  initialTab: ScoreRulesDialogTab
  deductionRules: BehaviorRule[]
  positiveRules: PositiveBehaviorRule[]
  onClose: () => void
}

function includesSearch(parts: Array<string | number | null | undefined>, search: string): boolean {
  if (!search) return true
  return parts.some((part) => String(part ?? '').toLocaleLowerCase('th-TH').includes(search))
}

export function ScoreRulesDialog({
  initialTab,
  deductionRules,
  positiveRules,
  onClose,
}: ScoreRulesDialogProps) {
  const [tab, setTab] = useState<ScoreRulesDialogTab>(initialTab)
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase('th-TH')
  const filteredDeductionRules = useMemo(
    () => deductionRules
      .filter((rule) => includesSearch(
        [rule.title, rule.category, rule.points],
        normalizedQuery,
      ))
      .sort((left, right) => left.points - right.points
        || left.category.localeCompare(right.category, 'th')
        || left.title.localeCompare(right.title, 'th')),
    [deductionRules, normalizedQuery],
  )
  const filteredPositiveRules = useMemo(
    () => positiveRules
      .filter((rule) => includesSearch(
        [rule.code, rule.title, rule.category, rule.description, rule.defaultPoints, rule.maxPoints],
        normalizedQuery,
      ))
      .sort((left, right) => left.code.localeCompare(right.code, 'th', { numeric: true })),
    [positiveRules, normalizedQuery],
  )
  const visibleCount = tab === 'deduction' ? filteredDeductionRules.length : filteredPositiveRules.length

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [onClose])

  function changeTab(nextTab: ScoreRulesDialogTab) {
    setTab(nextTab)
    setQuery('')
  }

  return (
    <div
      className="score-rules-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        className="score-rules-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="score-rules-dialog-title"
      >
        <header className="score-rules-dialog-header">
          <div>
            <p className="eyebrow">ระเบียบที่ใช้ในระบบ</p>
            <h2 id="score-rules-dialog-title">เกณฑ์เพิ่มและตัดคะแนน</h2>
          </div>
          <button
            type="button"
            className="score-rules-dialog-close"
            onClick={onClose}
            aria-label="ปิดหน้าต่างระเบียบ"
            autoFocus
          >
            ×
          </button>
        </header>

        <div className="score-rules-tabs" role="tablist" aria-label="ประเภทระเบียบคะแนน">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'deduction'}
            className={tab === 'deduction' ? 'active deduction' : ''}
            onClick={() => changeTab('deduction')}
          >
            เกณฑ์ตัดคะแนน <span>{deductionRules.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'addition'}
            className={tab === 'addition' ? 'active addition' : ''}
            onClick={() => changeTab('addition')}
          >
            เกณฑ์เพิ่มคะแนน <span>{positiveRules.length}</span>
          </button>
        </div>

        <label className="score-rules-search">
          ค้นหาระเบียบ
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tab === 'deduction'
              ? 'ค้นหาชื่อ ประเภท หรือจำนวนคะแนนที่ตัด'
              : 'ค้นหารหัส ชื่อกิจกรรม หรือจำนวนคะแนนที่เพิ่ม'}
          />
        </label>

        <div className="score-rules-dialog-meta" role="status">
          พบ {visibleCount} รายการ
        </div>

        <div className="score-rules-dialog-list">
          {tab === 'deduction' ? filteredDeductionRules.map((rule) => (
            <article className="score-rule-dialog-row deduction" key={rule.id}>
              <div className="score-rule-dialog-copy">
                <strong>{rule.title}</strong>
                <small>{rule.category}</small>
                <div className="score-rule-dialog-badges">
                  <StatusBadge severity={rule.severity} />
                  {rule.guardianContactRequired
                    ? <span className="badge status-rejected">แจ้งผู้ปกครอง</span>
                    : null}
                  {!rule.active ? <span className="badge">ปิดใช้งาน</span> : null}
                </div>
              </div>
              <b className="score-rule-dialog-points deduction">−{rule.points}</b>
            </article>
          )) : filteredPositiveRules.map((rule) => (
            <article className="score-rule-dialog-row addition" key={rule.id}>
              <div className="score-rule-dialog-copy">
                <div className="score-rule-dialog-title">
                  <span className="badge status-approved">{rule.code}</span>
                  <strong>{rule.title}</strong>
                </div>
                <small>{rule.description || rule.category}</small>
                {!rule.active ? <span className="badge">ปิดใช้งาน</span> : null}
              </div>
              <b className="score-rule-dialog-points addition">
                {rule.discretionary ? `1–${rule.maxPoints}` : `+${rule.defaultPoints ?? 0}`}
              </b>
            </article>
          ))}
          {visibleCount === 0 ? (
            <div className="score-rules-dialog-empty">
              <Icon name="book" size={28} />
              <strong>ไม่พบระเบียบตามคำค้น</strong>
              <span>ลองใช้คำค้นที่สั้นลง หรือสลับไปดูระเบียบอีกประเภท</span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}
