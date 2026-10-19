# การจัดการปฏิทินภาคเรียน

แอดมินสามารถแก้วันเปิดและวันปิดของภาคเรียนจากหน้าเว็บได้ โดยหน้าเว็บต้องเรียก
`public.admin_update_term_schedule(p_term_id, p_starts_on, p_ends_on)` แทนการ
อัปเดตตารางโดยตรง

- วันที่ส่งเป็นรูปแบบ ISO `YYYY-MM-DD` และต้องระบุทั้งสองวัน
- วันเปิดต้องไม่อยู่หลังวันปิด ระบบยอมรับกรณีวันเดียวกันเพื่อรองรับภาคเรียนหรือ
  กิจกรรมช่วงสั้น
- แก้ได้เมื่อสถานะเป็น `planned` หรือ `active`
- ภาคเรียน `closed` แก้ผ่านขั้นตอนปกติไม่ได้ เพื่อรักษาประวัติรายงานเดิม
- การส่งวันที่เดิมซ้ำเป็นคำขอแบบ idempotent: คืน `updated = false` และไม่สร้าง
  audit ซ้ำ
- การเปลี่ยนวันที่สำเร็จจะบันทึกค่า `starts_on`, `ends_on` และ `status` ก่อนและ
  หลังแก้ไขใน `audit_logs`

RPC เปิดให้เรียกเฉพาะ role `authenticated` แต่ภายในยังตรวจ
`private.is_admin()` ทุกครั้ง ดังนั้นผู้เรียกต้องเป็นแอดมินที่โปรไฟล์ยัง active,
ผ่านการเปิดใช้บัญชีแล้ว และ JWT ปัจจุบันมี `amr.method = password` ผู้ใช้ทั่วไป,
OTP session, `anon` และ `service_role` เรียกขั้นตอนนี้โดยตรงไม่ได้

## เปิดใช้งานภาคเรียน

หลังบันทึกวันเปิด–ปิดแล้ว แอดมินเปิดภาคเรียนผ่าน
`public.admin_activate_term(p_term_id)` เท่านั้น ฟังก์ชันยอมรับเฉพาะภาคเรียน
สถานะ `planned` ที่มีวันครบทั้งคู่ ใช้ transaction-level advisory lock ร่วมกับ
row lock เพื่อป้องกันคำสั่งพร้อมกัน และจะปฏิเสธเมื่อมีภาคเรียนอื่นสถานะ `active`
อยู่แล้ว การเรียกซ้ำกับภาคเรียนที่ active แล้วเป็น no-op และไม่สร้าง audit ซ้ำ

หน้าเว็บต้องให้แอดมินติ๊กยืนยันว่าตรวจวันและรายชื่อแล้วก่อนเรียก RPC เมื่อสำเร็จ
จึงเปลี่ยนสถานะเป็น `active` และบันทึก `admin_activate_term` ใน `audit_logs`
ครูและนักเรียนจะไม่เห็นภาคเรียน `planned`; หากยังไม่มีภาคเรียน active หน้า error
ต้องแสดงข้อความที่เข้าใจได้ พร้อมปุ่มลองใหม่และออกจากระบบ

## วงจรสถานะภาคเรียน

ตั้งแต่ migration `20261019160647` แอปเขียนตาราง `academic_terms` ตรงไม่ได้แล้ว
(ยกเลิก policy `terms_admin_write` และสิทธิ์ INSERT/UPDATE/DELETE ของ `authenticated`)
และ trigger `academic_terms_lifecycle_guard` บังคับกับทุกผู้เขียน:

- สร้างใหม่ได้เฉพาะสถานะ `planned`
- `planned → active` ผ่าน `admin_activate_term` หรือการเปลี่ยนภาคเรียน
- `active → closed` ได้เฉพาะภายใน `admin_transition_term_v1`
- ภาคเรียน `closed` แก้ไม่ได้ ยกเว้น upsert แบบค่าเดิม (no-op) จากการนำเข้า
- ลบได้เฉพาะภาคเรียน `planned`

