# การเตรียมและตรวจข้อมูลนำเข้า

## นำเข้าผ่านหน้าแอดมิน (แนะนำ)

เข้าเมนู **บุคคลและบัญชี → นำเข้า Excel** แล้วทำตาม 3 ขั้นตอนบนหน้าเว็บ:

1. ดาวน์โหลดแบบฟอร์ม Excel ของระบบ ซึ่งมี 5 แผ่นงาน: `ห้องเรียน`, `นักเรียน`, `บุคลากร`, `ห้องที่ครูรับผิดชอบ` และ `ผู้ปกครอง`
2. เลือกไฟล์และกด **ตรวจสอบไฟล์ก่อนบันทึก** ขั้นนี้เป็น dry-run และยังไม่แก้ฐานข้อมูล
3. ตรวจจำนวน แก้ข้อผิดพลาดให้หมด ติ๊กยืนยัน แล้วกด **ยืนยันนำเข้าข้อมูล**

รหัสเดิมจะอัปเดต รหัสใหม่จะสร้างเพิ่ม ช่องว่างจะคงค่าเดิม และแถวที่ว่างทั้งหมดจะถูกข้าม การไม่ใส่แถวใดในไฟล์ไม่ถือเป็นคำสั่งลบหรือถอนสิทธิ์เดิม ห้องที่ครูรับผิดชอบจึงเป็นการเพิ่มหรืออัปเดตเท่านั้น

ระบบไม่รับรหัสผ่านใน Excel บัญชีใหม่จะถูกสร้างในสถานะรอเปิดใช้ และแอดมินต้องออกรหัสครั้งแรกจากหน้ารายชื่อใกล้เวลาส่งให้เจ้าของบัญชี ข้อมูลผู้ปกครองรองรับลำดับ 1–20 โดยลำดับ 1 เป็นผู้ติดต่อหลักและถูกเก็บใน private schema

ไฟล์จำกัด 10 MB และรวมไม่เกิน 5,000 แถว ระบบตรวจสิทธิ์แอดมินใน Edge Function, ตรวจไฟล์ซ้ำด้วย server fingerprint และบันทึกข้อมูลหลักแบบ transaction หากการผูก Auth account บางรายล้มเหลว ให้นำไฟล์เดิมเข้าซ้ำเพื่อ retry ได้โดยไม่สร้างข้อมูลหลักซ้ำ

## คำสั่งนำเข้าแบบไฟล์ CSV/JSON เดิม

ตัวตรวจผ่าน command line ทำงานแบบ **dry-run เท่านั้น**: อ่านไฟล์ ตรวจสอบ และสร้าง import plan ที่มี fingerprint คงที่ แต่ไม่เชื่อมต่อหรือเขียน Supabase จึงทดลองซ้ำได้โดยไม่สร้างข้อมูลซ้ำ

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

บัญชีใหม่ถูกผูกด้วย `activation_required = true` เสมอ ให้ backend สร้าง Auth user โดยยังไม่ตั้งรหัสผ่าน แล้วออกรหัสใช้ครั้งเดียว ระบบเก็บเฉพาะ HMAC digest ใน `private.account_activations` และตรวจรหัส อายุ จำนวนครั้งที่ลอง และสถานะใช้แล้วผ่าน Edge Function ก่อนสร้างเซสชันตั้งรหัสผ่าน ผู้ใช้จึงตั้งรหัสผ่านส่วนตัวและเข้าสู่ระบบใหม่ด้วยรหัสนั้นเพื่อรับ JWT ที่มี `amr.method = password` จากนั้น frontend เรียก `public.complete_first_password_activation()` เพื่อปลด gate พร้อมเขียน audit ระหว่างนั้น session อ่านได้เฉพาะโปรไฟล์ของตนเองและเรียกข้อมูลโรงเรียน/RPC คะแนนไม่ได้ ห้ามใช้ `encrypted_password` หรือ `user_metadata` เป็นหลักฐานการเปิดใช้งาน

