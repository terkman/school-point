# Backup, recovery, and controlled UAT

เอกสารนี้เติมจาก [data-reset-runbook.md](data-reset-runbook.md) สำหรับการเตรียม
backup/recovery และ UAT ข้อมูลแบบควบคุมได้ โดยไม่เป็นคำสั่ง reset, restore หรือ deploy
production

## ขอบเขตและข้อห้าม

- ใช้ snapshot/backup ที่สร้างด้วย Supabase Platform หรือเครื่องมือ backup ที่องค์กรอนุมัติ
  เท่านั้น; repository นี้ไม่สร้างหรือเก็บรหัสผ่าน, connection string, service key หรือข้อมูลจริง
- Restore drill และ UAT ต้องอยู่ใน environment แยกที่ระบุว่าไม่ใช่ production
- UAT ใช้ข้อมูลสังเคราะห์เท่านั้น: ชื่อและรหัสที่สร้างเพื่อทดสอบ, ไม่มี Excel/CSV จริง,
  ไม่มีรหัสผ่านใน ticket, checklist หรือ evidence
- ตัวตรวจด้านล่างอ่านไฟล์เท่านั้น ไม่เชื่อม Supabase CLI, ไม่เรียก API, และไม่เขียน database
- ห้ามใช้ backup verification เป็นการอนุมัติ reset; จุดอนุมัติและ preflight ยังคงตาม
  [data-reset-runbook.md](data-reset-runbook.md)

## ลำดับ backup และ recovery drill

1. บันทึก change/ticket ID, project/environment label, เวลา UTC, migration head และผู้รับผิดชอบ
   ในระบบ ticket ที่องค์กรอนุมัติ
2. สร้าง snapshot หรือ export ตามความสามารถของ Supabase plan แล้วเก็บ artifact นอก repository
   หรือใต้ `private-data/`/`imports/` ที่ถูก ignore เท่านั้น
3. สร้าง storage manifest สำหรับไฟล์หลักฐานที่อยู่ใน scope พร้อม SHA-256; ห้าม export
   `student-profile-images` โดยไม่อยู่ใน retention scope ที่อนุมัติ
4. Restore ไปยัง isolated environment และตรวจอย่างน้อย: migration catalog, row counts,
   ledger reconciliation และการเปิดอ่านตัวอย่างตามสิทธิ์ที่กำหนด
5. เก็บเฉพาะ metadata/checksum ใน recovery evidence; ไม่เก็บ data rows, secrets หรือรหัสผ่าน
6. รันตัวตรวจ artifact ก่อนเปลี่ยนแปลงใด ๆ:

```powershell
node scripts/verify-recovery-evidence.mjs `
  --evidence private-data/recovery-evidence.json `
  --json
```

ตัวตรวจปฏิเสธ evidence ที่ชี้ artifact ออกนอกโฟลเดอร์หลักฐาน, checksum/ขนาดไม่ตรง,
restore drill ที่ไม่ผ่าน, UAT บน production, หรือ metadata ที่มีชื่อ field คล้าย secret/password

## Controlled UAT checklist

ทำบน isolated UAT environment หลัง restore drill ผ่านแล้ว และบันทึกเพียงผลผ่าน/ไม่ผ่านกับ
reference ของหลักฐานในระบบ ticket:

- [ ] ยืนยัน environment label ไม่ใช่ production และ migration catalog ตรงกับ backup ที่ restore
- [ ] ยืนยันว่าชุดทดสอบเป็น synthetic-only และไม่มี password/OTP/secret ในหลักฐาน
- [ ] Import: preview → apply → preview/apply ไฟล์เดิมอีกครั้ง; ยืนยัน batch/retry ไม่สร้างข้อมูลหลักซ้ำ
- [ ] Score: ตัดคะแนน, ขอเพิ่มคะแนน, อนุมัติ และตรวจยอด/ledger ของ test student
- [ ] Appeal: ยื่นที่ขอบเขต 7 วันพอดีและยืนยันว่ากรณีช้ากว่าขอบเขตถูกปฏิเสธ
- [ ] Term: initialize คะแนนภาคเรียนของ test roster ซ้ำ และตรวจว่า opening ledger ไม่ซ้ำ
- [ ] Recovery readback: ตรวจ count, migration head และตัวอย่างข้อมูลตามหลักฐาน restore drill
- [ ] บันทึกผล failure, owner, เวลา UTC และตัดสินใจ go/no-go; ห้ามแก้ production ระหว่าง UAT

## รูปแบบ evidence ที่ตัวตรวจรับ

เก็บไฟล์และ artifact ใน directory เดียวกัน ตัวอย่างนี้เป็น placeholder เท่านั้น และต้องไม่
commit ไฟล์จริง:

```json
{
  "schemaVersion": "school-point-recovery-evidence/v1",
  "backup": {
    "id": "ticket-or-backup-id",
    "sourceEnvironment": "production-label-only",
    "capturedAt": "2026-08-27T00:00:00Z",
    "migrationHead": "202608270001",
    "artifacts": [
      {
        "kind": "database_dump",
        "path": "database.dump",
        "sha256": "64-hex-sha256-of-database.dump",
        "bytes": 123
      }
    ]
  },
  "restoreDrill": {
    "id": "restore-drill-id",
    "targetEnvironment": "isolated-uat",
    "performedAt": "2026-08-27T01:00:00Z",
    "outcome": "passed",
    "checks": [
      "migration_catalog_matches_backup",
      "row_counts_match_backup",
      "ledger_reconciliation",
      "sample_data_readback"
    ]
  },
  "uat": {
    "environment": "isolated-uat",
    "completedAt": "2026-08-27T02:00:00Z",
    "dataClass": "synthetic-only",
    "noRealPasswords": true,
    "checks": [
      "import_preview_apply_retry",
      "score_ledger_flow",
      "appeal_deadline_boundary",
      "term_opening_idempotency",
      "recovery_readback"
    ]
  }
}
```

ค่า `path` ต้องเป็น relative path ใต้ directory เดียวกับ evidence เสมอ เพื่อไม่ให้
verification ถูกใช้เปิดไฟล์นอกขอบเขตโดยไม่ตั้งใจ. `sourceEnvironment` เป็น label สำหรับ
หลักฐานเท่านั้น ไม่ใช่ URL หรือ credential.
