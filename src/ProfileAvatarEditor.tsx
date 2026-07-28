import { useEffect, useId, useMemo, useState } from 'react'
import {
  DEFAULT_PROFILE_AVATAR_CROP,
  getProfileAvatarPlacement,
  type ProfileAvatarCrop,
} from './profileAvatars'

interface ProfileAvatarEditorProps {
  file: File
  crop: ProfileAvatarCrop
  busy: boolean
  onCropChange: (crop: ProfileAvatarCrop) => void
  onCancel: () => void
  onConfirm: () => void
}

interface ImageDimensions {
  width: number
  height: number
}

export function ProfileAvatarEditor({
  file,
  crop,
  busy,
  onCropChange,
  onCancel,
  onConfirm,
}: ProfileAvatarEditorProps) {
  const [objectUrl, setObjectUrl] = useState('')
  const [dimensions, setDimensions] = useState<ImageDimensions>({ width: 1, height: 1 })
  const titleId = useId()
  const zoomId = useId()
  const horizontalId = useId()
  const verticalId = useId()

  useEffect(() => {
    const nextUrl = URL.createObjectURL(file)
    setObjectUrl(nextUrl)
    return () => URL.revokeObjectURL(nextUrl)
  }, [file])

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [busy, onCancel])

  const placement = useMemo(
    () => getProfileAvatarPlacement(dimensions.width, dimensions.height, crop, 100),
    [crop, dimensions.height, dimensions.width],
  )

  function updateCrop(next: Partial<ProfileAvatarCrop>) {
    onCropChange({ ...crop, ...next })
  }

  return (
    <div className="avatar-editor-backdrop">
      <section
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
          >
            ×
          </button>
        </header>

        <div className="avatar-editor-body">
          <div className="avatar-crop-stage">
            <div className="avatar-crop-viewport" aria-label="ตัวอย่างรูปโปรไฟล์หลังปรับ">
              {objectUrl ? (
                <img
                  src={objectUrl}
                  alt=""
                  draggable={false}
                  style={{
                    width: `${placement.width}%`,
                    height: `${placement.height}%`,
                    left: `${placement.x}%`,
                    top: `${placement.y}%`,
                  }}
                  onLoad={(event) => {
                    const image = event.currentTarget
                    setDimensions({ width: image.naturalWidth, height: image.naturalHeight })
                  }}
                />
              ) : null}
              <span className="avatar-crop-circle" aria-hidden="true" />
            </div>
            <p>พื้นที่ในวงกลมคือส่วนที่จะแสดงบนหน้าเว็บ</p>
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
