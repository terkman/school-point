import { formatThaiDate, type DemoState } from './domain'
import { scoreEntryDateBounds } from './scoreEntryDates'

export function ScoreTermContext({ term, onOpenTerms }: { term: DemoState['term']; onOpenTerms: () => void }) {
  const bounds = scoreEntryDateBounds(term)
  return <aside className="score-term-context" aria-label="ภาคเรียนที่จะได้รับรายการคะแนน">
    <strong>กำลังลงคะแนนให้ {term.label}</strong>
    <p>เลือกวันที่เกิดเหตุหรือทำกิจกรรมจริง{term.startsOn ? ` ตั้งแต่ ${formatThaiDate(term.startsOn, false)}` : ''}{term.endsOn ? ` ถึง ${formatThaiDate(term.endsOn, false)}` : ''} และไม่เกินเวลาปัจจุบัน ตามเวลาไทย</p>
    {bounds.ended ? <p className="form-error">ภาคเรียนนี้สิ้นสุดแล้ว กรุณาเลือกวันที่ย้อนหลังตามเหตุการณ์จริงภายในช่วงภาคเรียน ระบบจะไม่เลือกวันปิดภาคให้โดยอัตโนมัติ</p> : null}
    {bounds.notStarted ? <p className="form-error">ยังไม่ถึงวันเริ่มภาคเรียน จึงยังลงเหตุการณ์ของวันนี้ไม่ได้</p> : null}
    <button className="button ghost" type="button" onClick={onOpenTerms}>ดูประวัติและกิจกรรมแก้คะแนนภาคเรียนเดิม</button>
  </aside>
}
