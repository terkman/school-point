import type { DemoState } from './domain'
import { toLocalDateTimeInputValue } from './teacherWorkflows'

type Term = Pick<DemoState['term'], 'startsOn' | 'endsOn' | 'isActive'>

export function bangkokDay(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
}

/** HTML datetime-local bounds must use the browser's zone, while term days use Bangkok. */
export function scoreEntryDateBounds(term: Term, now = new Date()) {
  const start = term.startsOn ? new Date(`${term.startsOn}T00:00:00+07:00`) : null
  const end = term.endsOn ? new Date(`${term.endsOn}T23:59:59+07:00`) : now
  const maximum = new Date(Math.min(now.getTime(), end.getTime()))
  const today = bangkokDay(now)
  return {
    min: start ? toLocalDateTimeInputValue(start) : undefined,
    max: toLocalDateTimeInputValue(maximum),
    // Never silently turn today's activity into an event on the last day of a past term.
    initialValue: term.isActive && (!term.startsOn || today >= term.startsOn) && (!term.endsOn || today <= term.endsOn)
      ? toLocalDateTimeInputValue(now) : '',
    ended: Boolean(term.endsOn && today > term.endsOn),
    notStarted: Boolean(term.startsOn && today < term.startsOn),
  }
}

export function validateScoreEntryDate(iso: string | null, term: Term, now = new Date()): string {
  if (!iso || !Number.isFinite(new Date(iso).getTime())) return 'กรุณาระบุวันและเวลาที่เกิดเหตุหรือทำกิจกรรมจริง'
  if (!term.isActive) return 'ภาคเรียนนี้ยังไม่เปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ'
  if (new Date(iso).getTime() > now.getTime() + 5 * 60_000) return 'วันและเวลาต้องไม่อยู่ในอนาคต'
  const day = bangkokDay(new Date(iso))
  if (term.startsOn && day < term.startsOn) return `วันที่ต้องไม่ก่อนวันเปิดภาคเรียน ${term.startsOn} ให้เลือกวันที่เกิดเหตุจริงในภาคเรียนนี้`
  if (term.endsOn && day > term.endsOn) return `วันที่ต้องไม่หลังวันปิดภาคเรียน ${term.endsOn} กิจกรรมแก้คะแนนเดิมให้ใช้เมนูภาคเรียนและงานแก้คะแนน`
  return ''
}
