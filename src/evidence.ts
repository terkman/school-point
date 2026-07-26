export const EVIDENCE_BUCKET = 'score-evidence'
export const MAX_EVIDENCE_FILES = 3
export const MAX_EVIDENCE_FILE_BYTES = 10 * 1024 * 1024

const EVIDENCE_PREFIX = 'SP_EVIDENCE_V1:'
const ALLOWED_EVIDENCE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
])

export interface EvidenceAttachment {
  path: string
  name: string
  size: number
  contentType: string
}

export interface EvidenceBundle {
  note: string
  files: EvidenceAttachment[]
}

export function validateEvidenceFiles(files: File[]): string | null {
  if (files.length > MAX_EVIDENCE_FILES) return `แนบไฟล์ได้สูงสุด ${MAX_EVIDENCE_FILES} ไฟล์`
  for (const file of files) {
    if (!ALLOWED_EVIDENCE_TYPES.has(file.type)) {
      return 'รองรับเฉพาะไฟล์ JPG, PNG, WEBP, HEIC และ PDF'
    }
    if (file.size > MAX_EVIDENCE_FILE_BYTES) {
      return `ไฟล์ ${file.name} มีขนาดเกิน 10 MB`
    }
  }
  return null
}

export function hasEvidence(note: string, files: Array<File | EvidenceAttachment>): boolean {
  return note.trim().length >= 5 || files.length > 0
}

export function encodeEvidenceBundle(note: string, files: EvidenceAttachment[]): string {
  const normalizedNote = note.trim()
  if (!files.length) return normalizedNote
  const payload: EvidenceBundle = {
    note: normalizedNote,
    files: files.map((file) => ({
      path: file.path,
      name: file.name.slice(0, 180),
      size: file.size,
      contentType: file.contentType,
    })),
  }
  return `${EVIDENCE_PREFIX}${JSON.stringify(payload)}`
}

export function parseEvidenceBundle(value?: string): EvidenceBundle {
  const normalized = value?.trim() ?? ''
  if (!normalized.startsWith(EVIDENCE_PREFIX)) return { note: normalized, files: [] }
  try {
    const parsed = JSON.parse(normalized.slice(EVIDENCE_PREFIX.length)) as Partial<EvidenceBundle>
    const files = Array.isArray(parsed.files)
      ? parsed.files.filter((file): file is EvidenceAttachment => Boolean(
        file
        && typeof file.path === 'string'
        && typeof file.name === 'string'
        && typeof file.size === 'number'
        && typeof file.contentType === 'string',
      )).slice(0, MAX_EVIDENCE_FILES)
      : []
    return {
      note: typeof parsed.note === 'string' ? parsed.note : '',
      files,
    }
  } catch {
    return { note: normalized, files: [] }
  }
}

export function formatEvidenceFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
