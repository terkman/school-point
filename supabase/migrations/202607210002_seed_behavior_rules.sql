begin;

-- Keep the catalogue in one trusted, rerunnable routine. supabase/seed.sql invokes
-- this same routine after migrations, avoiding a second divergent copy of 100 rows.
create or replace function private.seed_2569_behavior_rules()
returns void
language plpgsql
security definer
set search_path = ''
as $seed$
declare
  v_deduction_count integer;
  v_positive_count integer;
begin

-- Source: the 2569 student-discipline regulation and its dress/hair regulations.
-- The consolidated discipline table contains exactly 83 deduction rules:
-- 35 low, 28 medium, 12 serious, and 8 critical. The source's "ขั้นเบา"
-- maps to the existing rule_severity value "low". Per the application policy,
-- guardian follow-up is enabled for serious/critical rules only.
with deduction_seed (
  rule_code,
  category,
  title_th,
  default_deduction,
  severity,
  guardian_contact_required
) as (
  values
    ('D2569-L-001', 'ความผิดขั้นเบา', 'มาสาย ไม่ทันทำกิจกรรมเวรเขตรับผิดชอบ หรือไม่เข้าแถวเคารพธงชาติตอนเช้าโดยไม่มีเหตุผลสมควร', 2, 'low'::public.rule_severity, false),
    ('D2569-L-002', 'ความผิดขั้นเบา', 'ไม่เข้าออกทางประตูโรงเรียน', 2, 'low'::public.rule_severity, false),
    ('D2569-L-003', 'ความผิดขั้นเบา', 'เข้าห้องเรียนช้าเป็นประจำโดยไม่มีเหตุผลสมควร', 2, 'low'::public.rule_severity, false),
    ('D2569-L-004', 'ความผิดขั้นเบา', 'ไม่สนใจเรียนขณะที่มีการเรียนการสอน', 2, 'low'::public.rule_severity, false),
    ('D2569-L-005', 'ความผิดขั้นเบา', 'ไม่สนใจร่วมทำกิจกรรมกลุ่มในการเรียน', 2, 'low'::public.rule_severity, false),
    ('D2569-L-006', 'ความผิดขั้นเบา', 'ไม่มีหนังสือหรืออุปกรณ์การเรียน', 2, 'low'::public.rule_severity, false),
    ('D2569-L-007', 'ความผิดขั้นเบา', 'หลบหนีหรือไม่เข้าร่วมชั่วโมงอบรมหรือชั่วโมงกิจกรรมชุมนุม', 2, 'low'::public.rule_severity, false),
    ('D2569-L-008', 'ความผิดขั้นเบา', 'ขาดเรียนโดยไม่ทราบสาเหตุและไม่มีใบลา', 2, 'low'::public.rule_severity, false),
    ('D2569-L-009', 'ความผิดขั้นเบา', 'ออกนอกบริเวณโรงเรียนโดยไม่ได้รับอนุญาต', 2, 'low'::public.rule_severity, false),
    ('D2569-L-010', 'ความผิดขั้นเบา', 'เสื้อ กระโปรง กางเกง ถุงเท้า รองเท้า หรือเข็มขัดผิดระเบียบ', 2, 'low'::public.rule_severity, false),
    ('D2569-L-011', 'ความผิดขั้นเบา', 'แต่งกายผิดระเบียบ เช่น ปล่อยชายเสื้อออกนอกกางเกงเป็นประจำหรือทุกเวลา', 2, 'low'::public.rule_severity, false),
    ('D2569-L-012', 'ความผิดขั้นเบา', 'ไม่แต่งเครื่องแบบลูกเสือตามวันเวลาที่กำหนด หรือแต่งเครื่องแบบไม่ถูกระเบียบ', 2, 'low'::public.rule_severity, false),
    ('D2569-L-013', 'ความผิดขั้นเบา', 'แต่งกายด้วยชุดพละไม่ถูกต้องตามแบบที่โรงเรียนกำหนด', 2, 'low'::public.rule_severity, false),
    ('D2569-L-014', 'ความผิดขั้นเบา', 'ไม่แต่งเครื่องแบบนักเรียนมาติดต่อราชการในขณะที่ยังมีสภาพเป็นนักเรียน', 2, 'low'::public.rule_severity, false),
    ('D2569-L-015', 'ความผิดขั้นเบา', 'ใส่เครื่องประดับนอกเหนือจากที่โรงเรียนกำหนด', 2, 'low'::public.rule_severity, false),
    ('D2569-L-016', 'ความผิดขั้นเบา', 'ใส่รองเท้าไม่เรียบร้อยหรือเหยียบส้นรองเท้า', 2, 'low'::public.rule_severity, false),
    ('D2569-L-017', 'ความผิดขั้นเบา', 'นักเรียนชายไว้ทรงผมผิดระเบียบหรือไว้หนวดเครา', 2, 'low'::public.rule_severity, false),
    ('D2569-L-018', 'ความผิดขั้นเบา', 'นักเรียนหญิงที่ไว้ผมยาวไม่ถักเปียให้เรียบร้อย', 2, 'low'::public.rule_severity, false),
    ('D2569-L-019', 'ความผิดขั้นเบา', 'นักเรียนหญิงใช้โบหรืออุปกรณ์ติดผมที่ผิดระเบียบ', 2, 'low'::public.rule_severity, false),
    ('D2569-L-020', 'ความผิดขั้นเบา', 'ไม่ทิ้งขยะในที่ที่จัดให้', 2, 'low'::public.rule_severity, false),
    ('D2569-L-021', 'ความผิดขั้นเบา', 'ไม่ทำความสะอาดหรือไม่รักษาความสะอาดห้องเรียนและบริเวณโดยรอบ', 2, 'low'::public.rule_severity, false),
    ('D2569-L-022', 'ความผิดขั้นเบา', 'ไม่รักษาความสะอาดเมื่อใช้ห้องน้ำหรือห้องส้วม', 2, 'low'::public.rule_severity, false),
    ('D2569-L-023', 'ความผิดขั้นเบา', 'ไม่รักษาความสะอาดเมื่อใช้โรงอาหาร', 2, 'low'::public.rule_severity, false),
    ('D2569-L-024', 'ความผิดขั้นเบา', 'ไม่ทำความสะอาดเขตบริเวณที่รับผิดชอบ', 2, 'low'::public.rule_severity, false),
    ('D2569-L-025', 'ความผิดขั้นเบา', 'นำภาชนะอาหารหรือเครื่องดื่มออกนอกบริเวณโรงอาหารหรือสถานที่ที่จัดไว้ให้', 2, 'low'::public.rule_severity, false),
    ('D2569-L-026', 'ความผิดขั้นเบา', 'ไม่จอดยานพาหนะในสถานที่ที่โรงเรียนกำหนด', 2, 'low'::public.rule_severity, false),
    ('D2569-L-027', 'ความผิดขั้นเบา', 'ไม่ปฏิบัติตามกฎจราจรในโรงเรียน', 2, 'low'::public.rule_severity, false),
    ('D2569-L-028', 'ความผิดขั้นเบา', 'ใช้กิริยาหยาบคายหรือไม่สุภาพโดยการพูด เขียน หรือแสดงท่าทางไม่สุภาพ', 3, 'low'::public.rule_severity, false),
    ('D2569-L-029', 'ความผิดขั้นเบา', 'แสดงท่าทางไม่สุภาพหรือก้าวร้าวต่อผู้อื่นโดยมิได้ทำให้เกิดความเสียหาย', 3, 'low'::public.rule_severity, false),
    ('D2569-L-030', 'ความผิดขั้นเบา', 'นำอาหารไปรับประทานบนอาคารเรียน ในห้องเรียน หรือในเวลาเรียน', 3, 'low'::public.rule_severity, false),
    ('D2569-L-031', 'ความผิดขั้นเบา', 'ไม่รักษามารยาทในการเข้าร่วมประชุม', 3, 'low'::public.rule_severity, false),
    ('D2569-L-032', 'ความผิดขั้นเบา', 'ไม่นำเอกสารของโรงเรียนให้ผู้ปกครอง', 3, 'low'::public.rule_severity, false),
    ('D2569-L-033', 'ความผิดขั้นเบา', 'เล่นหรือส่งเสียงดังอึกทึกก่อความรำคาญแก่ส่วนรวม', 5, 'low'::public.rule_severity, false),
    ('D2569-L-034', 'ความผิดขั้นเบา', 'เล่นในบริเวณพื้นที่ห้ามเล่น', 5, 'low'::public.rule_severity, false),
    ('D2569-L-035', 'ความผิดขั้นเบา', 'นำของเล่นที่อาจเกิดอันตรายหรือก่อความรำคาญแก่ผู้อื่นมาโรงเรียน เช่น ปืน ดาบ ประทัด หรือวัตถุแหลมมีคม', 5, 'low'::public.rule_severity, false),

    ('D2569-M-001', 'ความผิดขั้นปานกลาง', 'หลบหลีกหรือหนีเรียน โดยไม่เข้าห้องเรียนหรือไม่เข้าโรงเรียน', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-002', 'ความผิดขั้นปานกลาง', 'เที่ยวเตร็ดเตร่ตามศูนย์การค้าหรือสถานที่ที่ไม่เหมาะสมในเวลาเรียน', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-003', 'ความผิดขั้นปานกลาง', 'ไม่เข้าร่วมกิจกรรมตามที่โรงเรียนกำหนดโดยไม่มีเหตุผลสมควร', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-004', 'ความผิดขั้นปานกลาง', 'ขัดคำสั่งหรือไม่ปฏิบัติตามคำแนะนำของครูหรืออาจารย์', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-005', 'ความผิดขั้นปานกลาง', 'ไม่แสดงความเคารพหรือไม่มีสัมมาคารวะต่อครูหรืออาจารย์', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-006', 'ความผิดขั้นปานกลาง', 'ยุยงหรือท้าทายให้เกิดการทะเลาะวิวาทหรือสร้างความแตกแยกสามัคคี', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-007', 'ความผิดขั้นปานกลาง', 'ประพฤติตัวไม่เหมาะสมภายนอกโรงเรียนจนทำให้เสื่อมเสียชื่อเสียง', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-008', 'ความผิดขั้นปานกลาง', 'กระทำความผิดตามพระราชบัญญัติว่าด้วยการกระทำความผิดเกี่ยวกับคอมพิวเตอร์ มาตรา 5, 6, 7, 11 หรือ 13', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-009', 'ความผิดขั้นปานกลาง', 'ทะเลาะวิวาทเล็กน้อยโดยไม่มีผู้บาดเจ็บหรือได้รับอันตราย', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-010', 'ความผิดขั้นปานกลาง', 'กัดสีผม ย้อมหรือโกรกสีผม ซอยผม หรือดัดผม', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-011', 'ความผิดขั้นปานกลาง', 'สักตามส่วนต่าง ๆ ของร่างกาย ขีดเขียนลวดลายบนร่างกาย หรือใช้เครื่องสำอางแต่งหน้ามาโรงเรียน', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-012', 'ความผิดขั้นปานกลาง', 'กล่าวเท็จต่อครูหรืออาจารย์', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-013', 'ความผิดขั้นปานกลาง', 'แต่งกายไม่เหมาะสมเข้าโรงเรียนในวันหยุด', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-014', 'ความผิดขั้นปานกลาง', 'แสดงกิริยาหรือวาจาไม่สุภาพหรือก้าวร้าวต่อครูหรืออาจารย์', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-015', 'ความผิดขั้นปานกลาง', 'ขัดขวางหรือไม่ให้ความร่วมมือต่อการปฏิบัติหน้าที่โดยชอบที่ได้รับมอบหมายจากครู ซึ่งอาจทำให้เกิดความเสียหายอย่างร้ายแรง', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-016', 'ความผิดขั้นปานกลาง', 'กระทำความผิดตามพระราชบัญญัติว่าด้วยการกระทำความผิดเกี่ยวกับคอมพิวเตอร์ มาตรา 8, 9, 10, 14, 15 หรือ 16', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-017', 'ความผิดขั้นปานกลาง', 'ทำลายทรัพย์สินของผู้อื่นหรือของโรงเรียนให้เกิดความเสียหาย', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-018', 'ความผิดขั้นปานกลาง', 'กลั่นแกล้ง รังแก หรือข่มขู่บุคคลอื่นให้เกิดความเสียหาย รวมถึงการกลั่นแกล้งทางออนไลน์', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-019', 'ความผิดขั้นปานกลาง', 'สูบบุหรี่หรือบุหรี่ไฟฟ้า หรือมีบุหรี่ บุหรี่ไฟฟ้า น้ำยา หรืออุปกรณ์บุหรี่ไฟฟ้าไว้ในครอบครอง', 20, 'medium'::public.rule_severity, false),
    ('D2569-M-020', 'ความผิดขั้นปานกลาง', 'ประพฤติตนเป็นอันธพาล', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-021', 'ความผิดขั้นปานกลาง', 'ทำอนาจารหรือกระทำการที่ไม่สมควรทางเพศและไม่เหมาะสมตามขนบธรรมเนียมประเพณีไทย', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-022', 'ความผิดขั้นปานกลาง', 'ใช้เครื่องมือสื่อสารถ่ายภาพนิ่ง ภาพเคลื่อนไหว บันทึกเสียง หรือเผยแพร่ข้อมูลส่วนบุคคลของผู้อื่นโดยไม่ได้รับอนุญาตจนทำให้ได้รับความเสียหาย', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-023', 'ความผิดขั้นปานกลาง', 'แอบอ้างชื่อเสียงของโรงเรียนหรือบุคลากร หรือประพฤติผิดซึ่งอาจนำความเสื่อมเสียมาสู่โรงเรียนหรือบุคคลอื่น', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-024', 'ความผิดขั้นปานกลาง', 'เข้าไปในสถานที่ที่กฎหมายห้ามเด็กและเยาวชนเข้า เช่น ไนต์คลับ บาร์ ดิสโกเทค หรือคาราโอเกะ', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-025', 'ความผิดขั้นปานกลาง', 'ปลอมแปลงลายมือ เอกสาร หรือตนเองเพื่อประโยชน์อย่างใดอย่างหนึ่ง', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-026', 'ความผิดขั้นปานกลาง', 'จงใจให้บุคคลที่ไม่ใช่ผู้ปกครองปลอมตัวมาติดต่อราชการกับโรงเรียน', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-027', 'ความผิดขั้นปานกลาง', 'ทุจริตในการสอบ', 10, 'medium'::public.rule_severity, false),
    ('D2569-M-028', 'ความผิดขั้นปานกลาง', 'กระทำการที่ก่อให้เกิดความสกปรกตามผนัง ตึก อาคาร หรือสถานที่ต่าง ๆ ทั้งภายในและภายนอกบริเวณโรงเรียน', 10, 'medium'::public.rule_severity, false),

    ('D2569-S-001', 'ความผิดขั้นร้ายแรง', 'เล่นการพนันทุกชนิด รวมถึงการพนันออนไลน์ หรือมีอุปกรณ์หรือหลักฐานเกี่ยวข้องกับการพนัน', 25, 'serious'::public.rule_severity, true),
    ('D2569-S-002', 'ความผิดขั้นร้ายแรง', 'ลักทรัพย์ ยักยอกทรัพย์ หรือสมรู้ร่วมคิดในการลักทรัพย์ โดยมีเจตนาทำให้ทรัพย์สินของผู้อื่นได้รับความเสียหาย', 25, 'serious'::public.rule_severity, true),
    ('D2569-S-003', 'ความผิดขั้นร้ายแรง', 'ใช้โทรศัพท์หรือเครื่องมือสื่อสารฝ่าฝืนระเบียบซ้ำ หรือใช้ในลักษณะที่กระทบต่อการเรียน ความปลอดภัย หรือสิทธิของผู้อื่น', 25, 'serious'::public.rule_severity, true),
    ('D2569-S-004', 'ความผิดขั้นร้ายแรง', 'ดื่ม ชักชวนผู้อื่นดื่ม มีส่วนร่วมในการดื่ม หรือมีเครื่องดื่มแอลกอฮอล์ไว้ในครอบครอง', 25, 'serious'::public.rule_severity, true),
    ('D2569-S-005', 'ความผิดขั้นร้ายแรง', 'แสดงพฤติกรรมชู้สาว กระทำในทำนองชู้สาว หรือมีพฤติกรรมไม่เหมาะสมในวัยเรียน', 30, 'serious'::public.rule_severity, true),
    ('D2569-S-006', 'ความผิดขั้นร้ายแรง', 'พกหรือนำอาวุธหรืออุปกรณ์ที่เจตนาจะใช้เป็นอาวุธ หรือซ่อนเร้นไว้เพื่อประทุษร้ายผู้อื่น', 40, 'serious'::public.rule_severity, true),
    ('D2569-S-007', 'ความผิดขั้นร้ายแรง', 'ทะเลาะวิวาทหรือมีส่วนร่วมในการใช้กำลังทำร้ายกันทั้งภายในและภายนอกบริเวณโรงเรียน', 40, 'serious'::public.rule_severity, true),
    ('D2569-S-008', 'ความผิดขั้นร้ายแรง', 'มีสื่อลามกอนาจารทุกชนิดอยู่ในครอบครอง', 30, 'serious'::public.rule_severity, true),
    ('D2569-S-009', 'ความผิดขั้นร้ายแรง', 'มั่วสุมเพื่อกระทำการที่ไม่เหมาะสมและเป็นปฏิปักษ์ต่อการเป็นนักเรียนที่ดี', 30, 'serious'::public.rule_severity, true),
    ('D2569-S-010', 'ความผิดขั้นร้ายแรง', 'ดูหมิ่นครู อาจารย์ หรือผู้มีพระคุณ', 40, 'serious'::public.rule_severity, true),
    ('D2569-S-011', 'ความผิดขั้นร้ายแรง', 'กระทำความผิดตามพระราชบัญญัติว่าด้วยการกระทำความผิดเกี่ยวกับคอมพิวเตอร์ มาตรา 12', 30, 'serious'::public.rule_severity, true),
    ('D2569-S-012', 'ความผิดขั้นร้ายแรง', 'บีบบังคับหรือข่มขู่ผู้อื่นเพื่อประสงค์ร้าย ประสงค์ต่อทรัพย์ หรือเจตนาอื่นที่ไม่ได้รับความยินยอม', 30, 'serious'::public.rule_severity, true),

    ('D2569-C-001', 'ความผิดขั้นร้ายแรงมาก', 'กระทำความผิดใด ๆ จนถูกแจ้งความหรือถูกจับกุม', 55, 'critical'::public.rule_severity, true),
    ('D2569-C-002', 'ความผิดขั้นร้ายแรงมาก', 'รวมกลุ่มลักขโมยทรัพย์สินของผู้อื่น', 55, 'critical'::public.rule_severity, true),
    ('D2569-C-003', 'ความผิดขั้นร้ายแรงมาก', 'ล่อลวง หน่วงเหนี่ยว หรือลักพา', 55, 'critical'::public.rule_severity, true),
    ('D2569-C-004', 'ความผิดขั้นร้ายแรงมาก', 'ก่อการทะเลาะวิวาทหรือชักนำบุคคลภายนอกมาร่วมก่อการทะเลาะวิวาท', 55, 'critical'::public.rule_severity, true),
    ('D2569-C-005', 'ความผิดขั้นร้ายแรงมาก', 'เสพ มีไว้ในครอบครอง จัดหา จำหน่าย หรือเกี่ยวข้องกับเครือข่ายยาเสพติดทุกชนิด', 60, 'critical'::public.rule_severity, true),
    ('D2569-C-006', 'ความผิดขั้นร้ายแรงมาก', 'ทำร้ายร่างกายบุคลากร ครู หรืออาจารย์', 60, 'critical'::public.rule_severity, true),
    ('D2569-C-007', 'ความผิดขั้นร้ายแรงมาก', 'ยุยงหรือชักชวนให้ทำการประท้วง', 60, 'critical'::public.rule_severity, true),
    ('D2569-C-008', 'ความผิดขั้นร้ายแรงมาก', 'ค้าประเวณีหรือชักนำให้มีการค้าประเวณี', 60, 'critical'::public.rule_severity, true)
)
insert into public.behavior_rules (
  rule_code,
  category,
  title_th,
  description_th,
  default_deduction,
  severity,
  guardian_contact_required,
  is_active,
  effective_from,
  effective_to
)
select
  seed.rule_code,
  seed.category,
  seed.title_th,
  case
    when seed.rule_code in (
      'D2569-L-010', 'D2569-L-011', 'D2569-L-012', 'D2569-L-013',
      'D2569-L-014', 'D2569-L-015', 'D2569-L-016', 'D2569-M-011',
      'D2569-M-013'
    ) then 'ให้พิจารณารายละเอียดตามระเบียบการแต่งกายนักเรียน พ.ศ. 2569'
    when seed.rule_code in (
      'D2569-L-017', 'D2569-L-018', 'D2569-L-019', 'D2569-M-010'
    ) then 'ให้พิจารณารายละเอียด ข้อยกเว้น และกระบวนการที่สุภาพตามระเบียบการไว้ทรงผมนักเรียน พ.ศ. 2569'
    else null
  end,
  seed.default_deduction,
  seed.severity,
  seed.guardian_contact_required,
  true,
  null,
  null
from deduction_seed seed
on conflict (rule_code) do update
set category = excluded.category,
    title_th = excluded.title_th,
    description_th = excluded.description_th,
    default_deduction = excluded.default_deduction,
    severity = excluded.severity,
    guardian_contact_required = excluded.guardian_contact_required,
    is_active = excluded.is_active,
    effective_from = excluded.effective_from,
    effective_to = excluded.effective_to;

-- The annex contains 17 positive-behavior rules. Rule 17 intentionally has no
-- fixed score in the source and is therefore stored as discretionary with a
-- system-bounded maximum; every actual addition still requires admin approval.
with positive_seed (
  rule_code,
  title_th,
  default_addition,
  max_addition,
  is_discretionary
) as (
  values
    ('P2569-001', 'เก็บสิ่งของหรือเงินส่งคืนเจ้าของ', 5, 5, false),
    ('P2569-002', 'เป็นตัวแทนของโรงเรียนเข้าร่วมการแข่งขันหรือกิจกรรมภายนอกโรงเรียนต่อรายการ', 5, 5, false),
    ('P2569-003', 'ได้รับรางวัลอันดับที่ 1–3 ในการแข่งขันหรือกิจกรรมภายในโรงเรียน', 10, 10, false),
    ('P2569-004', 'ได้รับคัดเลือกให้ปฏิบัติหน้าที่รองหัวหน้าชั้นเรียนประจำปีการศึกษา', 10, 10, false),
    ('P2569-005', 'ได้รับคัดเลือกให้ปฏิบัติหน้าที่คณะกรรมการฝ่ายต่าง ๆ ในกลุ่มเขตรับผิดชอบหรือกลุ่มสี', 10, 10, false),
    ('P2569-006', 'ให้ข้อมูลเกี่ยวกับการกระทำความผิดต่าง ๆ', 10, 10, false),
    ('P2569-007', 'อุทิศตนและเสียสละช่วยงานโรงเรียนหรืองานครูจนเป็นที่ยอมรับ', 10, 10, false),
    ('P2569-008', 'ได้รับรางวัลอันดับที่ 1–3 ในการแข่งขันหรือกิจกรรมภายนอกโรงเรียน', 15, 15, false),
    ('P2569-009', 'ได้รับคัดเลือกให้ปฏิบัติหน้าที่หัวหน้าชั้นเรียนประจำปีการศึกษา', 15, 15, false),
    ('P2569-010', 'ได้รับคัดเลือกให้ปฏิบัติหน้าที่คณะกรรมการนักเรียนฝ่ายต่าง ๆ', 15, 15, false),
    ('P2569-011', 'ได้รับคัดเลือกให้ปฏิบัติหน้าที่รองประธานในคณะสี', 15, 15, false),
    ('P2569-012', 'ได้รับคัดเลือกให้ปฏิบัติหน้าที่รองประธานคณะกรรมการนักเรียน', 20, 20, false),
    ('P2569-013', 'ได้รับคัดเลือกให้ปฏิบัติหน้าที่ประธานในคณะสี', 20, 20, false),
    ('P2569-014', 'ได้รับการยกย่องชมเชยจากชุมชน', 20, 20, false),
    ('P2569-015', 'ได้รับคัดเลือกให้ปฏิบัติหน้าที่ประธานคณะกรรมการนักเรียน', 25, 25, false),
    ('P2569-016', 'สร้างชื่อเสียงที่ดีด้านต่าง ๆ ให้โรงเรียนจนเป็นที่ยอมรับและศรัทธาจากสังคม', 25, 25, false),
    ('P2569-017', 'อื่น ๆ ตามที่คณะกรรมการฝ่ายกิจการนักเรียนพิจารณา', null, 100, true)
)
insert into public.positive_behavior_rules (
  rule_code,
  category,
  title_th,
  description_th,
  default_addition,
  max_addition,
  is_discretionary,
  is_active,
  effective_from,
  effective_to
)
select
  seed.rule_code,
  'เกณฑ์การเพิ่มคะแนนความประพฤติ',
  seed.title_th,
  case when seed.is_discretionary
    then 'ต้นฉบับไม่กำหนดคะแนนตายตัว ต้องให้คณะกรรมการฝ่ายกิจการนักเรียนพิจารณาและผ่านการอนุมัติของผู้ดูแลระบบ'
    else 'ต้องมีหลักฐานประกอบและผ่านการอนุมัติของผู้ดูแลระบบก่อนเพิ่มคะแนน'
  end,
  seed.default_addition,
  seed.max_addition,
  seed.is_discretionary,
  true,
  null,
  null
from positive_seed seed
on conflict (rule_code) do update
set category = excluded.category,
    title_th = excluded.title_th,
    description_th = excluded.description_th,
    default_addition = excluded.default_addition,
    max_addition = excluded.max_addition,
    is_discretionary = excluded.is_discretionary,
    is_active = excluded.is_active,
    effective_from = excluded.effective_from,
    effective_to = excluded.effective_to;

  select count(*) into v_deduction_count
  from public.behavior_rules
  where rule_code like 'D2569-%';

  select count(*) into v_positive_count
  from public.positive_behavior_rules
  where rule_code like 'P2569-%';

  if v_deduction_count <> 83 then
    raise exception 'Expected 83 D2569 deduction rules, found %', v_deduction_count;
  end if;
  if v_positive_count <> 17 then
    raise exception 'Expected 17 P2569 positive rules, found %', v_positive_count;
  end if;
  if exists (
    select 1
    from public.behavior_rules
    where rule_code like 'D2569-%'
      and guardian_contact_required <> (severity in ('serious', 'critical'))
  ) then
    raise exception 'D2569 guardian-contact mapping does not match severity policy';
  end if;
end;
$seed$;

revoke all on function private.seed_2569_behavior_rules()
from public, anon, authenticated;

select private.seed_2569_behavior_rules();

commit;
