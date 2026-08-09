# Admin UX/UI implementation specification

สถานะ: เริ่มพัฒนา Phase 0 — Foundation  
ปรับปรุงล่าสุด: 3 สิงหาคม 2569  
ชื่อผลิตภัณฑ์: ยังไม่สรุป ใช้ `ระบบดูแลนักเรียน` เป็นข้อความชั่วคราวในต้นแบบเท่านั้น

## 1. เป้าหมาย

ปรับ UX/UI ฝั่งผู้ดูแลระบบให้เหมาะกับงานโรงเรียนจริง โดยให้งานประจำวันเสร็จเร็วบนมือถือ และให้งานตรวจสอบ จัดการข้อมูล และรายงานทำได้ชัดเจนบนเดสก์ท็อป

งานที่ต้องเร็วที่สุดคือ:

1. เลือกนักเรียนและเพิ่ม/ตัดคะแนน
2. ตรวจคำขอที่ต้องอนุมัติ
3. ติดตามกรณีร้ายแรงและแจ้งผู้ปกครอง

ระบบต้องรักษาประวัติแบบ append-only: รายการคะแนนและ audit log ห้ามแก้หรือลบย้อนหลัง การแก้ไขใช้รายการชดเชยหรือเวอร์ชันใหม่

## 2. Information architecture ที่อนุมัติ

### เดสก์ท็อป

- ภาพรวม
- คะแนน
- งานรอตรวจ
- เคสร้ายแรง
- จัดการระบบ
  - นักเรียน
  - เอกสารนักเรียน
  - บุคลากรและสิทธิ์
  - กฎคะแนน
  - นำเข้าข้อมูล
  - ปีการศึกษาและห้องเรียน
  - เลื่อนชั้น/จบการศึกษา/ย้ายโรงเรียน
- รายงาน
  - ภาพรวม
  - นักเรียนที่ต้องดูแล
  - ประวัติตรวจสอบ

### มือถือ

Bottom navigation หลัก:

- วันนี้
- คะแนน
- เคส
- ระบบ

งานรอตรวจและรายงานเข้าผ่านหน้า “วันนี้” หรือ “ระบบ” และต้องมี badge แสดงจำนวนงานค้าง

### URL และ navigation contract

ระบบปัจจุบันใช้ local state สำหรับแท็บทั้งหมด ก่อนพัฒนาควรเพิ่ม URL-backed navigation เพื่อให้ refresh, back, forward และการส่งลิงก์ยังคงหน้ากับตัวกรองเดิม

เส้นทางเสนอ:

- `/admin/today`
- `/admin/score`
- `/admin/reviews`
- `/admin/cases`
- `/admin/system/students`
- `/admin/system/staff`
- `/admin/system/rules`
- `/admin/system/import`
- `/admin/system/academic-years`
- `/admin/system/progression`
- `/admin/reports?tab=overview`
- `/admin/reports?tab=care`
- `/admin/reports?tab=audit`

Search params ใช้เก็บ filter, sort, selected row และ drawer/sheet ที่เปิดอยู่ เมื่อกดย้อนกลับต้องปิดรายละเอียดและคืนตำแหน่งรายการเดิม

## 3. Design system contract

### สี

ค่าต่อไปนี้เป็นค่าเริ่มต้นสำหรับนำไป sample จากภาพต้นแบบอีกครั้งก่อนลง CSS จริง:

| บทบาท | ค่าเริ่มต้น | การใช้งาน |
|---|---:|---|
| Navy header | `#062B66` | top bar, brand context |
| Navy text | `#102A56` | heading, primary text |
| Teal primary | `#078B8E` | primary action, active tab, success |
| Blue workflow | `#1769D2` | งานรอตรวจและ link |
| Purple | `#6D35D7` | อุทธรณ์และกฎ |
| Amber | `#D97706` | warning และใกล้ครบกำหนด |
| Red | `#DC2626` | ต่ำกว่าเกณฑ์, เลยกำหนด, destructive/critical เท่านั้น |
| True white | `#FFFFFF` | page และ surface หลัก |
| Pale selection | `#EFF6FF` | selected row |
| Border | `#D7E0ED` | separator และ control border |
| Muted text | `#60708C` | metadata และคำอธิบาย |

