export const PROFILE_AVATAR_BUCKET = 'student-profile-images'
export const PROFILE_AVATAR_OUTPUT_BYTES = 2 * 1024 * 1024
export const PROFILE_AVATAR_INPUT_BYTES = 10 * 1024 * 1024
export const PROFILE_AVATAR_SIZE = 512

export type ProfileAvatarGroup = 'boy' | 'girl'

export interface ProfileAvatarCrop {
  zoom: number
  offsetX: number
  offsetY: number
}

export interface ProfileAvatarPlacement {
  width: number
  height: number
  x: number
  y: number
}

export interface ProfileAvatarOption {
  id: string
  label: string
  group: ProfileAvatarGroup
  src: string
}

export const DEFAULT_PROFILE_AVATAR_CROP: ProfileAvatarCrop = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
}

export const PROFILE_AVATARS: ProfileAvatarOption[] = [
  ...Array.from({ length: 5 }, (_, index): ProfileAvatarOption => ({
    id: `student-boy-${index + 1}`,
    label: `ตัวละครชายแบบที่ ${index + 1}`,
    group: 'boy',
    src: `/avatars/student-boy-${index + 1}.webp`,
  })),
  ...Array.from({ length: 5 }, (_, index): ProfileAvatarOption => ({
    id: `student-girl-${index + 1}`,
    label: `ตัวละครหญิงแบบที่ ${index + 1}`,
    group: 'girl',
    src: `/avatars/student-girl-${index + 1}.webp`,
  })),
]

const avatarById = new Map(PROFILE_AVATARS.map((avatar) => [avatar.id, avatar]))
const allowedInputTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function getProfileAvatar(preset?: string): ProfileAvatarOption | undefined {
  return preset ? avatarById.get(preset) : undefined
}

export function validateProfileAvatarFile(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  if (!allowedInputTypes.has(file.type)) return 'รองรับเฉพาะไฟล์ JPG, PNG และ WEBP'
  if (file.size > PROFILE_AVATAR_INPUT_BYTES) return `ไฟล์ ${file.name} มีขนาดเกิน 10 MB`
  return null
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum))
}

export function normalizeProfileAvatarCrop(crop: ProfileAvatarCrop): ProfileAvatarCrop {
  return {
    zoom: clamp(crop.zoom, 0.5, 3),
    offsetX: clamp(crop.offsetX, -100, 100),
    offsetY: clamp(crop.offsetY, -100, 100),
  }
}

export function getProfileAvatarPlacement(
  sourceWidth: number,
  sourceHeight: number,
  crop: ProfileAvatarCrop,
  viewportSize = PROFILE_AVATAR_SIZE,
): ProfileAvatarPlacement {
  if (sourceWidth <= 0 || sourceHeight <= 0 || viewportSize <= 0) {
    throw new Error('ไม่สามารถอ่านขนาดรูปโปรไฟล์ได้')
  }

  const normalizedCrop = normalizeProfileAvatarCrop(crop)
  const coverScale = Math.max(viewportSize / sourceWidth, viewportSize / sourceHeight)
  const scale = coverScale * normalizedCrop.zoom
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  const travelX = Math.max(Math.abs(width - viewportSize) / 2, viewportSize * 0.25)
  const travelY = Math.max(Math.abs(height - viewportSize) / 2, viewportSize * 0.25)

  return {
    width,
    height,
    x: (viewportSize - width) / 2 + (normalizedCrop.offsetX / 100) * travelX,
    y: (viewportSize - height) / 2 + (normalizedCrop.offsetY / 100) * travelY,
  }
}

export async function prepareProfileAvatar(
  file: File,
  crop: ProfileAvatarCrop = DEFAULT_PROFILE_AVATAR_CROP,
): Promise<File> {
  const validationError = validateProfileAvatarFile(file)
  if (validationError) throw new Error(validationError)

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const placement = getProfileAvatarPlacement(bitmap.width, bitmap.height, crop)
    const canvas = document.createElement('canvas')
    canvas.width = PROFILE_AVATAR_SIZE
    canvas.height = PROFILE_AVATAR_SIZE
    const context = canvas.getContext('2d')
    if (!context) throw new Error('อุปกรณ์นี้ไม่รองรับการเตรียมรูปภาพ')
    context.fillStyle = '#e8eeff'
    context.fillRect(0, 0, PROFILE_AVATAR_SIZE, PROFILE_AVATAR_SIZE)
    context.drawImage(
      bitmap,
      placement.x,
      placement.y,
      placement.width,
      placement.height,
    )
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error('ไม่สามารถแปลงรูปโปรไฟล์ได้')),
        'image/webp',
        0.86,
      )
    })
    if (blob.size > PROFILE_AVATAR_OUTPUT_BYTES) throw new Error('รูปที่เตรียมแล้วมีขนาดเกิน 2 MB')
    return new File([blob], 'profile.webp', { type: 'image/webp', lastModified: Date.now() })
  } finally {
    bitmap.close()
  }
}
