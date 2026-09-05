import { useMemo, useState } from 'react'
import type { CreateBehaviorRuleInput, CreatePositiveRuleInput, ReviewRuleProposalInput, UpdateBehaviorRuleInput, UpdatePositiveRuleInput } from './dataActions'
import type { BehaviorRule, PositiveBehaviorRule, RuleProposal } from './domain'
import { EmptyState, Icon, StatusBadge } from './ui'

type RuleTab = 'deduction' | 'addition'

interface AdminRuleCatalogProps {
  deductionRules: BehaviorRule[]
  positiveRules: PositiveBehaviorRule[]
  proposals: RuleProposal[]
  busy: boolean
  onCreateBehavior: (input: CreateBehaviorRuleInput) => Promise<void>
  onCreatePositive: (input: CreatePositiveRuleInput) => Promise<void>
  onUpdateBehavior: (input: UpdateBehaviorRuleInput) => Promise<void>
  onUpdatePositive: (input: UpdatePositiveRuleInput) => Promise<void>
  onReviewProposal: (input: ReviewRuleProposalInput) => Promise<void>
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
  proposals,
  busy,
  onCreateBehavior,
  onCreatePositive,
  onUpdateBehavior,
  onUpdatePositive,
  onReviewProposal,
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
  const [editingId, setEditingId] = useState('')
  const [reviewId, setReviewId] = useState('')
  const [reviewDecision, setReviewDecision] = useState<'approve' | 'reject'>('approve')
  const [reviewNote, setReviewNote] = useState('')
  const [error, setError] = useState('')
  const activeDeductions = useMemo(() => deductionRules.filter((rule) => rule.active), [deductionRules])
  const activePositives = useMemo(() => positiveRules.filter((rule) => rule.active), [positiveRules])
  const normalizedQuery = query.trim().toLocaleLowerCase('th')
  const visibleDeductions = activeDeductions.filter((rule) => `${rule.code ?? ''} ${rule.title} ${rule.category}`.toLocaleLowerCase('th').includes(normalizedQuery))
  const visiblePositives = activePositives.filter((rule) => `${rule.code} ${rule.title} ${rule.category}`.toLocaleLowerCase('th').includes(normalizedQuery))
  const policy = pointPolicy(points)
  const pendingProposals = proposals.filter((proposal) => proposal.status === 'pending')

