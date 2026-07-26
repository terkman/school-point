import { describe, expect, it } from 'vitest'
import {
  encodeEvidenceBundle,
  hasEvidence,
  MAX_EVIDENCE_FILE_BYTES,
  parseEvidenceBundle,
  validateEvidenceFiles,
  type EvidenceAttachment,
} from './evidence'

function fileLike(name: string, type: string, size: number): File {
  return { name, type, size } as File
}

describe('score evidence bundles', () => {
  const attachment: EvidenceAttachment = {
    path: 'user-id/2026-07-26/file-id.pdf',
    name: 'หลักฐาน.pdf',
    size: 2048,
    contentType: 'application/pdf',
  }

  it('preserves legacy text evidence', () => {
    expect(parseEvidenceBundle('ครูเวรยืนยันแล้ว')).toEqual({
      note: 'ครูเวรยืนยันแล้ว',
      files: [],
    })
  })

  it('round-trips a private file reference and note', () => {
    expect(parseEvidenceBundle(encodeEvidenceBundle('ตรวจสอบแล้ว', [attachment]))).toEqual({
      note: 'ตรวจสอบแล้ว',
      files: [attachment],
    })
  })

  it('requires a useful note or at least one file', () => {
    expect(hasEvidence('สั้น', [])).toBe(false)
    expect(hasEvidence('มีคำอธิบายเพียงพอ', [])).toBe(true)
    expect(hasEvidence('', [attachment])).toBe(true)
  })

  it('rejects unsupported and oversized uploads', () => {
    expect(validateEvidenceFiles([fileLike('virus.exe', 'application/octet-stream', 10)])).toContain('รองรับเฉพาะ')
    expect(validateEvidenceFiles([fileLike('large.pdf', 'application/pdf', MAX_EVIDENCE_FILE_BYTES + 1)])).toContain('เกิน 10 MB')
    expect(validateEvidenceFiles([fileLike('proof.pdf', 'application/pdf', 1024)])).toBeNull()
  })
})
