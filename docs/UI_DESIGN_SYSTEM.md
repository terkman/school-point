# School Point UI Design System

ใช้ร่วมกันทุกบทบาท (นักเรียน ครู ผู้อำนวยการ ผู้ดูแลระบบ) แหล่งค่าจริงอยู่ที่ `src/admin-design-tokens.css` (โหลดก่อน CSS อื่นใน `src/main.tsx`) ห้ามประกาศสีหรือขนาดซ้ำใน `:root` ของไฟล์อื่น ชื่อเก่า (`--teal`, `--indigo`, `--coral`, `--admin-*`) เป็น alias ที่ชี้ไปยัง token ใหม่

## ฟอนต์

- `--font-sans: 'Inter', 'Noto Sans Thai', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif`
- Inter ใช้กับอักษรละตินและตัวเลข ส่วนอักษรไทยใช้ Noto Sans Thai ทั้งสองฟอนต์ self-host ผ่าน `src/fonts.css` ให้อารมณ์เรียบสงบคล้ายแอปแชตสมัยใหม่ แต่ไม่ใช่ฟอนต์ของ ChatGPT
- น้ำหนักที่ใช้: 400 ข้อความ, 500 เมนู/ตัวเลือก, 600 label/ปุ่ม/หัวข้อย่อย, 700 หัวข้อและตัวเลขสำคัญ

| Token | ขนาด | ใช้กับ |
|---|---|---|
| `--text-xs` | 12px | meta, badge, nav label, คำอธิบายใต้รายการ (ขั้นต่ำ ห้ามเล็กกว่านี้ยกเว้นงานพิมพ์ A4) |
| `--text-sm` | 14px | label, ปุ่ม, ตาราง, ข้อความรองในการ์ด |
| `--text-md` | 15px | เนื้อหา body (line-height 1.6) |
| `--text-input` | 16px | input / select / textarea (กัน iOS ซูม) |
| `--text-lg` | 18px | หัวข้อการ์ด / h3 |
| `--text-xl` | 20px | h2 |
| `--text-2xl` | 30px | h1 เดสก์ท็อป (มือถือ 24px: `--text-2xl-mobile`) |

## สีและการจับคู่ (ข้อความต้อง ≥ 4.5:1)

| บทบาท | Solid (พื้น / ข้อความ) | Hover | Soft (พื้น / ข้อความ) | ใช้เมื่อ |
|---|---|---|---|---|
| Surface | `#ffffff` | — | `#f7f9fc` (เฉพาะส่วนย่อย เช่น toolbar, หัวตาราง) | พื้นแอปและการ์ดเป็นสีขาว |
| Header | `#102a56` / ขาว | — | — | แถบบนสุด, ฝั่งซ้ายหน้า Login |
| ข้อความ | หัวข้อ `#202123`, เนื้อหา `#33405a`, รอง `#526079` | — | — | ห้ามใช้เทาที่จางกว่า `#526079` กับข้อความ |
| Confirm (teal) | `#0f766e` / ขาว | `#115e59` | `#e6f6f3` / `#0b5d56` | ปุ่มหลัก บันทึก อนุมัติ CTA ตัดคะแนน |
| Positive info | — | — | `#ecfdf5` / `#065f46` | badge อนุมัติแล้ว ข้อความสำเร็จ |
| Review (น้ำเงิน) | `#1d4ed8` / ขาว | `#1e40af` | `#eff4ff` / `#1e40af` | งานรอตรวจ, รายการที่เลือก, ลิงก์, focus |
| Appeal / Rules (ม่วง) | `#6d28d9` / ขาว | `#5b21b6` | `#f5f0ff` / `#5b21b6` | คำอุทธรณ์ แท็บกฎ การปรับคะแนนโดยผู้ดูแล |
| Warning (อำพัน) | — | — | `#fff7e6` / `#92400e` (เข้ม `#fde68a`) | รอดำเนินการ, ครบกำหนดติดตาม, ตัดคะแนนที่เลือก |
| Critical (แดง) | `#b91c1c` / ขาว | `#991b1b` | `#fef2f2` / `#991b1b` | เฉพาะวิกฤต เลยกำหนด การลบ หรือจำนวนแจ้งเตือนใน nav |