ห้ามเปลี่ยนพื้นหลังสีขาวเป็นครีมหรือเทาอุ่น และห้ามใช้ gradient ใน app shell

### ตัวอักษร

- หลัก: `Noto Sans Thai`
- fallback: `Leelawadee UI`, Tahoma, system-ui, sans-serif
- H1 desktop: 28–32px / 700–800
- H1 mobile: 25–28px / 700–800
- H2: 18–22px / 700
- body: 15–16px / 400–500
- UI controls: 14–16px / 500–700
- metadata: 12–14px / 400–500
- ตารางต้องไม่ลดต่ำกว่า 13px เพื่อยัดข้อมูล

### ระยะและรูปทรง

- spacing scale: 4, 8, 12, 16, 20, 24, 32, 40
- control height desktop: 40–44px
- touch target mobile: 44–48px เป็นอย่างน้อย
- radius: 6–10px; ไม่ทำทุกส่วนเป็นการ์ดโค้งขนาดใหญ่
- shadow ใช้เฉพาะ drawer, dialog, sheet และ floating layer
- table/list ใช้เส้นคั่นบางและพื้นที่ว่าง ไม่ห่อทุกแถวด้วย card

### Icon contract

- outline icon ชุดเดียวกัน stroke ประมาณ 1.8–2px
- ขนาดมาตรฐาน 18, 20, 24px
- icon ต้องสื่อความหมายตรงกับต้นแบบ เช่น approval, alert, phone, export, rule, appeal
- chevron และ disclosure ใช้ SVG/component ไม่ใช้ตัวอักษรธรรมดา

### Component families

- `AdminAppShell`
- `DesktopSidebar` / `MobileBottomNav`
- `PageHeading`
- `Tabs`
- `FilterBar` / `MobileFilterSheet`
- `SearchField`
- `SemanticTable` / `MobileRecordList`
- `DetailDrawer` / `MobileDetailSheet`
- `ScoreActionForm`
- `StudentSelector`
- `ReviewPanel`
- `StatusLabel`
- `DeadlineLabel`
- `BeforeAfterDiff`
- `ConfirmDialog`
- `ToastOrAnnouncement`
- `EmptyState`, `LoadingState`, `ErrorState`, `StaleState`

## 4. Screen and concept inventory

ไฟล์ภาพอยู่ใน Codex generated-images ของ task เดิม โดยอ้างอิงจากชื่อไฟล์ด้านล่าง ภาพที่อนุมัติเป็น visual specification ไม่ใช่ภาพที่จะนำมาแสดงแทน UI จริง

### งานประจำวันและคะแนน

| Surface | Concept | สถานะ |
|---|---|---|
| Dashboard desktop | `exec-e5275308-6975-4fa6-9d81-718339581da6.png` | อนุมัติ |
| Dashboard mobile | `exec-a105ab9b-e629-4256-a62b-5fdc313f9626.png` | อนุมัติ |
| เลือกนักเรียน | `docs/design/admin/phase-1/student-selector-mobile-approved.png` | อนุมัติ: checkbox แบบเดียว เลือกหนึ่งคน/หลายคน/ทั้งหมดในห้องได้ |
| แบบฟอร์มตัดคะแนน | `exec-8081f81e-4a37-47a4-8476-488dba94d6cb.png` | อนุมัติทิศทาง |
| เพิ่มคะแนนโดยตรง | `exec-120b8c9e-08f3-45d5-bcac-c50733cd269f.png` | อนุมัติทิศทาง |
| ตรวจสอบก่อนตัดคะแนน | `exec-438982ff-57b1-4b71-bbe4-e2b56bd87e10.png` | อนุมัติทิศทาง |
| ศูนย์อนุมัติ | `exec-b1224bf7-ed6f-4b90-843f-33525eeb040f.png` | อนุมัติทิศทาง |
| ปรับคำขอเพิ่มคะแนน | `exec-c654c9e6-ac55-47cb-9fb8-b1d1c030970b.png` | อนุมัติทิศทาง |
| พิจารณาอุทธรณ์ | `exec-e041b6b6-9007-487c-959e-e5a517e8f8c7.png` | อนุมัติทิศทาง |
| รายละเอียดเคสร้ายแรง | `exec-537d1c22-308a-4a1f-8cc6-b15ec4f2c075.png` | อนุมัติทิศทาง |