ระบบยกเลิก `public.admin_mark_account_activated(user_id)` และคำสั่ง provisioning จะไม่เปิดบัญชีอัตโนมัติเมื่อพบ Auth user เดิม เพราะ Supabase อาจเก็บ password hash ภายในให้บัญชีที่สร้างโดยไม่ส่งรหัสผ่าน การรันซ้ำจึงทำเพียงผูกบัญชีแบบ idempotent และรักษาค่า `activation_required` เดิมไว้ การปลด gate ต้องเกิดจาก password session ที่ยืนยันแล้วเท่านั้น

Repository มีคำสั่ง trusted local import ที่เรียก dry-run, apply และ provisioning ตามลำดับให้แล้ว โดยอ่าน secret จาก environment เท่านั้น:

ก่อน provisioning คำสั่งจะอ่าน `/auth/v1/settings` และหยุดทันทีถ้า Hosted Auth ยังอนุญาต public signup หรืออ่านสถานะไม่ได้ เพื่อป้องกันบุคคลอื่นจองอีเมลภายในก่อนโรงเรียนสร้างบัญชี ต้องปิด **Allow new users to sign up** ใน Supabase Dashboard ก่อนเสมอ

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

ถ้าพบ Auth user เดิม สคริปต์จะยอมทำงานต่อโดยไม่ถามเฉพาะบัญชีที่มี `profiles` ผูกกับระบบโรงเรียนอยู่แล้ว ซึ่งทำให้ rerun ปกติยังเป็น idempotent หากเป็น Auth user เดิมที่ยังไม่เคยผูก สคริปต์จะหยุดโดยไม่แสดง username หรืออีเมล ต้องตรวจบัญชีนั้นใน Supabase Dashboard ก่อน แล้วจึงยืนยันรับบัญชีเดิมอย่างชัดเจนด้วย `--adopt-existing-users` เฉพาะกรณีที่ตรวจสอบเจ้าของแล้ว:

```powershell
npm run supabase:import -- `
  --input private-data/import-plan.json `
  --apply `
  --confirm-fingerprint CLIENT_PLAN_FINGERPRINT_FROM_DRY_RUN `
  --provision `
  --adopt-existing-users
```

ถ้าเครื่องเข้าสู่ระบบ Supabase CLI และ link project ไว้แล้ว สามารถนำเข้าโดยไม่ต้องอ่านหรือเก็บ `service_role` key ได้ ตัวสร้างจะตรวจ fingerprint ใหม่ ตรวจว่าไฟล์ปลายทางถูก `.gitignore` จริง และแสดงเฉพาะโหมด fingerprint จำนวนรายการ และตำแหน่งไฟล์บน console:

```powershell
# สร้างและเรียก dry-run; transaction ในไฟล์จะจบด้วย ROLLBACK
npm run supabase:import:sql -- `
  --input private-data/import-plan.json `
  --output private-data/import-dry-run.sql
npx.cmd supabase db query --linked --file private-data/import-dry-run.sql

# สร้างไฟล์ apply แยกต่างหากเมื่อ fingerprint ตรงกับรอบที่ตรวจแล้ว
npm run supabase:import:sql -- `
  --input private-data/import-plan.json `
  --output private-data/import-apply.sql `
  --apply `
  --confirm-fingerprint CLIENT_PLAN_FINGERPRINT
npx.cmd supabase db query --linked --file private-data/import-apply.sql
```

ไฟล์ SQL มี payload ที่รวมข้อมูลส่วนบุคคล แม้ console summary จะไม่แสดงข้อมูลเหล่านั้น จึงห้ามเปิดเผย อัปโหลด หรือย้ายออกจาก `private-data/` และ `imports/` ตัวสร้างจะไม่เขียนทับไฟล์เดิมเพื่อป้องกันการสลับไฟล์ dry-run กับ apply โดยไม่ตั้งใจ

บัญชีที่ provision จะยังไม่มีรหัสผ่านและยังถูกฐานข้อมูลกั้นจากข้อมูลโรงเรียน เมื่อต้องการส่งรหัสให้ผู้ใช้ ให้ออกรหัสเปิดใช้ครั้งเดียวใกล้เวลาส่งจริง:

```powershell
npm run supabase:activation -- `
  --username 69001 `
  --output private-data/activation-codes.json
