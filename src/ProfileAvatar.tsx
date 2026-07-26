import type { Account } from './domain'
import { getProfileAvatar } from './profileAvatars'

interface ProfileAvatarProps {
  account: Account
  className?: string
  decorative?: boolean
}

export function ProfileAvatar({ account, className = '', decorative = true }: ProfileAvatarProps) {
  const src = account.avatarUrl || getProfileAvatar(account.avatarPreset)?.src
  const classes = ['avatar', 'profile-avatar', className].filter(Boolean).join(' ')
  if (!src) {
    return <span className={classes} aria-hidden={decorative || undefined}>{account.displayName.slice(0, 1)}</span>
  }
  return (
    <span className={classes}>
      <img
        src={src}
        alt={decorative ? '' : `รูปโปรไฟล์ของ ${account.displayName}`}
        aria-hidden={decorative || undefined}
      />
    </span>
  )
}
