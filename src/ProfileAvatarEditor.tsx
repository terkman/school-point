import { useEffect, useId, useRef, useState } from 'react'
import {
  DEFAULT_PROFILE_AVATAR_CROP,
  drawProfileAvatar,
  PROFILE_AVATAR_SIZE,
  type ProfileAvatarCrop,
} from './profileAvatars'
import { useDialogAccessibility } from './useDialogAccessibility'

interface ProfileAvatarEditorProps {
  file: File
  crop: ProfileAvatarCrop
  busy: boolean
  onCropChange: (crop: ProfileAvatarCrop) => void
  onCancel: () => void
  onConfirm: () => void
}

export function ProfileAvatarEditor({
  file,
  crop,
  busy,
  onCropChange,
  onCancel,
  onConfirm,
}: ProfileAvatarEditorProps) {
  const dialogRef = useDialogAccessibility({ onClose: onCancel, busy })
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)
  const [previewError, setPreviewError] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const titleId = useId()
  const zoomId = useId()
  const horizontalId = useId()
  const verticalId = useId()

  useEffect(() => {
    let disposed = false
    let decodedBitmap: ImageBitmap | null = null
    setBitmap(null)
    setPreviewError('')
    void createImageBitmap(file, { imageOrientation: 'from-image' })
      .then((nextBitmap) => {
        decodedBitmap = nextBitmap
        if (disposed) {
          nextBitmap.close()
          return
        }
        setBitmap(nextBitmap)
      })
      .catch(() => {
        if (!disposed) setPreviewError('ไม่สามารถแสดงตัวอย่างรูปนี้ได้')
      })
    return () => {
      disposed = true
      decodedBitmap?.close()
    }
  }, [file])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !bitmap) return
    const context = canvas.getContext('2d')
    if (!context) {
      setPreviewError('อุปกรณ์นี้ไม่รองรับการแสดงตัวอย่างรูป')
      return
    }
    drawProfileAvatar(context, bitmap, bitmap.width, bitmap.height, crop)
  }, [bitmap, crop])

  function updateCrop(next: Partial<ProfileAvatarCrop>) {
    onCropChange({ ...crop, ...next })
  }

  return (
    <div className="avatar-editor-backdrop">
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="avatar-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="avatar-editor-header">
          <div>
            <p className="eyebrow">ตรวจสอบก่อนบันทึก</p>
            <h2 id={titleId}>ปรับรูปโปรไฟล์</h2>
            <p>ซูมหรือเลื่อนภาพให้พอดีกับวงกลมตัวอย่าง</p>
          </div>
          <button
            type="button"
            className="avatar-editor-close"
            aria-label="ปิดหน้าปรับรูป"
            disabled={busy}
            onClick={onCancel}
            data-dialog-initial-focus
          >
            ×
          </button>
        </header>

        <div className="avatar-editor-body">
          <div className="avatar-crop-stage">
            <div className="avatar-crop-viewport" aria-label="ตัวอย่างรูปโปรไฟล์หลังปรับ">
              <canvas
                ref={canvasRef}
                width={PROFILE_AVATAR_SIZE}
                height={PROFILE_AVATAR_SIZE}
                aria-label="ภาพจริงที่จะใช้เป็นรูปโปรไฟล์"
              />
              {!bitmap && !previewError ? <span className="avatar-crop-loading">กำลังเตรียมตัวอย่าง…</span> : null}
              {previewError ? <span className="avatar-crop-loading error">{previewError}</span> : null}
            </div>
            <p>ภาพในวงกลมนี้ใช้การเรนเดอร์เดียวกับไฟล์ที่บันทึกจริง</p>
          </div>

          <div className="avatar-editor-controls">
            <label htmlFor={zoomId}>
              <span>ขนาดรูป</span>
              <output>{Math.round(crop.zoom * 100)}%</output>
            </label>
            <input
              id={zoomId}
              type="range"
              min="0.5"
              max="3"
              step="0.01"
              value={crop.zoom}
              disabled={busy}
              onChange={(event) => updateCrop({ zoom: Number(event.target.value) })}
            />

            <label htmlFor={horizontalId}>
              <span>เลื่อนซ้าย–ขวา</span>
              <output>{Math.round(crop.offsetX)}</output>
            </label>
            <input
              id={horizontalId}
              type="range"
              min="-100"
              max="100"
              step="1"
              value={crop.offsetX}
              disabled={busy}
              onChange={(event) => updateCrop({ offsetX: Number(event.target.value) })}
            />

            <label htmlFor={verticalId}>
              <span>เลื่อนขึ้น–ลง</span>
              <output>{Math.round(crop.offsetY)}</output>
            </label>
            <input
              id={verticalId}
              type="range"
              min="-100"
              max="100"
              step="1"
              value={crop.offsetY}
              disabled={busy}
              onChange={(event) => updateCrop({ offsetY: Number(event.target.value) })}
            />

            <button
              type="button"
              className="text-button avatar-editor-reset"
              disabled={busy}
              onClick={() => onCropChange({ ...DEFAULT_PROFILE_AVATAR_CROP })}
            >
              คืนค่ากลาง
            </button>
          </div>
        </div>

        <footer className="avatar-editor-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>
            ยกเลิก
          </button>
          <button type="button" className="button primary" disabled={busy} onClick={onConfirm}>
            {busy ? 'กำลังบันทึก…' : 'ใช้รูปนี้'}
          </button>
        </footer>
      </section>
    </div>
  )
}