### จัดการระบบ

| Surface | Concepts | สถานะ |
|---|---|---|
| กฎคะแนน | `exec-12e12de2...`, `exec-06200ea8...`, `exec-1dc9ef32...`, `exec-18f6a920...` | อนุมัติ |
| CSV/Excel import | `exec-e2a6039d...`, `exec-a623cc5b...`, `exec-0e4e837a...`, `exec-1a281440...`, `exec-b12177ba...` | อนุมัติ |
| รายชื่อนักเรียนและ lifecycle | `exec-55f1b292...`, `exec-119f92a6...`, `exec-9c8f6db9...`, `exec-c34a7824...`, `exec-261b920a...`, `exec-6085543d...` | อนุมัติ |
| จบการศึกษา | `exec-bf08184f...`, `exec-e10a6f0b...` | อนุมัติ |
| เลื่อนชั้น | `exec-b511ce5d...`, `exec-a2892aa4...` | อนุมัติ |
| บุคลากรและสิทธิ์ | `exec-675069b8...`, `exec-34e16069...`, `exec-bb415878...`, `exec-31161fb2...` | อนุมัติ |
| เปิดปีการศึกษาใหม่ | ยังไม่มีภาพ governing concept | ต้องออกแบบก่อนพัฒนาหน้านี้ |

### รายงาน

| Surface | Desktop | Mobile | สถานะ |
|---|---|---|---|
| ภาพรวม | `exec-00f1a69a-8306-49d4-8253-e7328110d98d.png` | `exec-7e1b7e88-03a8-4c90-96f9-774a52a3f43b.png` | อนุมัติ |
| นักเรียนที่ต้องดูแล | `exec-11494d0c-454b-4715-97f4-63ddaff0ffac.png` | `exec-f914fa1a-3f18-4921-bc75-0209e92c5573.png` | อนุมัติ |
| ประวัติตรวจสอบ | `exec-3afa426d-969c-47d0-bbbe-3d609d2388be.png` | `exec-aed599b2-ce93-464b-ada2-4f072315b96e.png` | อนุมัติ |

### เอกสารกระดาษสำหรับนักเรียน

| Surface | Concept | สถานะ |
|---|---|---|
| ใบสรุปคะแนนความประพฤติ | `exec-44ad63b3-2931-4c38-886d-6bd3d4c94941.png` | อนุมัติ |
| แบบฟอร์มอุทธรณ์รายการคะแนน | `exec-762ce0a5-0672-4618-81a4-45b2f25e57c7.png` | อนุมัติ |
| ใบแจ้งผลการอุทธรณ์ | `exec-3114af3b-8d6a-4534-9d36-5e7eb5f408af.png` | อนุมัติ |

ต้นฉบับทั้งสามเป็น A4 หนึ่งนักเรียนต่อหนึ่งฉบับ ใช้เป็น visual specification ของ print view และไม่ใช่ภาพที่นำไปแสดงแทนข้อความ ตาราง หรือตัวควบคุมจริงในเว็บ

## 5. Business rules ที่ล็อกแล้ว

### คะแนนและคำขอ

