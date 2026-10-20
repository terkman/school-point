/** Translate known database messages; retain unknown errors for support and diagnostics. */
export function schoolServerError(error: { message: string; code?: string }): string {
  const message = error.message
  if (/outside (the )?(active )?term|outside.*term.*(date|range)|(?:within|inside).*term|before.*term.*start|after.*term.*end/i.test(message)) return 'วันที่อยู่นอกช่วงเปิด–ปิดของภาคเรียน กรุณาเลือกวันที่เกิดเหตุจริงในเทอมที่กำลังใช้งาน กิจกรรมแก้คะแนนเทอมเดิมให้ใช้เมนูภาคเรียนและงานแก้คะแนน'
  if (/future|later than.*now/i.test(message)) return 'วันและเวลาต้องไม่อยู่ในอนาคต กรุณาตรวจวันที่ทำกิจกรรมจริง'
  if (/pending.*(addition|deduction)|pending.*requests/i.test(message)) return 'ยังมีคำขอคะแนนรอพิจารณา กรุณาจัดการรายการค้างแล้วตรวจความพร้อมอีกครั้ง'
  if (/overlap/i.test(message)) return 'วันเปิด–ปิดภาคเรียนซ้อนกับภาคเรียนอื่น กรุณาตรวจและแก้ไขวันที่'
  if (/term.*closed|closed.*term|term.*not active|active term.*required|no active academic term/i.test(message)) return 'ภาคเรียนนี้ไม่ได้เปิดใช้งานแล้ว กรุณาโหลดข้อมูลล่าสุด กิจกรรมแก้คะแนนให้เข้าภาคเรียนเดิม'
  if (/permission denied|administrator.*required|admin.*only|not authorized/i.test(message)) return 'บัญชีนี้ไม่มีสิทธิ์ดำเนินการ กรุณาใช้บัญชีผู้ดูแลหรือผู้ที่ได้รับสิทธิ์'
  return message
}