```

ไฟล์ activation codes มี username, รหัสใช้ครั้งเดียว, `issuedAt` และ `expiresAt` จึงต้องอยู่ใต้ `private-data/` หรือ `imports/` เท่านั้น รหัสเปิดใช้ครั้งแรกมีอายุ 24 ชั่วโมง ส่วนรหัสกู้รหัสผ่านมีอายุ 1 ชั่วโมง ทั้งสองค่าถูกบังคับฝั่งเซิร์ฟเวอร์จริง การออกรหัสใหม่ยกเลิกรหัสเก่า รหัสผิดติดต่อกัน 10 ครั้งทำให้รหัสถูกยกเลิก และฐานข้อมูลไม่เก็บรหัสแบบอ่านได้ หน้าเว็บจะให้ผู้ใช้ตั้งรหัสผ่านส่วนตัว (อย่างน้อย 10 ตัวอักษร มีตัวอักษรภาษาอังกฤษและตัวเลข) เข้าสู่ระบบใหม่ด้วยรหัสนั้น แล้วเรียก activation RPC จาก password session จากนั้นฐานข้อมูลจึงเปิดสิทธิ์ ห้ามแชร์ service-role key หรือเก็บรหัสใน `.env.example`, `VITE_*`, Google Sheets และ repository

## ตรวจสถานะ activation และซ่อมแบบมีหลักฐาน

`activation_required` เป็นสถานะถาวรของบัญชี ส่วน `amr.method = password` เป็นหลักฐานของ session ปัจจุบัน ข้อมูลโรงเรียนและ RPC ธุรกิจต้องผ่านทั้งสองเงื่อนไขทุกครั้ง การมี password hash ใน `auth.users` ไม่ใช่หลักฐานว่าผู้ใช้ตั้งรหัสผ่านแล้ว

หลัง migration ให้ตรวจสรุปก่อน โดยคำสั่งนี้ไม่แก้ข้อมูล:

```sql
select activation_required, count(*)
from public.profiles
group by activation_required
order by activation_required desc;

select profile.user_id,
       profile.activation_required,
       max(log.created_at) filter (
         where log.action = 'mark_account_activated'
       ) as legacy_marked_at,
       max(log.created_at) filter (
         where log.action = 'complete_first_password_activation'
       ) as password_verified_at
from public.profiles profile
left join public.audit_logs log
  on log.entity_type = 'profile'
 and log.entity_id = profile.user_id::text
group by profile.user_id, profile.activation_required
having not profile.activation_required
   and max(log.created_at) filter (
     where log.action = 'complete_first_password_activation'
   ) is null;
```

ถ้าทุกบัญชียังเป็น `activation_required = true` ไม่ต้องซ่อมอะไร ห้ามอัปเดตทุกบัญชีจากผลของ `encrypted_password` หากพบผู้สมัครซ่อม ให้ผู้ดูแลตรวจเจ้าของบัญชีและ audit ทีละรายก่อน แล้วใส่เฉพาะ UUID ที่อนุมัติใน transaction นี้:

```sql
begin;

create temporary table reviewed_activation_repairs (
  user_id uuid primary key
) on commit drop;

-- ตัวอย่างรูปแบบเท่านั้น: ใส่เฉพาะ UUID ที่ตรวจสอบแล้ว
-- insert into reviewed_activation_repairs(user_id) values ('00000000-0000-0000-0000-000000000000');

with repaired as (
  update public.profiles profile
  set activation_required = true
  from reviewed_activation_repairs reviewed
  where profile.user_id = reviewed.user_id
    and not profile.activation_required
  returning profile.user_id
)
insert into public.audit_logs(
  actor_user_id,
  action,
  entity_type,
  entity_id,
  before_state,
  after_state
)
select null,
       'repair_activation_gate',
       'profile',
       repaired.user_id::text,
       jsonb_build_object('activation_required', false),
       jsonb_build_object('activation_required', true, 'reviewed', true)
from repaired;

commit;
```

ควรตรวจจำนวนแถวใน temporary table และผล `UPDATE` ก่อน `COMMIT`; หากไม่ตรงกับรายการที่อนุมัติให้ `ROLLBACK` แทน