- คะแนนอยู่ระหว่าง 0–100
- ครูพิมพ์เหตุการณ์ใหม่และกำหนดคะแนนตัด 1–100 ได้
- กฎมาตรฐานเสนอคะแนนเริ่มต้น แต่ครูแก้ได้
- 1–9 คะแนนมีผลทันที
- ตั้งแต่ 10 คะแนนขึ้นไปต้องรอแอดมินอนุมัติ
- severity คำนวณจากคะแนนสุดท้ายตามช่วง 1–9, 10–24, 25–54, 55–100
- ถ้าคะแนนคงเหลือน้อยกว่าเหตุการณ์ ให้หักจริงจนถึง 0 แต่ severity ใช้คะแนนเหตุการณ์ที่อนุมัติ
- เหตุร้ายแรง/วิกฤตยังถูกบันทึกและเปิดเคส แม้คะแนนที่หักจริงเป็น 0
- ครูส่งคำขอเพิ่มคะแนนโดยไม่มีคำบรรยายและรูปได้
- แอดมินอนุมัติตามเดิมได้โดยไม่ต้องเขียนเหตุผล
- ปฏิเสธหรือปรับคะแนนต้องระบุเหตุผล และครูผู้ส่งคำขอเห็นเหตุผล

### อุทธรณ์

- แอดมินต้องเขียนคำชี้แจงให้นักเรียนทุกผลการพิจารณา
- คืนคะแนนบางส่วนได้
- นักเรียนเห็นผู้ตอบเป็น `ฝ่ายปกครอง`
- ครูผู้บันทึกไม่เห็นผลและคำชี้แจง
- การตัดสินถือเป็นที่สุด นักเรียนยื่นซ้ำกับรายการเดิมไม่ได้
- แอดมินเปิดพิจารณาใหม่ได้เมื่อระบุเหตุผลและเกิด audit event ใหม่

### ผู้ปกครองและเคสร้ายแรง

- โทรติดและรับสาย: ปิดงานแจ้งได้
- โทรไม่รับ: ยังไม่ปิด อยู่ในคิวติดตาม
- LINE/Messenger: ปิดเมื่อผู้ปกครองอ่านหรือตอบกลับ
- SMS: ตัวเลือกสุดท้าย ส่งแล้วปิดงานแจ้งได้
- หลักฐานการแจ้งเป็นตัวเลือก
- เตือนติดตามอีกครั้งเมื่อครบ 24 ชั่วโมง
- ปิดเคสได้เมื่อเงื่อนไขการแจ้งผู้ปกครองเสร็จแล้ว

### นักเรียนและปีการศึกษา

- สถานะ: active, suspended, graduated, archived/moved out
- ระงับชั่วคราวคงห้องเดิม บล็อก login และรายการคะแนนใหม่
- คืนสถานะด้วยเหตุผลและไม่ย้ายห้องอัตโนมัติ
- ย้ายห้องภายในโรงเรียนไม่ใช้เกณฑ์ 80 คะแนน แต่ต้องมีเหตุผลและ audit
- เลื่อนชั้น จบการศึกษา หรือย้ายโรงเรียน ต้องคะแนนภาคเรียนปัจจุบันอย่างน้อย 80
- ต้องไม่มีเคสร้ายแรงเปิด อุทธรณ์ค้าง หรือคำขอคะแนนค้าง
- revalidate อีกครั้งตอน commit
- ปีใหม่เริ่มคะแนน 100 และเก็บประวัติเดิม

### ช่องทางเอกสารกระดาษสำหรับนักเรียน

