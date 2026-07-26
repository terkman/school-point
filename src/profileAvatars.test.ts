import { describe, expect, it } from 'vitest'
import {
  getProfileAvatar,
  PROFILE_AVATARS,
  PROFILE_AVATAR_INPUT_BYTES,
  validateProfileAvatarFile,
} from './profileAvatars'

describe('student profile avatars', () => {
  it('provides five boy and five girl cartoon choices with unique ids and assets', () => {
    expect(PROFILE_AVATARS).toHaveLength(10)
    expect(PROFILE_AVATARS.filter((avatar) => avatar.group === 'boy')).toHaveLength(5)
    expect(PROFILE_AVATARS.filter((avatar) => avatar.group === 'girl')).toHaveLength(5)
    expect(new Set(PROFILE_AVATARS.map((avatar) => avatar.id))).toHaveProperty('size', 10)
    for (const avatar of PROFILE_AVATARS) {
      expect(avatar.src).toBe(`/avatars/${avatar.id}.webp`)
      expect(getProfileAvatar(avatar.id)).toBe(avatar)
    }
  })

  it('accepts safe image formats and rejects unsupported or oversized files', () => {
    expect(validateProfileAvatarFile({ name: 'profile.jpg', type: 'image/jpeg', size: 512_000 })).toBeNull()
    expect(validateProfileAvatarFile({ name: 'profile.gif', type: 'image/gif', size: 512_000 })).toContain('JPG')
    expect(validateProfileAvatarFile({
      name: 'large.png',
      type: 'image/png',
      size: PROFILE_AVATAR_INPUT_BYTES + 1,
    })).toContain('10 MB')
  })
})
