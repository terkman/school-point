export function passwordResetReason(value: unknown): string {
  const reason = String(value ?? '').trim()
  if (reason.length < 5) throw new Error('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร')
  if (reason.length > 500) throw new Error('เหตุผลยาวเกิน 500 ตัวอักษร')
  return reason
}

/** Create an unreported, high-entropy password that invalidates the old one. */
export function createTemporaryRecoveryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const encoded = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `Sp1!${encoded}`
}