- เปิดใช้ได้ทุกระดับชั้น ไม่ผูกกับอายุหรือการมีโทรศัพท์
- เอกสารกระดาษเป็นช่องทางดูข้อมูลและส่งเรื่อง ไม่ใช่วิธีเข้าสู่ระบบ
- รุ่นแรกยังไม่ทำบัญชีผู้ปกครองและโหมดเครื่องส่วนกลางสำหรับนักเรียน
- ครูพิมพ์ได้เฉพาะนักเรียนในห้องที่ได้รับมอบหมาย; ฝ่ายปกครอง/แอดมินพิมพ์ได้ทั้งโรงเรียนตาม scope
- เอกสารหนึ่งหน้าต้องเป็นของนักเรียนหนึ่งคน ห้ามรวมคะแนนหลายคนในหน้าเดียว
- เอกสารทุกฉบับมีเลขเอกสาร ภาคเรียน วัน–เวลาที่ออก และข้อความว่าเป็นข้อมูล ณ เวลาที่พิมพ์
- ห้ามแสดงชื่อครูผู้บันทึก บันทึกภายใน ไฟล์หลักฐาน หรือข้อมูลผู้ปกครอง
- การพิมพ์ การรับแบบฟอร์มกลับ และการส่งมอบผลต้องเกิด audit event

เอกสารรุ่นแรกมี 3 ประเภท:

1. `ใบสรุปคะแนนความประพฤติ` — คะแนนปัจจุบัน รายการที่นักเรียนมีสิทธิ์เห็น และสถานะเรื่องที่กำลังดำเนินการ
2. `แบบฟอร์มอุทธรณ์รายการคะแนน` — ระบบเติมข้อมูลนักเรียนและรายการคะแนนไว้ล่วงหน้า นักเรียนเขียนเหตุผลและลงลายมือชื่อ
3. `ใบแจ้งผลการอุทธรณ์` — ผลการพิจารณา คะแนนที่คืน และคำชี้แจงในนามฝ่ายปกครอง

Paper appeal workflow:

1. นักเรียนขอแบบฟอร์มจากครูหรือฝ่ายปกครอง
2. ระบบพิมพ์แบบฟอร์มที่ผูกกับ incident/document ID โดยไม่ใช้ QR หรือ PIN ในรุ่นแรก
3. นักเรียนกรอกและส่งคืนฝ่ายปกครอง
4. ฝ่ายปกครอง/แอดมินคัดลอกข้อความตามต้นฉบับเข้าระบบ โดยบันทึก source=`paper`, วันรับเอกสาร และผู้รับเรื่อง
5. ระบบใช้กฎอุทธรณ์เดิมและห้ามสร้างอุทธรณ์ซ้ำกับ incident เดียวกัน
6. เมื่อพิจารณาเสร็จ ระบบพิมพ์ใบแจ้งผลและบันทึกสถานะ `พิมพ์แล้ว` / `ส่งมอบแล้ว`
7. เอกสารต้นฉบับเก็บตามนโยบายของโรงเรียน; การแนบไฟล์สแกนเป็นตัวเลือกและต้องใช้ privacy policy เดียวกับหลักฐานอื่น

### บุคลากรและสิทธิ์

- แยกตำแหน่งในโรงเรียนออกจากสิทธิ์ระบบ
- หนึ่งบัญชีมี permission bundle ได้หลายชุด
- bundles: teacher, discipline, executive-read-only, data-manager, admin
- scope แยกเป็นห้องที่เลือกหรือทั้งโรงเรียน
- ไม่มี super admin; แอดมินทุกคนระดับเดียวกัน
- แอดมินแก้สิทธิ์หรือระงับบัญชีตนเองไม่ได้
- ห้ามปิดหรือลบแอดมินที่ใช้งานได้คนสุดท้าย
- เปลี่ยนสิทธิ์แอดมินต้องระบุเหตุผล ยืนยัน และเก็บ audit
- activation code ใช้ครั้งเดียว อายุ 24 ชั่วโมง; ออกใหม่แล้วรหัสเก่าใช้ไม่ได้

## 6. Gap analysis: code และ schema ปัจจุบัน

