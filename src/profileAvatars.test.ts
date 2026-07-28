import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PROFILE_AVATAR_CROP,
  getProfileAvatarPlacement,
  getProfileAvatar,
  normalizeProfileAvatarCrop,
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

  it('limits crop controls and calculates the same placement used by the preview and saved image', () => {
    expect(normalizeProfileAvatarCrop({ zoom: 0.1, offsetX: -500, offsetY: 500 })).toEqual({
      zoom: 0.5,
      offsetX: -100,
      offsetY: 100,
    })

    expect(getProfileAvatarPlacement(800, 400, DEFAULT_PROFILE_AVATAR_CROP, 100)).toEqual({
      width: 200,
      height: 100,
      x: -50,
      y: 0,
    })

    expect(getProfileAvatarPlacement(800, 400, { zoom: 0.5, offsetX: 0, offsetY: 0 }, 100)).toEqual({
      width: 100,
      height: 50,
      x: 0,
      y: 25,
    })

    expect(getProfileAvatarPlacement(800, 400, { zoom: 1, offsetX: 0, offsetY: 100 }, 100)).toEqual({
      width: 200,
      height: 100,
      x: -50,
      y: 25,
    })
  })
})
