# การเตรียมและตรวจข้อมูลนำเข้า

ตัวตรวจนำเข้ารอบนี้ทำงานแบบ **dry-run เท่านั้น**: อ่านไฟล์ ตรวจสอบ และสร้าง import plan ที่มี fingerprint คงที่ แต่ไม่เชื่อมต่อหรือเขียน Supabase จึงทดลองซ้ำได้โดยไม่สร้างข้อมูลซ้ำ

> Repository นี้เป็นสาธารณะ ห้าม commit รายชื่อนักเรียน วันเกิด เบอร์ผู้ปกครอง username จริง หรือ import plan ที่สร้างจากข้อมูลจริง ให้เก็บไฟล์ไว้ใต้ `private-data/` หรือ `imports/` ซึ่งถูก `.gitignore` แล้ว หรือเก็บไว้นอก repository

## ส่งออกจาก Google Sheets

ดาวน์โหลดแต่ละแท็บเป็น CSV แยกกัน แล้วเก็บไว้ใน `private-data/` เช่น:

- `private-data/students.csv`
- `private-data/staff.csv`
- `private-data/assignments.csv`
- `private-data/guardians.csv` ถ้าแยกผู้ปกครองออกจากชีตนักเรียน

ข้อมูลผู้ปกครองจะอยู่ในไฟล์นักเรียนหรือไฟล์ผู้ปกครองแยกก็ได้ แต่ระบบรองรับผู้ปกครองหลักหนึ่งรายการต่อนักเรียนหนึ่งคนใน import plan รุ่นนี้

## คำสั่ง dry-run

```powershell
node scripts/import-school-data.mjs `
  --students private-data/students.csv `
  --staff private-data/staff.csv `
  --assignments private-data/assignments.csv `
  --school-year 2569 `
  --semester 1
```

ถ้าผลเป็น `ผ่าน` จึงสร้าง import plan สำหรับขั้นเชื่อม Supabase:

```powershell
node scripts/import-school-data.mjs `
  --students private-data/students.csv `
  --staff private-data/staff.csv `
  --assignments private-data/assignments.csv `
  --school-year 2569 `
  --semester 1 `
  --output private-data/import-plan.json