| ระดับ | ช่องว่าง | หลักฐานปัจจุบัน | งานที่ต้องทำ |
|---|---|---|---|
| P0 | Deduction approval >=10 | `record_deductions_bulk` หักทันทีและต้องมี `rule_id` | เพิ่ม deduction request/batch, custom incident, requested/approved points และ review RPC |
| P0 | Guardian communication states | `guardian_contact_tasks` มี pending/completed/cancelled และ note เดียว | เพิ่ม contact attempts, channel, outcome, read/reply state, next reminder, evidence metadata |
| P0 | Addition adjustment | `review_point_addition` ไม่มี approved points และบังคับ note ทุกกรณี | เพิ่ม approved points; note บังคับเฉพาะ reject/adjust; เก็บ requested vs approved |
| P0 | Partial appeal restore/reopen | `review_appeal` รองรับ accept/reject เท่านั้น | เพิ่ม restored points, public explanation, reopen reason/version และ privacy projection |
| P0 | Permission bundles | ระบบมี role เดียวต่อ profile | เพิ่ม permissions, scopes, grants และ RLS helper; migrate role เดิม |
| P1 | Rule lifecycle/versioning | rule มี active/effective dates แต่ไม่มี version/delete state API | เพิ่ม rule versions, generated code, deactivate/reactivate/delete safeguards และ audit RPC |
| P1 | Student lifecycle transactions | directory update รวมข้อมูลส่วนตัว สถานะ และห้องในคำสั่งเดียว | แยก edit, transfer, suspend, restore, move-out พร้อม reason และ atomic audit |
| P1 | Promotion/graduation | ไม่มี preview/commit batch RPC | เพิ่ม eligibility view, snapshot token, atomic commit และ roster-change guard |
| P1 | Academic-year transition | มี term schedule/activate/reset แต่ยังไม่ copy/edit classroom structure ตาม flow ใหม่ | เพิ่ม preview copy, edit mapping และ activate transaction |
| P1 | Web CSV import | file input รับ `.xlsx` ไฟล์เดียว | เพิ่ม multi-file CSV parser, type/header detection, mapping, preview diff และ history |
| P1 | Reports | `DirectorDashboard` แสดง flat transaction list | เพิ่ม report queries, condition roster, audit projection, URL filters, table fallback และ export |
| P1 | Paper student access | ยังไม่มี document model, print view หรือ paper appeal intake | เพิ่ม document IDs, A4 print views, print/delivery audit และ source=`paper` |
| P2 | M4–M6 | `GradeLevel` จบที่ M3 | ขยาย enum/type/validation/template สำหรับ M4–M6 ก่อนใช้กับโรงเรียนระดับปลาย |
| P2 | App routing | `AdminDashboard` ใช้ component state และมีไฟล์ 1,380 บรรทัด | เพิ่ม route/state contract และแยก feature modules |
| P2 | Responsive coverage | management screens หลายหน้าไม่มี governing mobile concept | กำหนด responsive behavior/visual extraction ก่อน implement แต่ละโมดูล |

## 7. UI states ที่ต้องมีทุกโมดูล

- loading แบบรักษา layout ไม่กระโดด
- empty state ที่บอกว่าทำอะไรต่อได้
- recoverable error พร้อม retry
- permission denied โดยไม่เผยข้อมูลที่ไม่มีสิทธิ์
- stale/last-updated สำหรับรายงานและคิวงาน
- optimistic busy state ป้องกัน submit ซ้ำ
- idempotent replay success สำหรับคำสั่งที่ retry ได้
- conflict state เมื่อข้อมูลเปลี่ยนระหว่าง preview และ commit
- validation summary + field-level error
- unsaved changes guard สำหรับ form ยาว
- success state ที่ระบุผลจริง เช่น หักได้กี่คะแนน เปิดกี่เคส
- offline/spotty connection: คงข้อมูลล่าสุดที่ดูได้และห้ามแสดงว่าบันทึกสำเร็จจน server ยืนยัน

## 8. งานนอกเหนือจาก UX/UI

งานต่อไปนี้จำเป็นต่อ workflow แต่เป็น backend/infrastructure ไม่ใช่งานตกแต่งหน้าเว็บ:

