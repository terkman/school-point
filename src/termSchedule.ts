const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function isCalendarDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

export function validateTermSchedule(startsOn: string, endsOn: string): string | null {
  if (!startsOn || !endsOn) return 'กรุณาระบุวันเปิดและวันปิดภาคเรียน'
  if (!isCalendarDate(startsOn) || !isCalendarDate(endsOn)) return 'รูปแบบวันที่ไม่ถูกต้อง'
  if (startsOn > endsOn) return 'วันปิดภาคเรียนต้องไม่มาก่อนวันเปิดภาคเรียน'
  return null
}