  function resetForm() {
    setTitle('')
    setDescription('')
    setPoints(tab === 'deduction' ? 5 : 10)
    setDiscretionary(false)
    setShowForm(false)
    setEditingId('')
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
        if (editingId) await onUpdateBehavior({ ruleId: editingId, title: normalizedTitle, points, description: description.trim() || undefined })
        else await onCreateBehavior({ title: normalizedTitle, points, description: description.trim() || undefined })
      } else {
        if (editingId) await onUpdatePositive({ ruleId: editingId, title: normalizedTitle, points, discretionary, description: description.trim() || undefined })
        else await onCreatePositive({ title: normalizedTitle, points, discretionary, description: description.trim() || undefined })
      }
      resetForm()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'ไม่สามารถเพิ่มเกณฑ์ได้')
    }
  }

  function startBehaviorEdit(rule: BehaviorRule) {
    setTab('deduction')
    setEditingId(rule.id)
    setTitle(rule.title)
    setDescription(rule.description ?? '')
    setPoints(rule.points)
    setDiscretionary(false)
    setShowForm(true)
    setConfirmId('')
    setError('')
  }

  function startPositiveEdit(rule: PositiveBehaviorRule) {
    setTab('addition')
    setEditingId(rule.id)
    setTitle(rule.title)
    setDescription(rule.description)
    setPoints(rule.discretionary ? rule.maxPoints : rule.defaultPoints ?? rule.maxPoints)
    setDiscretionary(rule.discretionary)
    setShowForm(true)
    setConfirmId('')
    setError('')
  }

  async function reviewProposal(proposal: RuleProposal, approve: boolean) {
    const key = `${approve ? 'approve' : 'reject'}:${proposal.id}`
    if (reviewId !== key) {
      setReviewId(key)
      setReviewDecision(approve ? 'approve' : 'reject')
      setReviewNote('')
      return
    }
    if (!approve && reviewNote.trim().length < 3) {
      setError('กรุณาระบุเหตุผลที่ไม่อนุมัติอย่างน้อย 3 ตัวอักษร')
      return
    }
    setError('')
    try {
      await onReviewProposal({ proposalId: proposal.id, approve, note: reviewNote.trim() || undefined })
      setReviewId('')
      setReviewNote('')
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'ไม่สามารถบันทึกผลการตรวจข้อเสนอได้')
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
          <button type="button" className="button primary compact" disabled={busy} onClick={() => { if (showForm) resetForm(); else setShowForm(true); setEditingId(''); setConfirmId(''); setError('') }}>
            <Icon name="plus" size={17} /> เพิ่มเกณฑ์
          </button>
        </div>
        <p className="form-help">รหัสเกณฑ์สร้างให้อัตโนมัติ การนำเกณฑ์ที่เคยใช้ออกจะซ่อนจากครู แต่ประวัติคะแนนเดิมยังคงอยู่</p>
        <div className="rule-catalog-tabs" role="tablist" aria-label="ประเภทเกณฑ์">
          <button type="button" role="tab" aria-selected={tab === 'deduction'} className={tab === 'deduction' ? 'active' : ''} onClick={() => { setTab('deduction'); setShowForm(false); setConfirmId(''); setQuery('') }}>เกณฑ์ตัดคะแนน <b>{activeDeductions.length}</b></button>
          <button type="button" role="tab" aria-selected={tab === 'addition'} className={tab === 'addition' ? 'active' : ''} onClick={() => { setTab('addition'); setShowForm(false); setConfirmId(''); setQuery('') }}>เกณฑ์เพิ่มคะแนน <b>{activePositives.length}</b></button>
        </div>
      </section>

      {pendingProposals.length ? <section className="panel rule-proposal-review"><div className="section-heading"><div><p className="eyebrow">ข้อเสนอจากคุณครู</p><h2>รอตรวจสอบเกณฑ์ใหม่</h2></div><span className="counter">{pendingProposals.length}</span></div>
        <div className="record-list">{pendingProposals.map((proposal) => {
          const approveKey = `approve:${proposal.id}`
          const rejectKey = `reject:${proposal.id}`
          const reviewing = reviewId === approveKey || reviewId === rejectKey
          return <article className="record-row detailed-record rule-proposal-row" key={proposal.id}><div><strong>{proposal.title}</strong><span>{proposal.kind === 'deduction' ? `ตัด ${proposal.points} คะแนน` : proposal.discretionary ? `เพิ่มได้ถึง ${proposal.points} คะแนน` : `เพิ่ม ${proposal.points} คะแนน`}</span>{proposal.description ? <small>{proposal.description}</small> : null}</div><div className="proposal-actions">{reviewing ? <input value={reviewNote} maxLength={500} onChange={(event) => { setReviewNote(event.target.value); setError('') }} placeholder={reviewDecision === 'reject' ? 'เหตุผลที่ไม่อนุมัติ (จำเป็น)' : 'หมายเหตุถึงครู (ไม่บังคับ)'} /> : null}<button type="button" className={reviewId === approveKey ? 'button primary compact' : 'button secondary compact'} disabled={busy} onClick={() => void reviewProposal(proposal, true)}>{reviewId === approveKey ? 'ยืนยันอนุมัติ' : 'อนุมัติ'}</button><button type="button" className={reviewId === rejectKey ? 'button reject compact' : 'button ghost compact'} disabled={busy} onClick={() => void reviewProposal(proposal, false)}>{reviewId === rejectKey ? 'ยืนยันไม่อนุมัติ' : 'ไม่อนุมัติ'}</button></div></article>
        })}</div>
      </section> : null}

      {showForm ? (
        <form className="panel rule-create-form" onSubmit={submit} noValidate>
          <div className="section-heading"><div><p className="eyebrow">{editingId ? 'สร้างรุ่นใหม่โดยเก็บประวัติเดิม' : 'รายการใหม่'}</p><h2>{editingId ? 'แก้ไขเกณฑ์' : tab === 'deduction' ? 'เพิ่มเกณฑ์ตัดคะแนน' : 'เพิ่มเกณฑ์เพิ่มคะแนน'}</h2></div></div>
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
          <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={resetForm}>ยกเลิก</button><button type="submit" className="button primary" disabled={busy}>{busy ? 'กำลังบันทึก…' : editingId ? 'บันทึกเป็นรุ่นใหม่' : 'เพิ่มเกณฑ์'}</button></div>
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
              <div className="rule-row-actions"><button type="button" className="button secondary compact" disabled={busy} onClick={() => startBehaviorEdit(rule)}>แก้ไข</button><button type="button" className={confirmId === `deduction:${rule.id}` ? 'button reject compact' : 'button ghost compact'} disabled={busy} onClick={() => void removeBehavior(rule)}>{confirmId === `deduction:${rule.id}` ? 'ยืนยันลบ' : 'ลบ'}</button></div>
            </article>
          ))}</div> : <EmptyState title="ไม่พบเกณฑ์ตัดคะแนน" detail="ลองเปลี่ยนคำค้นหรือเพิ่มเกณฑ์ใหม่" />
        ) : (
          visiblePositives.length ? <div className="rule-catalog-list">{visiblePositives.map((rule) => (
            <article className="rule-catalog-row" key={rule.id}>
              <div><span className="rule-code">{rule.code}</span><strong>{rule.title}</strong><small>{rule.description || rule.category}</small></div>
              <div className="rule-row-meta"><span className="badge status-approved">{rule.discretionary ? `กำหนดได้ถึง +${rule.maxPoints}` : `คงที่ +${rule.defaultPoints}`}</span></div>
              <div className="rule-row-actions"><button type="button" className="button secondary compact" disabled={busy} onClick={() => startPositiveEdit(rule)}>แก้ไข</button><button type="button" className={confirmId === `addition:${rule.id}` ? 'button reject compact' : 'button ghost compact'} disabled={busy} onClick={() => void removePositive(rule)}>{confirmId === `addition:${rule.id}` ? 'ยืนยันลบ' : 'ลบ'}</button></div>
            </article>
          ))}</div> : <EmptyState title="ไม่พบเกณฑ์เพิ่มคะแนน" detail="ลองเปลี่ยนคำค้นหรือเพิ่มเกณฑ์ใหม่" />
        )}
      </section>
    </div>
  )
}
