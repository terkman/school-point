import { useId, useMemo, useState, type ChangeEvent } from 'react'
import type { EvidenceAttachment } from './evidence'
import {
  formatEvidenceFileSize,
  MAX_EVIDENCE_FILES,
  parseEvidenceBundle,
  validateEvidenceFiles,
} from './evidence'
import { Icon } from './ui'

interface EvidenceFieldProps {
  note: string
  files: File[]
  disabled: boolean
  onNoteChange: (note: string) => void
  onFilesChange: (files: File[]) => void
}

export function EvidenceField({
  note,
  files,
  disabled,
  onNoteChange,
  onFilesChange,
}: EvidenceFieldProps) {
  const inputId = useId()
  const [fileError, setFileError] = useState('')

  function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = Array.from(event.target.files ?? [])
    const validationError = validateEvidenceFiles(nextFiles)
    if (validationError) {
      setFileError(validationError)
      event.target.value = ''
      return
    }
    setFileError('')
    onFilesChange(nextFiles)
  }

  function removeFile(index: number) {
    setFileError('')
    onFilesChange(files.filter((_, fileIndex) => fileIndex !== index))
  }

  return (
    <div className="evidence-field">
      <label>หลักฐานประกอบ
        <textarea
          disabled={disabled}
          value={note}
          maxLength={2000}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder="พิมพ์คำอธิบายหลักฐาน หรือเลือกไฟล์ด้านล่าง"
        />
      </label>
      <div className="evidence-upload-box">
        <input
          className="evidence-file-input"
          id={inputId}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
          multiple
          disabled={disabled}
          onChange={chooseFiles}
        />
        <label className="button secondary evidence-file-button" htmlFor={inputId} aria-disabled={disabled}>
          <Icon name="upload" size={18} />
          เลือกไฟล์เพื่ออัปโหลด
        </label>
        <span>รูปภาพหรือ PDF สูงสุด {MAX_EVIDENCE_FILES} ไฟล์ • ไม่เกิน 10 MB ต่อไฟล์</span>
      </div>
      {files.length ? (
        <div className="evidence-selected-files" aria-label="ไฟล์หลักฐานที่เลือก">
          {files.map((file, index) => (
            <div key={`${file.name}:${file.size}:${index}`}>
              <Icon name="book" size={17} />
              <span><strong>{file.name}</strong><small>{formatEvidenceFileSize(file.size)} • จะอัปโหลดเมื่อส่งแบบฟอร์ม</small></span>
              <button type="button" disabled={disabled} onClick={() => removeFile(index)} aria-label={`นำไฟล์ ${file.name} ออก`}>×</button>
            </div>
          ))}
        </div>
      ) : null}
      {fileError ? <p className="form-error" role="alert">{fileError}</p> : null}
      <small className="field-caption">ต้องมีคำอธิบายอย่างน้อย 5 ตัวอักษร หรือแนบไฟล์อย่างน้อย 1 ไฟล์</small>
    </div>
  )
}

interface EvidenceSummaryProps {
  value?: string
  resolveFileUrl?: (attachment: EvidenceAttachment) => Promise<string>
  emptyText?: string
}

export function EvidenceSummary({
  value,
  resolveFileUrl,
  emptyText = 'ไม่ได้แนบหลักฐาน',
}: EvidenceSummaryProps) {
  const bundle = useMemo(() => parseEvidenceBundle(value), [value])
  const [openingPath, setOpeningPath] = useState('')
  const [error, setError] = useState('')

  async function openFile(attachment: EvidenceAttachment) {
    if (!resolveFileUrl || openingPath) return
    setOpeningPath(attachment.path)
    setError('')
    try {
      const url = await resolveFileUrl(attachment)
      const link = document.createElement('a')
      link.href = url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.click()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'ไม่สามารถเปิดไฟล์หลักฐานได้')
    } finally {
      setOpeningPath('')
    }
  }

  if (!bundle.note && !bundle.files.length) return <span>{emptyText}</span>

  return (
    <div className="evidence-summary">
      {bundle.note ? <span>{bundle.note}</span> : null}
      {bundle.files.length ? (
        <div className="evidence-attachment-list">
          {bundle.files.map((attachment) => (
            <button
              type="button"
              key={attachment.path}
              disabled={!resolveFileUrl || Boolean(openingPath)}
              onClick={() => void openFile(attachment)}
            >
              <Icon name="book" size={16} />
              <span>{attachment.name}</span>
              <small>{openingPath === attachment.path ? 'กำลังเปิด…' : formatEvidenceFileSize(attachment.size)}</small>
            </button>
          ))}
        </div>
      ) : null}
      {error ? <small className="form-error">{error}</small> : null}
    </div>
  )
}
