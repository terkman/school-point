export const PROFILE_AVATAR_BUCKET = 'student-profile-images'
export const PROFILE_AVATAR_OUTPUT_BYTES = 2 * 1024 * 1024
export const PROFILE_AVATAR_INPUT_BYTES = 10 * 1024 * 1024
export const PROFILE_AVATAR_SIZE = 512

export type ProfileAvatarGroup = 'boy' | 'girl'

export interface ProfileAvatarOption {
  id: string
  label: string
  group: ProfileAvatarGroup
  src: string
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

export async function prepareProfileAvatar(file: File): Promise<File> {
  const validationError = validateProfileAvatarFile(file)
  if (validationError) throw new Error(validationError)

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const sourceSize = Math.min(bitmap.width, bitmap.height)
    const sourceX = Math.max(0, Math.round((bitmap.width - sourceSize) / 2))
    const sourceY = Math.max(0, Math.round((bitmap.height - sourceSize) / 2))
    const canvas = document.createElement('canvas')
    canvas.width = PROFILE_AVATAR_SIZE
    canvas.height = PROFILE_AVATAR_SIZE
    const context = canvas.getContext('2d')
    if (!context) throw new Error('อุปกรณ์นี้ไม่รองรับการเตรียมรูปภาพ')
    context.drawImage(
      bitmap,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      PROFILE_AVATAR_SIZE,
      PROFILE_AVATAR_SIZE,
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
