import { useMemo, useState } from 'react'
import type { CreateBehaviorRuleInput, CreatePositiveRuleInput } from './dataActions'
import type { BehaviorRule, PositiveBehaviorRule } from './domain'
import { EmptyState, Icon, StatusBadge } from './ui'

type RuleTab = 'deduction' | 'addition'

interface AdminRuleCatalogProps {
  deductionRules: BehaviorRule[]
  positiveRules: PositiveBehaviorRule[]
  busy: boolean
  onCreateBehavior: (input: CreateBehaviorRuleInput) => Promise<void>
  onCreatePositive: (input: CreatePositiveRuleInput) => Promise<void>
  onRemoveBehavior: (rule: BehaviorRule) => Promise<void>
  onRemovePositive: (rule: PositiveBehaviorRule) => Promise<void>
}

function pointPolicy(points: number) {
  if (points >= 50) return { label: 'ร้ายแรงมาก', severity: 'critical' as const, guardian: true }
  if (points >= 25) return { label: 'ร้ายแรง', severity: 'serious' as const, guardian: true }
  if (points >= 10) return { label: 'ปานกลาง', severity: 'medium' as const, guardian: false }
  return { label: 'ขั้นเบา', severity: 'low' as const, guardian: false }
}

export function AdminRuleCatalog({
  deductionRules,
  positiveRules,
  busy,
  onCreateBehavior,
  onCreatePositive,
  onRemoveBehavior,
  onRemovePositive,
}: AdminRuleCatalogProps) {
  const [tab, setTab] = useState<RuleTab>('deduction')
  const [query, setQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [points, setPoints] = useState(5)
  const [discretionary, setDiscretionary] = useState(false)
  const [confirmId, setConfirmId] = useState('')
  const [error, setError] = useState('')
  const activeDeductions = useMemo(() => deductionRules.filter((rule) => rule.active), [deductionRules])
  const activePositives = useMemo(() => positiveRules.filter((rule) => rule.active), [positiveRules])
  const normalizedQuery = query.trim().toLocaleLowerCase('th')
  const visibleDeductions = activeDeductions.filter((rule) => `${rule.code ?? ''} ${rule.title} ${rule.category}`.toLocaleLowerCase('th').includes(normalizedQuery))
  const visiblePositives = activePositives.filter((rule) => `${rule.code} ${rule.title} ${rule.category}`.toLocaleLowerCase('th').includes(normalizedQuery))
  const policy = pointPolicy(points)

  function resetForm() {
    setTitle('')
    setDescription('')
    setPoints(tab === 'deduction' ? 5 : 10)
    setDiscretionary(false)
    setShowForm(false)
    setError('')
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const normalizedTitle = title.trim()
    if (normalizedTitle.length < 3) {
      setError('กรุณาระบุชื่อเกณฑ์อย่างน้อย 3 ตัวอักษร')
      return
    }
    if (!Number.isInteger(points) || points < 1 || points > 100) {
      setError('คะแนนต้องเป็นจำนวนเต็มตั้งแต่ 1 ถึง 100')
      return
    }
    setError('')
    try {
      if (tab === 'deduction') {
        await onCreateBehavior({ title: normalizedTitle, points, description: description.trim() || undefined })
      } else {
        await onCreatePositive({ title: normalizedTitle, points, discretionary, description: description.trim() || undefined })
      }
      resetForm()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'ไม่สามารถเพิ่มเกณฑ์ได้')
    }
  }

  async function removeBehavior(rule: BehaviorRule) {
    if (confirmId !== `deduction:${rule.id}`) {
      setConfirmId(`deduction:${rule.id}`)
      return
    }
    setError('')
    try {
      await onRemoveBehavior(rule)
      setConfirmId('')
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'ไม่สามารถนำเกณฑ์ออกได้')
    }
  }

  async function removePositive(rule: PositiveBehaviorRule) {
    if (confirmId !== `addition:${rule.id}`) {
      setConfirmId(`addition:${rule.id}`)
      return
    }
    setError('')
    try {
      await onRemovePositive(rule)
      setConfirmId('')
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'ไม่สามารถนำเกณฑ์ออกได้')
    }
  }

  return (
    <div className="rule-catalog-page">
      <section className="rule-catalog-toolbar panel">
        <div className="section-heading">
          <div><p className="eyebrow">ระเบียบที่ครูเลือกใช้</p><h2>เกณฑ์คะแนน</h2></div>
          <button type="button" className="button primary compact" disabled={busy} onClick={() => { setShowForm((value) => !value); setConfirmId(''); setError('') }}>
            <Icon name="plus" size={17} /> เพิ่มเกณฑ์
          </button>
        </div>
        <p className="form-help">รหัสเกณฑ์สร้างให้อัตโนมัติ การนำเกณฑ์ที่เคยใช้ออกจะซ่อนจากครู แต่ประวัติคะแนนเดิมยังคงอยู่</p>
        <div className="rule-catalog-tabs" role="tablist" aria-label="ประเภทเกณฑ์">
          <button type="button" role="tab" aria-selected={tab === 'deduction'} className={tab === 'deduction' ? 'active' : ''} onClick={() => { setTab('deduction'); setShowForm(false); setConfirmId(''); setQuery('') }}>เกณฑ์ตัดคะแนน <b>{activeDeductions.length}</b></button>
          <button type="button" role="tab" aria-selected={tab === 'addition'} className={tab === 'addition' ? 'active' : ''} onClick={() => { setTab('addition'); setShowForm(false); setConfirmId(''); setQuery('') }}>เกณฑ์เพิ่มคะแนน <b>{activePositives.length}</b></button>
        </div>
      </section>

      {showForm ? (
        <form className="panel rule-create-form" onSubmit={submit} noValidate>
          <div className="section-heading"><div><p className="eyebrow">รายการใหม่</p><h2>{tab === 'deduction' ? 'เพิ่มเกณฑ์ตัดคะแนน' : 'เพิ่มเกณฑ์เพิ่มคะแนน'}</h2></div></div>
          <label>ชื่อเกณฑ์ <b>จำเป็น</b><input value={title} maxLength={300} disabled={busy} onChange={(event) => { setTitle(event.target.value); setError('') }} placeholder={tab === 'deduction' ? 'เช่น ไม่ปฏิบัติตามหน้าที่ที่ได้รับมอบหมาย' : 'เช่น ช่วยเหลืองานส่วนรวม'} /></label>
          <div className="rule-form-grid">
            <label>{tab === 'deduction' ? 'จำนวนคะแนนที่ตัด' : discretionary ? 'คะแนนสูงสุดที่ครูกำหนดได้' : 'จำนวนคะแนนที่เพิ่ม'}
              <input type="number" min="1" max="100" step="1" value={points} disabled={busy} onChange={(event) => { setPoints(Number(event.target.value)); setError('') }} />
            </label>
            {tab === 'deduction' ? (
              <div className="rule-policy-preview"><StatusBadge severity={policy.severity} /><span>{points >= 10 ? 'ต้องผ่านแอดมินก่อนมีผล' : 'บันทึกได้ตามสิทธิ์'}</span>{policy.guardian ? <small>เปิดเคสแจ้งผู้ปกครอง</small> : null}</div>
            ) : (
              <label className="confirmation-check rule-discretionary-check"><input type="checkbox" checked={discretionary} disabled={busy} onChange={(event) => setDiscretionary(event.target.checked)} /><span>ให้ครูกำหนดคะแนนเองได้ไม่เกินจำนวนนี้</span></label>
            )}
          </div>
          <label>คำอธิบายเพิ่มเติม (ไม่บังคับ)<textarea value={description} maxLength={2000} disabled={busy} onChange={(event) => setDescription(event.target.value)} placeholder="ระบุขอบเขตหรือตัวอย่างเพื่อช่วยให้ครูเลือกเกณฑ์ได้ถูกต้อง" /></label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={resetForm}>ยกเลิก</button><button type="submit" className="button primary" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'เพิ่มเกณฑ์'}</button></div>
        </form>
      ) : null}

      <section className="panel rule-list-panel">
        <label className="search-label"><span className="sr-only">ค้นหาเกณฑ์</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อหรือรหัสเกณฑ์" /></label>
        {error && !showForm ? <p className="form-error" role="alert">{error}</p> : null}
        {tab === 'deduction' ? (
          visibleDeductions.length ? <div className="rule-catalog-list">{visibleDeductions.map((rule) => (
            <article className="rule-catalog-row" key={rule.id}>
              <div><span className="rule-code">{rule.code ?? `D-${rule.id}`}</span><strong>{rule.title}</strong><small>{rule.description || rule.category}</small></div>
              <div className="rule-row-meta"><StatusBadge severity={rule.severity} /><b className="negative">−{rule.points}</b></div>
              <button type="button" className={confirmId === `deduction:${rule.id}` ? 'button reject compact' : 'button ghost compact'} disabled={busy} onClick={() => void removeBehavior(rule)}>{confirmId === `deduction:${rule.id}` ? 'ยืนยันลบ' : 'ลบ'}</button>
            </article>
          ))}</div> : <EmptyState title="ไม่พบเกณฑ์ตัดคะแนน" detail="ลองเปลี่ยนคำค้นหรือเพิ่มเกณฑ์ใหม่" />
        ) : (
          visiblePositives.length ? <div className="rule-catalog-list">{visiblePositives.map((rule) => (
            <article className="rule-catalog-row" key={rule.id}>
              <div><span className="rule-code">{rule.code}</span><strong>{rule.title}</strong><small>{rule.description || rule.category}</small></div>
              <div className="rule-row-meta"><span className="badge status-approved">{rule.discretionary ? `กำหนดได้ถึง +${rule.maxPoints}` : `คงที่ +${rule.defaultPoints}`}</span></div>
              <button type="button" className={confirmId === `addition:${rule.id}` ? 'button reject compact' : 'button ghost compact'} disabled={busy} onClick={() => void removePositive(rule)}>{confirmId === `addition:${rule.id}` ? 'ยืนยันลบ' : 'ลบ'}</button>
            </article>
          ))}</div> : <EmptyState title="ไม่พบเกณฑ์เพิ่มคะแนน" detail="ลองเปลี่ยนคำค้นหรือเพิ่มเกณฑ์ใหม่" />
        )}
      </section>
    </div>
  )
}