## เปิดภาคเรียนถัดไปและปิดภาคเรียนเดิม

ทุกภาคเรียนเริ่ม 100 ใหม่ และตัดคะแนนได้ตลอดภาคเรียน ขั้นตอนมี 3 RPC (แอดมินเท่านั้น):

1. `admin_prepare_next_term_v1(p_school_year, p_semester, p_name, p_starts_on, p_ends_on)`
   สร้างหรือใช้ภาคเรียน `planned` ของภาคถัดไปในปีการศึกษาเดียวกัน (ภาค 1 → 2)
   วันเริ่มต้องหลังวันปิดของภาคปัจจุบัน แล้วคัดลอกห้องเรียนที่ active, รายชื่อนักเรียน
   active และการมอบหมายครู active ส่งค่าเดิมซ้ำได้ผลเดิม (`replayed = true`) โดยไม่สร้างซ้ำ
   ส่งค่าต่างกันกับภาคเรียนที่เตรียมไว้แล้ว → `22023`; ภาคเรียน planned ที่มี roster อยู่แล้ว
   (เช่นจากการนำเข้า) → `55000` ให้ตรวจ roster แล้วเปลี่ยนภาคเรียนโดยตรง
   สิทธิ์ `score_all_classrooms` เป็นรายภาคเรียนและไม่ถูกคัดลอก
2. `admin_preview_term_transition_v1(p_next_term_id)` อ่านอย่างเดียว คืน `blockers`,
   `canTransition`, `counts` (คำขอค้าง, อุทธรณ์ค้าง, ช่วงอุทธรณ์ที่ยังเปิด, จำนวนที่คาดว่าต่ำกว่า 80,
   roster ภาคถัดไป, นักเรียนที่ไม่ได้ย้ายต่อ, เคสแก้คะแนนค้าง) และ `students` พร้อมยอดปัจจุบัน
3. `admin_transition_term_v1(p_current_term_id, p_next_term_id, p_client_request_id)`
   ทำใน transaction เดียว: ตรวจ blocker ซ้ำภายใต้ lock, บันทึก `term_closing_snapshots`
   ทุกนักเรียน (บัญชีคะแนนของผู้ที่ลงทะเบียนอยู่ต้องครบก่อนปิดเทอม), เปิด
   `term_remediation_cases` ให้คนที่ยอดปิด < 80, ปิดภาคเดิม, เปิดภาคใหม่ และสร้างบัญชี 100
   ให้ทุก enrollment ที่ active พร้อมตรวจผล ผิดพลาดใดก็ rollback ทั้งหมด

Blocker ที่ทำให้เปลี่ยนภาคเรียนไม่ได้: `NO_ACTIVE_TERM`, `CURRENT_TERM_NOT_ACTIVE`,
`CURRENT_TERM_ALREADY_TRANSITIONED`, `NEXT_TERM_NOT_FOUND`, `SAME_TERM`,
`NEXT_TERM_NOT_PLANNED`, `NEXT_TERM_DATES_MISSING`, `NEXT_TERM_NOT_LATER`,
`NEXT_TERM_OVERLAPS_CURRENT`, `NEXT_TERM_EMPTY_ROSTER`, `NEXT_TERM_INVALID_ROSTER`,
`NEXT_TERM_HAS_SCORE_ACTIVITY`, `PENDING_ADDITION_REQUESTS`, `PENDING_DEDUCTION_REQUESTS`,
`CURRENT_TERM_MISSING_ACCOUNTS` (ต้องตรวจสอบและเตรียมคะแนนเดิมให้ครบก่อน)
อุทธรณ์ที่ค้างหรือยังไม่หมดเวลาไม่บล็อก แต่แสดงใน preview