กฎที่ใช้:
- ปุ่ม solid ทุกแบบใช้ `color: inherit` กับ `strong / span / small / svg` ข้างใน ข้อความซ้อนจึงเป็นสีขาวเสมอ
- การตัดคะแนนตามปกติใช้สีอำพันหรือสีกลาง ไม่ใช้สีแดง
- severity: low เป็นสีน้ำเงิน medium เป็นอำพันอ่อน serious เป็นอำพันเข้ม critical เป็นสีแดง
- หัวข้อทุกระดับใช้ `#202123` สีเดียวกัน ส่วน eyebrow เป็นสีเทา (`--color-text-muted`) และใช้สีประจำบทบาทกับไอคอน badge หรือเส้น 3px เท่านั้น

## สถานะของ control

- **Focus**: `outline: 2px solid #1d4ed8; outline-offset: 2px` ทุก element ที่โฟกัสได้ ห้ามใช้ `outline: none`
- **Selected**: พื้น soft + เส้นขอบหรือเส้น 3px สีประจำบทบาท + `aria-pressed`/`aria-selected`/`aria-current` ห้ามสื่อด้วยสีอย่างเดียว
- **Hover**: พื้น `#f7f9fc` หรือ hover token ของสีนั้น
- **Disabled**: พื้นทึบ `#eef1f5`, ขอบ `#d5dce6`, ข้อความ `#66728a` ห้ามใช้ opacity กับทั้งปุ่ม
- **Transition**: ปุ่มไม่ทำ transition ของสีพื้นและสีตัวอักษร (มีแค่ box-shadow) เพื่อไม่ให้ข้อความผ่านช่วงสีที่อ่านไม่ออกตอนเปลี่ยนสถานะ

## ระยะห่างและเลย์เอาต์

- Spacing: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 (`--space-1…10`)
- รัศมีมุม: 6 / 8 / 12px, control สูง 44px
- เนื้อหากว้างสุด 1280px (`--content-max`) padding เดสก์ท็อป 32px มือถือ 16–20px
- Breakpoint หลัก:
  - ≤1100px: ตาราง analytics และรายการคะแนนล่าสุดเปลี่ยนเป็นการ์ดหรือ reflow และ `.manage-grid` (หน้าจัดการระบบ) เหลือคอลัมน์เดียว
  - grid ของฟอร์มใช้ `minmax(0, 1fr)` และกำหนด `min-width: 0` ให้ label และ input เพื่อไม่ให้ช่องวันที่ดันจนล้นแผง
  - ≤860px: sidebar เป็นไอคอน แต่ label ยังอยู่สำหรับ screen reader (มี `title`) และยังเห็นจำนวนงาน
  - ≤760px: หน้า admin เปลี่ยนเป็นคอลัมน์เดียว
  - ≤640px: แสดง bottom nav (label 12px เลื่อนแนวนอนได้)
- ตารางข้อมูลต้องอยู่ใน container ที่เลื่อนแนวนอนได้หรือ reflow ห้าม `overflow: hidden` ตัดคอลัมน์
- Dialog: header / body ที่เลื่อนได้ / footer ระยะ 24px บนเดสก์ท็อป บนมือถือเต็มจอ (`100dvh`) และ footer เผื่อ `safe-area-inset-bottom`
- Footer ที่ sticky บนมือถืออยู่เหนือ bottom nav (`bottom: 76px + safe area`)
- รายการต่าง ๆ สูงตามข้อมูลจริง ห้ามจองความสูงว่าง

## Scope ของสไตล์

- `styles.css`: base และ component ที่ทุกบทบาทใช้ร่วมกัน (`.button`, `.badge`, `.privacy-note`, `.metric-strip`, ตาราง)
- `admin-*.css`: เฉพาะหน้าผู้ดูแลระบบ selector ต้องมี scope เช่น `.score-workspace .score-action-options` (admin มี 3 ตัวเลือก ครูมี 2) และ `.phase2-review-detail .privacy-note`
- `admin-paper.css`: หน้าจอใช้ `--font-sans` ส่วนขนาดในเอกสาร A4 และ `@media print` คงค่าเดิมเพื่อรักษาการแบ่งหน้า
- `!important` ใช้ได้เฉพาะ print และ `prefers-reduced-motion`