- Supabase schema migrations และข้อมูลย้อนหลัง
- RPC transaction, idempotency และ row locking
- RLS สำหรับ permission bundle/scope
- background reminder 24 ชั่วโมง
- การส่งหรือเชื่อมต่อ LINE, Messenger และ SMS หากต้องการให้ระบบส่งจริง
- PDF/Excel export generation
- CSV parsing/encoding/header detection
- audit event normalization จาก JSON เป็นข้อความมนุษย์อ่านได้
- A4 PDF/print CSS, document numbering และ print/delivery audit
- privacy review สำหรับหลักฐาน รูป และข้อมูลผู้ปกครอง
- automated tests: SQL assertions, unit, integration, E2E และ visual regression

## 9. ลำดับพัฒนาที่แนะนำ

### Phase 0 — Foundation

1. เพิ่ม route contract โดยยังคง demo/Supabase modes
2. แยก app shell, tokens และ reusable components
3. ขยาย domain types และ demo fixtures ให้รองรับ workflow ใหม่
4. เพิ่ม migration/RPC พื้นฐานสำหรับ request, audit และ permissions

### Phase 1 — Daily score operations

1. Dashboard desktop/mobile
2. Student selector แบบ checkbox เดียว + เลือกทั้งหมดตามผลค้นหา/ห้อง
3. Admin add/deduct flow
4. Teacher deduction request >=10 และ custom incident
5. Review center สำหรับ add/deduct request
6. ใบสรุปคะแนนความประพฤติแบบ A4 และการพิมพ์รายคน/รายห้อง

### Phase 2 — Serious cases and appeals

1. Guardian contact attempts และ 24-hour due state
2. Case queue/detail/close rules
3. Appeal partial restore และ reopen audit
4. Dashboard counters/deep links
5. แบบฟอร์มอุทธรณ์กระดาษ, paper intake และใบแจ้งผล

### Phase 3 — Directory and academic operations

1. Student lifecycle
2. Staff permission bundles
3. Rule versioning/lifecycle
4. Academic year, promotion และ graduation

### Phase 4 — Import

1. รักษา Excel flow เดิม
2. เพิ่ม multi-CSV mapping/preview/apply/history
3. เพิ่ม import fixtures และ row-level diff tests

### Phase 5 — Reports

1. General statistics พร้อม table fallback
2. Students needing care roster
3. Audit history read-only
4. PDF/Excel export ตาม filter

## 10. Quality gates ก่อนส่งมอบแต่ละ phase

- concept-to-browser visual comparison ทั้ง desktop และ mobile
- visible copy diff เทียบภาพที่อนุมัติ
- keyboard/focus order และ touch target 44–48px
- no horizontal overflow ที่ 360–430px
- RLS/permission tests ด้วยบัญชีต่างบทบาทและต่าง scope
- SQL atomicity/idempotency assertions
- loading, empty, error, conflict และ retry paths
- ไม่มีข้อมูลนักเรียนจริง หลักฐานจริง หรือ secret ใน repository/test fixture
- `npm run typecheck`
- `npm run test`
- `npm run build`

## 11. ขอบเขตที่ยืนยันแล้วก่อนเริ่ม Phase 1 backend

1. LINE, Messenger, โทร และ SMS ทำผ่านช่องทางภายนอก แล้วแอดมินบันทึกผลในระบบ ไม่เชื่อม API ส่งข้อความในรอบแรก
2. การเตือน 24 ชั่วโมงเป็นคิว/แจ้งเตือนภายในระบบก่อน ยังไม่ส่ง push, LINE หรือ SMS อัตโนมัติ
3. นักเรียนทุกระดับชั้นใช้เอกสารกระดาษเป็นช่องทางสำรองในการดูข้อมูลและยื่นอุทธรณ์ได้
4. ยังไม่ทำบัญชีผู้ปกครองและโหมดเครื่องส่วนกลางสำหรับนักเรียนในรุ่นแรก
5. ชื่อ `School Point` จะยังไม่เปลี่ยนใน source จนกว่าจะสรุปชื่อใหม่; ใน component ใหม่ใช้ brand config จุดเดียวเพื่อเปลี่ยนภายหลัง