หากการแก้คำตัดสินอุทธรณ์ภายหลังทำให้คนที่เดิมปิดภาคผ่านแล้วมีคะแนนต่ำกว่า 80
ระบบจะเปิดงานแก้ใหม่ให้โดยเก็บคะแนนปิดภาคเดิมไว้ ส่วนคนที่เคยมีงานแก้จะปรับสถานะ
ผ่าน/ยังไม่ผ่านตามยอดล่าสุดของภาคต้นเรื่อง โดยไม่เปลี่ยนคะแนนภาคเรียนใหม่

## ลำดับติดตั้งบนระบบจริง

ติดตั้ง migration `20261019160523` ก่อน `20261019160647` เพื่อ commit enum ใหม่ก่อนใช้งาน
และติดตั้งทั้งสองไฟล์ใน Supabase ให้สำเร็จก่อนเผยแพร่ frontend รุ่นนี้ การติดตั้ง schema
ไม่ปิดภาคเรียนหรือเปลี่ยนคะแนนให้อัตโนมัติ แอดมินต้องเตรียมวันเปิด–ปิด ตรวจรายชื่อ
และตรวจ preview ก่อนยืนยันเปลี่ยนภาคเรียนผ่านหน้าเว็บ

หมายเลขสองไฟล์นี้ตรงกับประวัติที่ Supabase บันทึกตอนติดตั้งจริง โดยคงเนื้อหา SQL
จากรุ่นที่ทดสอบไว้ และไม่เขียนทับประวัติ migration ในฐานข้อมูล

สคริปต์ล้างข้อมูลทดลองเดิมยังไม่ครอบคลุมตารางประวัติ/งานแก้ใหม่ และจะหยุดที่ข้อกำหนด
foreign key แทนการล้างข้อมูลย้อนหลัง ห้ามเติม `CASCADE` เพื่อข้ามข้อกำหนดนี้

Idempotency: `p_client_request_id` เดิม + ค่าเดิม → ผลเดิม (`replayed = true`);
ID เดิมแต่ค่าต่าง → `22023`; ภาคเรียนที่เปลี่ยนไปแล้วด้วย ID ใหม่ → `55000`

## การล็อกและการเขียนคะแนนหลังปิดภาค

- เส้นทาง `ensure_score_account` ล็อกภาคเรียนแบบ `FOR SHARE` ก่อนบัญชี ส่วนการแก้บัญชี
  เดิม/พิจารณางานแก้ล็อกบัญชี → ภาคเรียนแบบ shared → เคสแก้คะแนน การเปลี่ยนภาคเรียน
  ล็อกแถวภาคเรียน `FOR UPDATE` โดยไม่ล็อกหรือเขียนบัญชีภาคเดิม จึงไม่เกิดวงจรกับ
  เส้นทางให้คะแนนเดิม และรายการที่รออยู่ต้องตรวจสถานะภาคเรียนอีกครั้งก่อนลง ledger
- trigger `score_ledger_term_guard`: ภาค `active` รับทุกประเภท (ยกเว้น `remediation_credit`),
  ภาค `planned` รับเฉพาะ `semester_opening`, ภาค `closed` รับเฉพาะ `appeal_adjustment`
  (อุทธรณ์ตามกฎเดิม) และ `remediation_credit` จาก workflow ตรวจคำขอเท่านั้น
- คำขอเพิ่ม/ตัดคะแนนใหม่สร้างได้เฉพาะภาคเรียน `active`
- การอนุญาตปิดภาคและลงเครดิตใช้ token ใน `private.term_write_authorizations` ผูกกับ
  transaction ปัจจุบัน ไม่ใช้ GUC ที่ client ตั้งเองได้
- มี unique index `score_ledger_one_opening_idx` (หนึ่ง opening ต่อบัญชี) หากข้อมูลเดิมซ้ำ
  migration จะหยุดพร้อมคำสั่งตรวจ ให้แก้ข้อมูลผ่าน migration ที่ได้รับอนุมัติก่อน

## การแก้คะแนนของภาคเรียนเดิม

- ยอดปิดภาค (`closingScore`) ไม่เปลี่ยนตลอดไป; ยอดภาคเดิมหลังปรับ (`currentScore`)
  มาจากบัญชีของภาคเดิม ส่วนภาคปัจจุบันไม่ได้รับผลใด ๆ