```

ตัวโปรแกรมจะไม่แสดงข้อมูลส่วนบุคคลใน summary และจะไม่ยอมเขียน output ภายใน repository นอก `private-data/` หรือ `imports/`

## รูปแบบข้อมูลที่รองรับ

รองรับ CSV/TSV ที่ export จาก Google Sheets และ JSON โดยรู้จักหัวตารางภาษาไทยหรืออังกฤษที่ใช้กันทั่วไป

### นักเรียน

ช่องบังคับ: `รหัสนักเรียน`, `ชื่อ`, `นามสกุล`, `ระดับชั้น`

ช่องไม่บังคับ: `คำนำหน้า`, `วันเกิด`, `เลขที่`, `ห้อง`, `ชื่อผู้ปกครอง`, `ความสัมพันธ์`, `เบอร์โทรผู้ปกครอง`, `สถานะ`

### ครูและแอดมิน

ช่องบังคับ: `รหัสครู` หรือ `รหัสบุคลากร`, `ชื่อ`, `นามสกุล`, `บทบาท`

ช่องไม่บังคับ: `username`, `คำนำหน้า`, `สถานะ`

บทบาทรองรับ `ครู` และ `แอดมิน` เท่านั้น ตัวนำเข้าไม่รับหรือสร้างรหัสผ่าน รหัสเปิดใช้งาน หรือ secret ใด ๆ

รหัสนักเรียนและ username บุคลากรใช้เป็นชื่อเข้าสู่ระบบ จึงรองรับเฉพาะ `a-z`, `0-9`, `.`, `_`, `-`; ห้ามมีจุดนำหน้า จุดท้าย หรือจุดซ้ำ และ username บุคลากรจะถูกแปลงเป็นตัวพิมพ์เล็ก

### มอบหมายห้อง

ช่องบังคับ: `รหัสครู`, `ระดับชั้น`

ช่องไม่บังคับ: `ปีการศึกษา`, `ภาคเรียน`, `ห้อง`, `หน้าที่`, `สถานะ` ถ้าไม่ใส่ปีหรือภาคเรียน จะใช้ค่าจาก command line

## กติกาการแปลง

- ห้องว่าง, `ห้องเดียว`, `โรงเรียน` หรือ `school` แปลงเป็นห้อง `0`
- หน้าเว็บสามารถแสดงห้อง `0` เป็นเพียงชื่อระดับชั้น เช่น `ป.1` โดยไม่แสดง `/0`
- ระดับชั้น `ป.1`–`ป.6` แปลงเป็น `P1`–`P6`
- ระดับชั้น `ม.1`–`ม.3` แปลงเป็น `M1`–`M3`
- วันที่รับทั้ง `YYYY-MM-DD` และ `DD/MM/YYYY`; ปี พ.ศ. จะถูกแปลงเป็น ค.ศ.
- `-`, `ไม่มี`, `ไม่ระบุ`, `ยังไม่มี` ในช่องไม่บังคับถือเป็นค่าว่าง และเติมภายหลังได้
- รหัสนักเรียนและรหัสครูเป็น natural key; ถ้าซ้ำ validation จะไม่ผ่าน
- ครูที่ถูกมอบหมายต้องอยู่ในชุดข้อมูลบุคลากรและมีบทบาท `ครู`

## JSON แบบไฟล์เดียว

ใช้ `--input private-data/import.json` ได้ โดย object หลักมี `term`, `students`, `guardians`, `staff` (หรือ `teachers`) และ `assignments` ตัวนำเข้าจะสร้าง `school-point-import/v1` plan ที่เรียงข้อมูลและคำนวณ SHA-256 fingerprint แบบ deterministic

การได้ fingerprint เดิมจาก input เดิมยืนยันว่า dry-run ให้ผลเหมือนเดิม

## การส่งเข้า Supabase ภายหลัง

Migration มี RPC `public.admin_import_school_data(payload jsonb, dry_run boolean)` สำหรับ upsert แบบ transaction ด้วย natural keys แล้ว แต่คำสั่งนี้เป็น **server-only**: เรียกได้ด้วย `service_role` จาก Edge Function หรือ backend ที่เชื่อถือได้เท่านั้น และ frontend/บทบาท `authenticated` เรียกไม่ได้

ให้เรียกด้วย `dry_run = true` ก่อนทุกครั้ง ตรวจว่า `ok` เป็น `true` และ `errors` ว่าง แล้วจึงเรียก payload เดิมด้วย `dry_run = false` การส่ง fingerprint เดิมซ้ำจะได้ `alreadyApplied = true` และไม่สร้างข้อมูลซ้ำ ห้ามใส่ service-role key ใน `VITE_*`, browser, import plan หรือ repository โดยเด็ดขาด

RPC ไม่เชื่อค่า `fingerprint` ที่มากับไฟล์เป็น idempotency key แต่คำนวณ SHA-256 ใหม่จาก JSON payload จริง (ยกเว้นช่อง fingerprint) ฝั่งฐานข้อมูลเสมอ ผลตอบกลับจะแยก `serverFingerprint` และ `clientFingerprint` ดังนั้น payload ที่ถูกแก้แต่ยังใส่ fingerprint เก่าจะไม่ถูกมองว่าเคยนำเข้าแล้ว

ถ้ายังไม่มีภาคเรียน RPC จะสร้างสถานะ `planned` จากปีการศึกษา/ภาคเรียนใน plan โดยยังไม่เดาวันเปิด–ปิด แอดมินต้องเติมวันที่และเปลี่ยนเป็น `active` ก่อนเริ่มตัดคะแนนจริง

หลัง backend ที่เชื่อถือได้สร้าง Supabase Auth user แล้ว ให้เรียก `public.admin_link_provisioned_account(username, user_id)` ด้วย `service_role` เพื่อผูกบัญชีเข้ากับ `profiles`, นักเรียน/บุคลากร และ username directory แบบ idempotent RPC นี้ไม่รับรหัสผ่าน รหัสเปิดใช้ หรือ token ใด ๆ และ frontend เรียกไม่ได้

บัญชีใหม่ถูกผูกด้วย `activation_required = true` เสมอ ให้ backend สร้าง Auth user โดยยังไม่ตั้งรหัสผ่าน แล้วส่ง magic-link/OTP ครั้งเดียว เมื่อผู้ใช้ตั้งรหัสผ่านแรก Supabase จะเปลี่ยน `auth.users.encrypted_password` และ trigger ฝั่งฐานข้อมูลจะปลด gate ให้เอง ระหว่างนั้น session อ่านได้เฉพาะโปรไฟล์ของตนเองและเรียกข้อมูลโรงเรียน/RPC คะแนนไม่ได้ ห้ามใช้ `user_metadata` จาก client เป็นหลักฐานการเปิดใช้งาน หาก Auth user มีรหัสผ่านอยู่ก่อนการผูกบัญชีหรือ hosted environment ไม่เรียก trigger ให้ backend ใช้ `public.admin_mark_account_activated(user_id)` ซึ่งตรวจ password hash ฝั่ง `auth.users` ก่อนและเรียกได้ด้วย `service_role` เท่านั้น

Repository มีคำสั่ง trusted local import ที่เรียก dry-run, apply และ provisioning ตามลำดับให้แล้ว โดยอ่าน secret จาก environment เท่านั้น:

```powershell
$env:SUPABASE_URL='https://PROJECT.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY='ใส่ในเครื่องเท่านั้น'

# ตรวจในฐานข้อมูลก่อน ไม่เขียนข้อมูล
npm run supabase:import -- --input private-data/import-plan.json

# เขียนจริงเมื่อ clientPlanFingerprint ตรงตามที่ตรวจแล้ว
npm run supabase:import -- `
  --input private-data/import-plan.json `
  --apply `
  --confirm-fingerprint CLIENT_PLAN_FINGERPRINT_FROM_DRY_RUN `
  --provision
```

บัญชีที่ provision จะยังไม่มีรหัสผ่านและยังถูกฐานข้อมูลกั้นจากข้อมูลโรงเรียน เมื่อต้องการส่งรหัสให้ผู้ใช้ ให้ออกรหัสเปิดใช้ครั้งเดียวใกล้เวลาส่งจริง:

```powershell
npm run supabase:activation -- `
  --username 69001 `
  --output private-data/activation-codes.json
```

ไฟล์ activation codes มี username และ OTP จึงต้องอยู่ใต้ `private-data/` หรือ `imports/` เท่านั้น รหัสมีอายุตามค่า Auth ของ Supabase และใช้ได้ครั้งเดียว หน้าเว็บจะให้ผู้ใช้ตั้งรหัสผ่านส่วนตัว (อย่างน้อย 10 ตัวอักษร มีตัวอักษรภาษาอังกฤษและตัวเลข) จากนั้นฐานข้อมูลจึงเปิดสิทธิ์ ข้อความบน console ไม่มี OTP ห้ามแชร์ service-role key หรือเก็บไว้ใน `.env.example`, `VITE_*`, Google Sheets และ repository
