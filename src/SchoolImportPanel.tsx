import { useState, type ChangeEvent } from 'react'
import type { AppDataActions } from './dataActions'
import type { SchoolImportPreview, SchoolImportResult } from './schoolImport'
import { Icon } from './ui'

interface SchoolImportPanelProps {
  actions: AppDataActions
  onApplied: () => Promise<void>
}

const countLabels = [
  ['classrooms', 'ชั้นและห้อง'],
  ['students', 'นักเรียน'],
  ['staff', 'บุคลากร'],
  ['assignments', 'ห้องที่ครูรับผิดชอบ'],
  ['guardians', 'ผู้ปกครอง'],
] as const

function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString('th-TH')} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('th-TH', { maximumFractionDigits: 1 })} MB`
}

function PreviewSummary({ preview }: { preview: SchoolImportPreview }) {
  const errorCount = preview.issues.filter((issue) => issue.severity === 'error').length
  const warningCount = preview.issues.filter((issue) => issue.severity === 'warning').length
  return (
    <section className="school-import-preview" aria-live="polite">
      <div className="school-import-preview-heading">
        <div>
          <p className="eyebrow">ผลตรวจสอบก่อนบันทึก</p>
          <h3>{preview.canApply ? 'ไฟล์พร้อมนำเข้า' : 'กรุณาแก้ข้อมูลในไฟล์ก่อน'}</h3>
          <span>{preview.termLabel} • รหัสตรวจสอบ {preview.fingerprint ? preview.fingerprint.slice(0, 12) : 'ยังไม่ออก'}</span>
        </div>
        <span className={`school-import-state ${preview.canApply ? 'ready' : 'blocked'}`}>
          <Icon name={preview.canApply ? 'check' : 'alert'} size={18} />
          {preview.canApply ? 'ผ่านการตรวจ' : `${errorCount} ข้อผิดพลาด`}
        </span>
      </div>

      <div className="school-import-count-grid">
        {countLabels.map(([key, label]) => <div key={key}><span>{label}</span><strong>{preview.counts[key].toLocaleString('th-TH')}</strong><small>แถวที่จะสร้างหรืออัปเดต</small></div>)}
      </div>

      <div className="school-import-account-summary">
        <Icon name="shield" size={20} />
        <div>
          <strong>บัญชีเข้าสู่ระบบ {preview.accounts.total.toLocaleString('th-TH')} บัญชี</strong>
          <span>สร้างใหม่ {preview.accounts.willCreate.toLocaleString('th-TH')} • มีอยู่แล้ว {preview.accounts.alreadyExists.toLocaleString('th-TH')} • ไม่มีรหัสผ่านอยู่ในไฟล์</span>
        </div>
      </div>

      {preview.issues.length ? (
        <div className="school-import-issues">
          <div className="school-import-issues-heading">
            <strong>รายการที่ต้องตรวจสอบ</strong>
            <span>ผิดพลาด {errorCount} • คำเตือน {warningCount}</span>
          </div>
          <div className="school-import-issue-list">
            {preview.issues.slice(0, 50).map((issue, index) => (
              <article className={issue.severity} key={`${issue.code}:${issue.sheet}:${issue.row ?? 0}:${index}`}>
                <Icon name={issue.severity === 'error' ? 'alert' : 'eye'} size={18} />
                <div>
                  <strong>{issue.sheet}{issue.row ? ` แถว ${issue.row}` : ''}{issue.column ? ` • ${issue.column}` : ''}</strong>
                  <span>{issue.message}</span>
                </div>
              </article>
            ))}
          </div>
          {preview.issueCount > preview.issues.length ? <small>แสดง {preview.issues.length} จาก {preview.issueCount} รายการ กรุณาแก้ชุดแรกแล้วตรวจใหม่</small> : null}
        </div>
      ) : <div className="school-import-clean"><Icon name="check" size={20} /> ไม่พบข้อผิดพลาดหรือคำเตือน</div>}
    </section>
  )
}

function ImportSuccess({ result }: { result: SchoolImportResult }) {
  return (
    <section className="school-import-success" role="status">
      <span className="school-import-success-icon"><Icon name="check" size={30} /></span>
      <div>
        <p className="eyebrow">บันทึกเรียบร้อย</p>
        <h3>{result.alreadyApplied ? 'ไฟล์นี้เคยนำเข้าแล้ว ระบบไม่สร้างข้อมูลซ้ำ' : 'นำเข้าข้อมูลโรงเรียนสำเร็จ'}</h3>
        <p>ผูกบัญชีแล้ว {result.provisioning.linked.toLocaleString('th-TH')} จาก {result.provisioning.total.toLocaleString('th-TH')} บัญชี บัญชีใหม่ยังต้องออกรหัสครั้งแรกจากหน้ารายชื่อ</p>
        {result.provisioning.failed ? <p className="form-error">มี {result.provisioning.failed.toLocaleString('th-TH')} บัญชีที่ยังสร้างไม่สำเร็จ สามารถตรวจและนำเข้าไฟล์เดิมซ้ำเพื่อให้ระบบลองผูกบัญชีอีกครั้ง</p> : null}
      </div>
    </section>
  )
}

export function SchoolImportPanel({ actions, onApplied }: SchoolImportPanelProps) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<SchoolImportPreview | null>(null)
  const [result, setResult] = useState<SchoolImportResult | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState<'preview' | 'apply' | ''>('')
  const [error, setError] = useState('')

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0] ?? null
    setFile(next)
    setPreview(null)
    setResult(null)
    setConfirmed(false)
    setError('')
  }

  async function inspectFile() {
    if (!file || busy) return
    setBusy('preview')
    setError('')
    setResult(null)
    setConfirmed(false)
    try {
      setPreview(await actions.previewSchoolImport(file))
    } catch (inspectError) {
      setPreview(null)
      setError(inspectError instanceof Error ? inspectError.message : 'ตรวจสอบไฟล์ไม่สำเร็จ')
    } finally {
      setBusy('')
    }
  }

  async function applyFile() {
    if (!file || !preview?.canApply || !confirmed || busy) return
    setBusy('apply')
    setError('')
    try {
      const applied = await actions.applySchoolImport(file, preview.fingerprint)
      setResult(applied)
      setPreview(null)
      setConfirmed(false)
      await onApplied()
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'นำเข้าข้อมูลไม่สำเร็จ')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="school-import-page">
      <section className="school-import-guide">
        <div className="school-import-guide-copy">
          <p className="eyebrow">นำเข้าจำนวนมากในครั้งเดียว</p>
          <h2>Excel 1 ไฟล์ • 5 แผ่นงาน</h2>
          <p>ใช้แบบฟอร์มของระบบเพื่อเพิ่มหรืออัปเดตห้อง นักเรียน บุคลากร ห้องที่ครูรับผิดชอบ และผู้ปกครอง โดยช่องว่างจะไม่ลบข้อมูลเดิม</p>
        </div>
        <a className="button secondary school-import-download" href="/templates/school-point-import-template.xlsx" download="แบบฟอร์มนำเข้าข้อมูลโรงเรียน.xlsx">
          <Icon name="book" size={18} /> ดาวน์โหลดแบบฟอร์ม
        </a>
      </section>

      <ol className="school-import-steps">
        <li><b>1</b><div><strong>ดาวน์โหลดและกรอก</strong><span>ห้ามเปลี่ยนชื่อ 5 แผ่นงานหรือหัวตาราง</span></div></li>
        <li><b>2</b><div><strong>อัปโหลดเพื่อตรวจ</strong><span>ระบบยังไม่เขียนข้อมูลในขั้นนี้</span></div></li>
        <li><b>3</b><div><strong>ยืนยันครั้งเดียว</strong><span>บันทึกแบบ transaction และกันไฟล์ซ้ำ</span></div></li>
      </ol>

      <section className="school-import-upload-card">
        <label className={file ? 'school-import-file selected' : 'school-import-file'}>
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={Boolean(busy)} onChange={chooseFile} />
          <span className="school-import-file-icon"><Icon name="upload" size={26} /></span>
          <span>
            <strong>{file ? file.name : 'เลือกไฟล์ Excel .xlsx'}</strong>
            <small>{file ? `${fileSize(file.size)} • พร้อมตรวจสอบ` : 'ขนาดไม่เกิน 10 MB และรวมไม่เกิน 5,000 แถว'}</small>
          </span>
          <b>{file ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์'}</b>
        </label>
        <button className="button primary" type="button" disabled={!file || Boolean(busy)} onClick={() => void inspectFile()}>
          {busy === 'preview' ? 'กำลังตรวจสอบ…' : <><Icon name="eye" size={18} /> ตรวจสอบไฟล์ก่อนบันทึก</>}
        </button>
      </section>

      {error ? <p className="form-error school-import-error" role="alert">{error}</p> : null}
      {result ? <ImportSuccess result={result} /> : null}
      {preview ? <PreviewSummary preview={preview} /> : null}

      {preview?.canApply ? (
        <section className="school-import-confirm">
          <label>
            <input type="checkbox" checked={confirmed} disabled={Boolean(busy)} onChange={(event) => setConfirmed(event.target.checked)} />
            <span><strong>ฉันตรวจสอบจำนวนข้อมูลและคำเตือนแล้ว</strong><small>ข้อมูลรหัสเดิมจะอัปเดต รหัสใหม่จะสร้างเพิ่ม และช่องว่างจะคงค่าเดิม</small></span>
          </label>
          <button className="button primary" type="button" disabled={!confirmed || Boolean(busy)} onClick={() => void applyFile()}>
            {busy === 'apply' ? 'กำลังนำเข้าและผูกบัญชี…' : 'ยืนยันนำเข้าข้อมูล'}
          </button>
        </section>
      ) : null}
    </div>
  )
}