- เคสผ่านอัตโนมัติเมื่อยอดภาคเดิม ≥ threshold ที่เก็บไว้ในเคส (80) และกลับเป็น `open`
  ถ้าอุทธรณ์ที่ตัดสินใหม่ทำให้ยอดต่ำกว่าเกณฑ์ ทุกการเปลี่ยนสถานะบันทึก audit
- `request_term_remediation_v1(p_case_id, p_points, p_activity_occurred_at, p_reason, p_client_request_id)`
  ครูที่ได้รับมอบหมายนักเรียนในภาคปัจจุบัน ครูที่ได้รับมอบหมายเคส หรือแอดมิน; เคสต้อง `open`
  และมีคำขอรอได้ครั้งละหนึ่งรายการ วันที่ทำกิจกรรมจริงเก็บแยกจากภาคที่ได้เครดิต
- `review_term_remediation_v1(p_request_id, p_approve, p_review_note, p_client_request_id)`
  แอดมินเท่านั้น; อนุมัติแล้วลง `remediation_credit` ในบัญชีภาคเดิม (เพดาน 100) พร้อม
  `score_ledger.remediation_request_id` เป็น provenance ที่ unique; ปฏิเสธต้องมีหมายเหตุ
- `admin_assign_term_remediation_teacher_v1(p_case_id, p_teacher_id, p_reason)`
  มอบหมายหรือยกเลิก (`NULL`) ครูผู้รับผิดชอบเคส
- ไม่มีเส้นตายและไม่บล็อกการจบการศึกษา

## RPC สำหรับอ่าน

- `list_academic_terms_v1()` รายการภาคเรียนพร้อมปี ภาค วันที่ สถานะ `closedAt`
  ครู/นักเรียนไม่เห็นภาค `planned`
- `get_term_history_v1(p_term_id, p_student_id default null)` ข้อมูลภาคเรียนและรายนักเรียน:
  `latestScore`, `closingScore`, `closingAccountMissing`, `threshold`, `remediation`,
  `history` (ไม่มี actor ID ชื่อผู้บันทึก บันทึกภายใน หรือหลักฐาน)
- `list_term_remediations_v1(p_include_passed default true)` เคสพร้อม `sourceTerm`,
  `student`, `currentClassroom` (NULL เมื่อไม่อยู่ใน roster ปัจจุบัน), `closingScore`,
  `currentScore`, `threshold`, `pointsNeeded`, `status`, `requests`, `changesSinceClose`

ขอบเขต: แอดมินและผู้อำนวยการเห็นทุกเคส ไม่ขึ้นกับ roster ปัจจุบัน (ผู้อำนวยการอ่านอย่างเดียว);
ครูเห็นเฉพาะนักเรียนที่สอนในภาคปัจจุบันหรือเคสที่ได้รับมอบหมาย; นักเรียนเห็นเฉพาะของตัวเอง
และไม่เห็นเหตุผลภายในหรือชื่อผู้ขอ ตารางใหม่ทั้งหมดเปิด RLS และไม่มีสิทธิ์ตรงสำหรับแอป

## นโยบายแจ้งผู้ปกครอง

`guardian_contact_required` ถูกกำหนดจากระดับความรุนแรงเสมอ:

- `serious` และ `critical`: ต้องสร้างงานติดต่อผู้ปกครอง
- `low` และ `medium`: ไม่สร้างงานติดต่อผู้ปกครอง

ฐานข้อมูลมีทั้ง CHECK constraint ที่กฎพฤติกรรมและ trigger ที่งานติดต่อ เพื่อกัน
ข้อมูลคลาดเคลื่อนแม้มีการเขียนจาก backend ที่มีสิทธิ์สูง งานติดต่อจะอ้างอิงได้
เฉพาะเหตุการณ์ร้ายแรง/วิกฤตและต้องเป็นนักเรียนคนเดียวกับเหตุการณ์เท่านั้น
