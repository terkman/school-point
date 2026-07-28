import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ProfileAvatarEditor } from './ProfileAvatarEditor'
import { DEFAULT_PROFILE_AVATAR_CROP } from './profileAvatars'

describe('profile avatar editor', () => {
  it('renders zoom and positioning controls before the student confirms the image', () => {
    const markup = renderToStaticMarkup(createElement(ProfileAvatarEditor, {
      file: new File(['avatar'], 'avatar.png', { type: 'image/png' }),
      crop: DEFAULT_PROFILE_AVATAR_CROP,
      busy: false,
      onCropChange: () => undefined,
      onCancel: () => undefined,
      onConfirm: () => undefined,
    }))

    expect(markup).toContain('ปรับรูปโปรไฟล์')
    expect(markup).toContain('ขนาดรูป')
    expect(markup).toContain('เลื่อนซ้าย–ขวา')
    expect(markup).toContain('เลื่อนขึ้น–ลง')
    expect(markup).toContain('ใช้รูปนี้')
    expect(markup).toContain('ภาพจริงที่จะใช้เป็นรูปโปรไฟล์')
    expect(markup).toContain('ใช้การเรนเดอร์เดียวกับไฟล์ที่บันทึกจริง')
    expect(markup).toContain('aria-modal="true"')
  })
})
