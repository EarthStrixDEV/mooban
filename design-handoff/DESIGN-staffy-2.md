# Staffy — Design Spec ภาค 2 (การลา · บัญชี · แอดมิน · หน้า error · แผนก · บริษัท)

ภาคนี้ครอบคลุม 10 บอร์ด: `Staffy-Leaves`, `Staffy-Leave-New`, `Staffy-Account`, `Staffy-Users`, `Staffy-Audit`, `Staffy-Status`, `Staffy-403`, `Staffy-404`, `Staffy-Departments`, `Staffy-Company` (ไฟล์อยู่ใน `reference-boards/*.dc.html`)
ส่วนที่ใช้ร่วมกัน (tokens, app shell/sidebar, ปุ่ม, ช่องกรอก, badge, ตาราง, pagination, flash, dialog) อยู่ใน `DESIGN-staffy-1.md` → อ้างว่า **part 1** ส่วน component คือ **part 1 §4**
เอกสารอ้างอิงหลัก: Spec Doc "Spec: Staffy — แอปจัดการพนักงาน" (id `0776144b-d033-4b27-8f2e-0cc4d473f027`) ภาคนี้อ้างเป็น "Spec §n"

สัญลักษณ์: **[spec]** = ตรงตาม Spec Doc · **[ต่าง]** = บอร์ดต่างจาก Spec (ดู §0) · **[เสนอ]** = proposed ไม่มีใน Spec ต้องเพิ่มใน Spec Doc · ข้อมูลตัวอย่างในบอร์ด (ชื่อคน, รหัส, ตัวเลข, วันที่) เป็น **placeholder** ห้าม hardcode

---

## 0. ความต่างระหว่างบอร์ดกับ Spec — ต้องรู้ก่อนเขียนโค้ด

บอร์ดวาดก่อนเทียบกับ Spec ทุกข้อ ตารางนี้คือที่ที่บอร์ดขัดหรือเกิน Spec **ค่าเริ่มต้น (default) ที่ Claude Code ควรทำ** อยู่ในคอลัมน์ขวา ถ้าพี่เอิร์ธไม่สั่งเปลี่ยน

| # | บอร์ด | บอร์ดว่า | Spec ว่า | Default ที่ให้ทำ |
|---|---|---|---|---|
| D1 | Audit | "เก็บย้อนหลัง 180 วัน" | งานรายวันลบ audit_logs เก่ากว่า **90 วัน** (Spec §3, §7) | ใช้ **90 วัน** แก้ข้อความบนหน้าเป็น "เก็บย้อนหลัง 90 วัน" |
| D2 | Account | กติการหัสผ่าน: "มีตัวอักษรและตัวเลขผสมกัน", "ไม่ซ้ำกับรหัสผ่านเดิม" | ≥10 ตัวอักษร, ≤72 byte (UTF-8), ไม่เหมือน username (Spec §5) | ใช้กติกา Spec: ยาวอย่างน้อย 10 ตัวอักษร / ไม่เกิน 72 byte / ไม่เหมือนชื่อผู้ใช้ |
| D3 | Company | `emp_prefix` ตัวอย่าง "EMP-" และรหัสในบอร์ดทุกหน้าเป็น `EMP-0137` | `employee_code` ต้องตรง `^[A-Z][0-9]{4,9}$` (เช่น `E0001`) | รหัสตัวอย่าง `EMP-xxxx` ในบอร์ดเป็นแค่ภาพ ใช้ regex ของ Spec; `emp_prefix` = **ตัวอักษรเดียว A–Z** (default `E`) ใช้เสนอรหัสถัดไปในฟอร์มเพิ่มพนักงานเท่านั้น ไม่ใช่กติกาตรวจ |
| D4 | Company | ช่อง "ส่งถึง" (digest_to) แก้ได้ในหน้าเว็บ | ผู้รับอีเมลมาจาก config (`HR_EMAIL`, `MAIL_TEST_TO`) เท่านั้น ห้ามรับจาก request (Spec §7) | เก็บ `digest_to` ใน DB ได้ แต่ **เขียนได้เฉพาะ admin ที่ล็อกอิน**, ตรวจรูปแบบอีเมล, อ่านตอนส่งจาก DB เท่านั้น (ไม่รับจาก request ของงานรัน) ว่างให้ fallback เป็น `HR_EMAIL` และ **ต้องแก้ข้อความใน Spec §7 ให้ตรง** |
| D5 | Company | `digest_time` (เวลาส่ง) ตั้งได้ | เวลารันกำหนดที่ Cron Jobs ของ DirectAdmin ไม่ใช่ในแอป (Spec §7) | แสดงช่องนี้เป็น **อ่านอย่างเดียว** พร้อมข้อความ "ตั้งเวลาที่ Cron Jobs ของ DirectAdmin" ไม่เก็บค่า (หรือเอาช่องออก) `digest_on` ใช้จริง: ปิด = งานรายวันยังสร้างแจ้งเตือนแต่ไม่ส่งอีเมล |
| D6 | Company | `work_start/work_end` และโควตาวันลา | ไม่มีใช้ใน Spec เลย | เก็บลง DB และใช้โควตาในแผง "วันลาคงเหลือ" (D8) ส่วน work_start/work_end เก็บไว้เฉยๆ ยังไม่ใช้ที่ไหน |
| D7 | Company | โลโก้ขึ้นบนตัวอย่างบัตรพนักงาน | บัตร PDF "ไม่มีรูป" (Spec §6) | อัปโหลด/เก็บโลโก้ได้ แต่ **ยังไม่ใส่ลงใน PDF** ในรอบแรก ตัวอย่างบัตรในหน้า Company แสดงโลโก้แบบ preview ได้ ถ้าต้องการลง PDF ให้แก้ Spec §6 ก่อน |
| D8 | Leave-New | แผง "วันลาคงเหลือ", "จำนวนวันลา (ไม่นับเสาร์-อาทิตย์)", หมายเหตุใบรับรองแพทย์ | Spec ไม่มีโควตาหรือการนับวันทำการ มีแค่ end ≥ start และช่วง ≤ 30 วัน | ทำเป็น **[เสนอ]**: คำนวณวันลา = นับเฉพาะจันทร์–ศุกร์ (ไม่มีตารางวันหยุด) เพื่อ *แสดงผล* เท่านั้น; กติกา 30 วันยังนับวันปฏิทินตาม Spec; **ไม่บล็อก**การยื่นเมื่อเกินโควตา (Spec ไม่ได้ห้าม) |
| D9 | Leave-New | "หัวหน้างานและ HR จะได้รับแจ้งเมื่อส่งคำขอ" | ไม่มีการแจ้งเตือนใบลา (notifications มีแค่ contract_expiring, birthday) | เปลี่ยนข้อความเป็น "HR และผู้ดูแลจะเห็นคำขอในรายการลา" |
| D10 | Departments | "…กำหนดหัวหน้าอนุมัติลา" | อนุมัติได้เฉพาะ admin/hr (Spec §4) | เปลี่ยนข้อความเป็น "ใช้กรองรายชื่อพนักงาน และระบุหัวหน้าแผนก" หัวหน้าแผนก**ไม่มีสิทธิ์อนุมัติ** |
| D11 | Users | dropdown "สิทธิ์" ต่อแถว (เปลี่ยนบทบาทได้) | routes ของ users มีแค่ สร้าง / ตั้งรหัสผ่านใหม่ / toggle (Spec §4) | **[เสนอ]** เพิ่ม `POST /admin/users/{id}/role` ตามบอร์ด (เปลี่ยนของตัวเองไม่ได้ → 403) |
| D12 | Users | ปุ่ม "ตั้งรหัสใหม่" ไม่มีช่องกรอก | admin "ตั้งรหัสผ่านใหม่ให้ผู้ใช้อื่น" ไม่บอกว่าใครพิมพ์รหัส | **[เสนอ]** ปุ่มเปิด `<details>` ในแถว มีช่อง `new_password` + ปุ่มยืนยัน (ไม่ต้องใช้ JS) |
| D13 | Status | "รันทุกวัน 06:00", "รันครั้งถัดไป พรุ่งนี้ 06:00", คอลัมน์ "แถวที่ประมวลผล" | Spec: ใช้งานจริงตั้งวันละครั้ง 08:00; แอปไม่รู้ตารางเวลาของ cron; job_runs.detail เก็บแค่ `today= runtime= inserted= emailed=` | เอา "รันครั้งถัดไป" ออก; ข้อความเวลา cron อ่านจาก env `CRON_SCHEDULE_LABEL` (ไม่ตั้ง = ซ่อน); เพิ่มคอลัมน์ `job_runs.finished_at`, `job_runs.rows_scanned` **[เสนอ]** (ดู §3.4) |
| D14 | Status | ปุ่ม "รันทันที" → `/admin/status/run` | มีแต่ `POST /test/run-daily` (เครื่องมือทดสอบ) | **[เสนอ]** เพิ่ม `POST /admin/status/run` เรียกฟังก์ชัน daily ตัวเดียวกัน `source=manual` |
| D15 | 403 | ปุ่ม "กลับหน้าพนักงาน" แม้ผู้ใช้เป็น employee | employee เปิด `/employees` ไม่ได้ (จะได้ 403 ซ้ำ) | ปุ่มหลัก = "ไปแดชบอร์ด", ปุ่มรอง = "การลา" (ทุกบทบาทเข้าได้) |
| D16 | ทุกหน้า | sidebar โชว์ครบทุกเมนู | เมนูต้องตามสิทธิ์ (§1.2) | กรองเมนูตามบทบาท (ซ่อนลิงก์ แต่เส้นทางตรงยังตอบ 403) |
| D17 | Leaves | แท็บเป็น `role="tab"` บน `<a>` | แท็บเหล่านี้เปลี่ยนหน้า (ไม่ใช่สลับ panel) | ใช้ `<nav aria-label="กรองตามสถานะ">` + ลิงก์ที่มี `aria-current="page"` หน้าตาเหมือนเดิม |

---

## 1. แผนที่บอร์ด → route

### 1.1 ตาราง

| บอร์ด | Route | Template | admin | hr | employee | เมนู sidebar |
|---|---|---|---|---|---|---|
| Staffy-Leaves | `GET /leaves?status=&page=` [spec] | `leaves/index` | ทั้งหมด | ทั้งหมด | เฉพาะของตัวเอง | การลา |
| Staffy-Leave-New | `GET /leaves/new`, `POST /leaves` [spec] | `leaves/new` | ถ้าผูกพนักงาน | ถ้าผูกพนักงาน | ได้ (ผูกเสมอ) | การลา |
| (action บน Leaves) | `POST /leaves/{id}/approve`, `/reject` [spec] | — | ได้ (ไม่ใช่ของตัวเอง) | ได้ (ไม่ใช่ของตัวเอง) | ✗ 403 | — |
| (action บน Leaves) | `POST /leaves/{id}/cancel` [spec] | — | เจ้าของ | เจ้าของ | เจ้าของ | — |
| Staffy-Account | `GET /account`, `POST /account/password` [spec] | `account/index` | ✓ | ✓ | ✓ | (ลิงก์ท้าย sidebar "บัญชีของฉัน") |
| Staffy-Users | `GET /admin/users` [spec] | `admin/users` | ✓ | ✗ | ✗ | บัญชีผู้ใช้ |
| (add user) | `GET /admin/users/new`, `POST /admin/users` [spec: สร้างบัญชี; หน้า new = เสนอ] | `admin/users_new` | ✓ | ✗ | ✗ | — |
| (actions) | `POST /admin/users/{id}/password`, `/toggle` [spec]; `/role` [เสนอ] | — | ✓ | ✗ | ✗ | — |
| Staffy-Audit | `GET /admin/audit?actor=&action=&from=&to=&page=` [spec หน้าละ 50; ตัวกรอง = เสนอ] | `admin/audit` | ✓ | ✗ | ✗ | บันทึกการใช้งาน |
| Staffy-Status | `GET /admin/status` [spec]; `POST /admin/status/run` [เสนอ] | `admin/status` | ✓ | ✗ | ✗ | สถานะระบบ |
| Staffy-403 | ตอบ **403** เมื่อไม่มีสิทธิ์/ CSRF ผิด [spec] | `errors/403` | — | — | — | — |
| Staffy-404 | ตอบ **404** [spec] (รวม `/setup` หลังมีผู้ใช้แล้ว) | `errors/404` | — | — | — | — |
| Staffy-Departments | `GET /admin/departments`, `GET /admin/departments/new`, `GET /admin/departments/{id}`, `POST /admin/departments`, `POST /admin/departments/{id}`, `POST /admin/departments/{id}/delete` **[เสนอ ทั้งหมด]** | `admin/departments` | ✓ | ✓ | ✗ | แผนก |
| Staffy-Company | `GET /admin/company`, `POST /admin/company`, `GET /admin/company/logo` **[เสนอ ทั้งหมด]** | `admin/company` | ✓ | ✗ | ✗ | ข้อมูลบริษัท |

ลำดับ route: `/leaves/new`, `/admin/users/new`, `/admin/departments/new` ต้องจับคู่ก่อน `/{id}` เสมอ และ `{id}` ต้องเป็นเลขจำนวนเต็มไม่เช่นนั้น 404 [spec]

### 1.2 เมนู sidebar ตามบทบาท

| เมนู (ลิงก์) | admin | hr | employee |
|---|---|---|---|
| แดชบอร์ด `/dashboard` | ✓ | ✓ | ✓ |
| พนักงาน `/employees` | ✓ | ✓ | — |
| การลา `/leaves` (badge = จำนวน pending) | ✓ badge | ✓ badge | ✓ ไม่มี badge |
| บัญชีผู้ใช้ `/admin/users` | ✓ | — | — |
| บันทึกการใช้งาน `/admin/audit` | ✓ | — | — |
| สถานะระบบ `/admin/status` | ✓ | — | — |
| แผนก `/admin/departments` | ✓ | ✓ | — |
| ข้อมูลบริษัท `/admin/company` | ✓ | — | — |

ลำดับในบอร์ด: แดชบอร์ด, พนักงาน, การลา, บัญชีผู้ใช้, บันทึกการใช้งาน, สถานะระบบ, แผนก, ข้อมูลบริษัท (หน้าที่ active = พื้นเมนู `#3B4BC4` ตัวอักษรขาว `aria-current="page"`) ท้าย sidebar: ชื่อ-บทบาท, "บัญชีของฉัน" (`/account`), "ออกจากระบบ" (**ต้องเป็น `POST /logout`** ใน `<form>` ปุ่มหน้าตาเป็นลิงก์ ไม่ใช่ `<a href>`) — โครง shell ดู part 1

### 1.3 ข้อความ flash ที่ใช้ในภาคนี้ (รหัส `?msg=` เป็นรายการคงที่ [spec] ห้ามแสดงค่าจาก query ตรงๆ)

| msg | หน้า | ข้อความ `#flash-ok` | ที่มา |
|---|---|---|---|
| `password_changed` | `/account` | เปลี่ยนรหัสผ่านเรียบร้อยแล้ว ครั้งถัดไปใช้รหัสผ่านใหม่ในการเข้าสู่ระบบ | บอร์ด |
| `leave_created` | `/leaves` | ส่งคำขอลาเรียบร้อยแล้ว | เสนอ |
| `leave_approved` | `/leaves` | อนุมัติคำขอลาแล้ว | เสนอ |
| `leave_rejected` | `/leaves` | ปฏิเสธคำขอลาแล้ว | เสนอ |
| `leave_cancelled` | `/leaves` | ยกเลิกคำขอลาแล้ว | เสนอ |
| `user_created` / `user_updated` / `user_password_set` | `/admin/users` | เพิ่มผู้ใช้เรียบร้อยแล้ว / บันทึกการเปลี่ยนแปลงแล้ว / ตั้งรหัสผ่านใหม่ให้ผู้ใช้แล้ว | เสนอ |
| `job_ran` | `/admin/status` | สั่งรันงานประจำวันแล้ว | เสนอ |
| `department_created` / `department_updated` / `department_deleted` | `/admin/departments` | เพิ่มแผนก{name} เรียบร้อยแล้ว (บอร์ด: "เพิ่มแผนกจัดซื้อ เรียบร้อยแล้ว") / บันทึกแผนก{name} แล้ว / ลบแผนก{name} แล้ว | บอร์ด+เสนอ |
| `company_updated` | `/admin/company` | บันทึกการตั้งค่าเรียบร้อยแล้ว | เสนอ |

`{name}` ในข้อความไม่มาจาก query ให้ใส่ชื่อจากแถวที่เพิ่งแก้ (อ่านจาก DB ด้วย id ที่ส่งใน `?id=` ที่ตรวจเป็นเลข) หรือใช้ข้อความไม่มีชื่อ ถ้าทำให้ซับซ้อนให้ตัด `{name}` ออก

---

## 2. รายละเอียดทีละหน้า

### 2.1 Staffy-Leaves — `/leaves`

**จุดประสงค์** รายการใบลา กรองตามสถานะ; HR/admin อนุมัติหรือปฏิเสธได้จากแถวโดยตรง

**Regions (บนลงล่าง)**
1. หัวหน้า: `h1` "การลา" + คำอธิบาย "คำขอลาของพนักงานทั้งหมด" (employee เห็นเป็น "คำขอลาของฉัน" **[เสนอ]**) · ปุ่มหลัก "ขอลาใหม่" → `/leaves/new` (ซ่อนถ้าบัญชีไม่ผูกพนักงาน)
2. `#flash-ok` / `#flash-error` (ถ้ามี) ใต้หัวหน้า
3. แท็บสถานะ (D17) เส้นล่าง 1px `#D9DCEB`: **รออนุมัติ** (`pending`), **อนุมัติแล้ว** (`approved`), **ปฏิเสธ** (`rejected`), **ยกเลิก** (`cancelled`) แต่ละแท็บมี chip จำนวนต่อท้าย; active = ตัวหนา สี `#3B4BC4` ขีดล่าง 3px chip `#E0E4FA/#2B3699`; ไม่ active = สี `#4F566E` chip `#ECEEF6/#4F566E` สูง 44px
4. ตาราง (`#leaves-table`) ในการ์ด radius 16 — ดู component ตาราง part 1 §4
5. ข้อความท้ายตาราง + pagination (`#pagination` ตาม [spec]; 20 แถว/หน้า **[เสนอ]**)

**คอลัมน์** (caption ซ่อนแต่อยู่ใน DOM: "รายการคำขอลา")
| คอลัมน์ | เนื้อหา |
|---|---|
| พนักงาน | avatar วงกลม 36px (ตัวอักษรแรกของชื่อ, สีพื้น/ตัวอักษรหมุนเวียนจาก 3 ชุดใน part 1) + ชื่อ-นามสกุล (16px/600) + ชื่อแผนก (14px `#4F566E`) |
| ประเภท | `annual`→พักร้อน, `personal`→ลากิจ, `sick`→ลาป่วย |
| ช่วงวันที่ลา | `<time datetime>`; วันเดียว "23 ต.ค. 2569"; เดือนเดียวกัน "27–29 ต.ค. 2569"; ข้ามเดือน "30 ต.ค. – 2 พ.ย. 2569"; ข้ามปี เต็มทั้งสองฝั่ง (ปี พ.ศ. = ค.ศ.+543, เดือนย่อไทย ม.ค. ก.พ. มี.ค. เม.ย. พ.ค. มิ.ย. ก.ค. ส.ค. ก.ย. ต.ค. พ.ย. ธ.ค.) |
| จำนวนวัน | "{n} วัน" (นับจันทร์–ศุกร์, D8) |
| สถานะ | badge: รออนุมัติ `#FFF4DB/#6B4A00`, อนุมัติแล้ว `#E6F4EA/#14532D`, ปฏิเสธ `#FDECEA/#8E1B12`, ยกเลิก `#ECEEF6/#4F566E` |
| การดำเนินการ | ดูด้านล่าง |

**คอลัมน์การดำเนินการ (ชิดขวา)**
| ผู้ดู | แถว pending | แถวอื่น |
|---|---|---|
| admin/hr ที่ไม่ใช่เจ้าของใบ | ปุ่ม **อนุมัติ** (พื้น `#14532D` ตัวขาว) + ปุ่ม **ปฏิเสธ** (ขอบ 1.5px `#8E1B12` ตัวอักษร `#8E1B12` พื้นขาว) สูง ≥44px `aria-label="อนุมัติคำขอของ {ชื่อ}"` / `"ปฏิเสธคำขอของ {ชื่อ}"` | "-" |
| admin/hr แต่เป็นใบของตัวเอง | ปุ่มอนุมัติ/ปฏิเสธ **ไม่แสดง** (แสดง "ยกเลิก" แทนเพราะเป็นเจ้าของ) — ถ้า POST ตรงๆ ตอบ **403** [spec] | "-" |
| เจ้าของใบ (ทุกบทบาท) | ปุ่มรอง "ยกเลิก" (`POST /leaves/{id}/cancel`) **[เสนอ ตำแหน่ง ไม่มีในบอร์ด]** | "-" |
| employee ดูใบคนอื่น | ไม่เห็นใบคนอื่นเลย [spec] | |

ปุ่มอนุมัติ/ปฏิเสธเป็น **`<form method="post" action="/leaves/{id}/approve">` และ `…/reject` แยกกัน** (บอร์ดใช้ `name=action` ในฟอร์มเดียว ให้ใช้ `formaction` หรือสองฟอร์มตาม route ของ Spec) มี hidden `csrf` ทุกฟอร์ม

**ข้อความท้ายตาราง** บอร์ด: "แสดง 1–7 จาก 4 รออนุมัติ · เฉพาะ HR และผู้ดูแลที่อนุมัติหรือปฏิเสธได้" (ตัวเลขในบอร์ดไม่สอดคล้องกัน) → ทำเป็น "แสดง {from}–{to} จาก {total} รายการ" และให้ประโยค "เฉพาะ HR และผู้ดูแลที่อนุมัติหรือปฏิเสธได้" แสดงเฉพาะ admin/hr

**States**
- Empty: ข้อความกลางการ์ด "ไม่มีคำขอลาในสถานะนี้" (copy เสนอ) ตัวอักษร `#4F566E` ไม่แสดง pagination
- Success: redirect `/leaves?status=<tab เดิม>&msg=leave_approved|leave_rejected|leave_cancelled`
- Error: อนุมัติใบที่ไม่ pending → **422** + `#flash-error` "ใบลานี้ถูกตัดสินแล้ว" (copy เสนอ) [spec: ที่ไม่ใช่ pending ได้ 422]; ใบของตัวเอง → 403 หน้า errors/403; ไม่พบ id → 404
- `status` ไม่ถูกต้อง → ใช้ `pending` (ค่าพารามิเตอร์ผิดใช้ค่าเริ่มต้น [spec แนวเดียวกับรายการพนักงาน])

**Test hooks** `#leaves-table tbody tr[data-id][data-status]` **[เสนอ]**, `#pagination[data-page][data-pages][data-total]`, `#flash-ok`, `#flash-error`, hidden `input[name=csrf]` ทุกฟอร์ม

**Accessibility** ปุ่มทุกปุ่มมี `aria-label` ระบุชื่อพนักงาน; badge สถานะใช้ข้อความ (ไม่พึ่งสีอย่างเดียว); วันที่ใช้ `<time>`

---

### 2.2 Staffy-Leave-New — `/leaves/new`

**จุดประสงค์** ฟอร์มยื่นคำขอลา + แผงวันลาคงเหลือ

**Regions** ลิงก์ย้อนกลับ "← กลับไปรายการลา" → `h1` "ขอลาใหม่" → คำอธิบาย (D9: "HR และผู้ดูแลจะเห็นคำขอในรายการลา") → แถว 2 คอลัมน์: การ์ดฟอร์ม (flex 1, max 640, padding 28) + แผง aside 300px

**ฟอร์ม** `<form method="post" action="/leaves">` (บอร์ดเขียน `/leaves/new` ให้ใช้ `POST /leaves` ตาม [spec]) + hidden `csrf`
| ฟิลด์ (`name`) | Label | Control | กติกา [spec] | ข้อความ error (`.field-error[data-field]`) |
|---|---|---|---|---|
| `type` | ประเภทการลา | `<select>` ตัวเลือก (ตามลำดับบอร์ด): พักร้อน=`annual`, ลากิจ=`personal`, ลาป่วย=`sick` | ต้องเป็น 3 ค่านี้ | "เลือกประเภทการลา" (เสนอ) |
| `start_date` | วันที่เริ่มลา | `<input type="date">` | วันที่ถูกต้อง | "วันที่ไม่ถูกต้อง"; ถ้าทับใบอื่น: "ช่วงวันที่นี้ทับกับใบลาที่รออนุมัติหรืออนุมัติแล้ว" (เสนอ) |
| `end_date` | วันที่สิ้นสุด | `<input type="date">` | ≥ `start_date` และช่วง ≤ 30 วัน | "วันสิ้นสุดต้องไม่ก่อนวันเริ่มลา" (**verbatim บอร์ด**); "ช่วงลาต้องไม่เกิน 30 วัน" (เสนอ) |
| `reason` | เหตุผล *(ไม่ใส่ก็ได้)* | `<textarea rows=4 maxlength=255>` | ไม่บังคับ ≤255 | "เหตุผลยาวเกิน 255 ตัวอักษร" (เสนอ) |

- กล่องสรุป "จำนวนวันลา (ไม่นับเสาร์-อาทิตย์)" พื้น `#F0F2F9` แสดง "-" เมื่อกรอกไม่ครบ/ไม่ถูกต้อง ไม่เช่นนั้น "{n} วัน" (Prompt 18/600) — คำนวณฝั่ง JS เป็น progressive enhancement; ค่าจริงคำนวณฝั่ง server เสมอ
- ปุ่ม: "ส่งคำขอลา" (primary สูง 48) + "ยกเลิก" (outline) → `/leaves`
- **422**: re-render ฟอร์มพร้อมค่าที่กรอก; แบนเนอร์บนสุด `role="alert"` `#flash-error` "ส่งคำขอไม่สำเร็จ กรุณาแก้ช่องที่มีข้อความสีแดง"; ช่องที่ผิด `aria-invalid="true"` `aria-describedby` ชี้ `.field-error` ขอบ 2px `#B3261E`; ข้อความ error 14px/500 `#B3261E`; ในบอร์ดตัวอย่างคือ `end_date` ผิด
- สำเร็จ: **302** → `/leaves?msg=leave_created` สร้างแถว `status=pending`
- RBAC: บัญชี admin/hr ที่ไม่ผูกพนักงาน → `GET/POST` ตอบ **403**

**แผง "วันลาคงเหลือ ปี {พ.ศ.}"** (aside, ขาว radius 16, padding 24) **[เสนอ D8]** — 3 แถว: label (14/600) + "เหลือ **{left}** / {quota} วัน" + progress สูง 10px radius 5 พื้น `#ECEEF6` แท่ง: พักร้อน `#3B4BC4`, ลากิจ `#B7791F`, ลาป่วย `#14532D` ความกว้าง = left/quota (min 0%)
- quota มาจาก `company.quota_annual / quota_personal / quota_sick` (ค่าตัวอย่างบอร์ด: พักร้อน 10, ลากิจ 3, ลาป่วย 30 — **ไม่ตรงกับหน้า Company ที่ลากิจ=6** เป็นแค่ placeholder)
- used = ผลรวมวันลา (จันทร์–ศุกร์) ของใบ `approved` ที่ `start_date` อยู่ในปีปฏิทินเดียวกัน; left = max(0, quota − used)
- ข้อความท้าย (14px `#4F566E`): "ลาป่วยเกิน 3 วันติดต่อกัน ต้องแนบใบรับรองแพทย์ให้ HR" (เป็นข้อความแนะนำเท่านั้น ไม่มีระบบแนบไฟล์ ตาม Spec §1 ไม่มีไฟล์แนบ)
- ซ่อนแผงทั้งหมดถ้า `company` ยังไม่มีแถว

**Test hooks** `form[action="/leaves"]`, `input[name=csrf]`, `.field-error[data-field=end_date]`, `#flash-error`

---

### 2.3 Staffy-Account — `/account`

**Regions** `h1` "บัญชีของฉัน" → `#flash-ok` → แถว 2 คอลัมน์ (max-width 900): การ์ดข้อมูล 300px + ฟอร์มเปลี่ยนรหัสผ่าน

**การ์ดข้อมูล** avatar 64px (Prompt 26/600 พื้น `#E0E4FA` ตัวอักษร `#2B3699`), ชื่อ (18/600), username (14 `#4F566E`), badge บทบาท (admin `#FDE3C8/#7A3A07`, hr `#E0E4FA/#2B3699`, employee `#DDEFE4/#14573A`), `<dl>`: รหัสพนักงาน / แผนก / อีเมล ถ้าบัญชีไม่ผูกพนักงาน ซ่อน `<dl>` ทั้งก้อน และแสดงชื่อ = username

**ฟอร์ม** `<form method="post" action="/account/password">` + hidden `csrf`
| `name` | Label | `autocomplete` | หมายเหตุ |
|---|---|---|---|
| `current_password` | รหัสผ่านปัจจุบัน | `current-password` | ผิด → 422 `.field-error[data-field=current_password]` "รหัสผ่านปัจจุบันไม่ถูกต้อง" [spec ระบุ field; ข้อความเสนอ] |
| `new_password` | รหัสผ่านใหม่ | `new-password` | `aria-describedby="rules"` |
| `confirm_password` | ยืนยันรหัสผ่านใหม่ | `new-password` | ไม่ตรง → "ยืนยันรหัสผ่านไม่ตรงกัน" (เสนอ) |

ปุ่ม "บันทึกรหัสผ่านใหม่" (primary สูง 48)

**Component: checklist กติการหัสผ่าน (`ul#rules`)** ใต้ช่อง `new_password` แต่ละข้อ = ไอคอน 18px + ข้อความ 14px + ข้อความซ่อนสำหรับ screen reader: ผ่าน = เครื่องหมายถูก สี `#14532D` "(ผ่าน)"; ยังไม่ผ่าน = ขีดกลาง สี `#4F566E` "(ยังไม่ผ่าน)" อัปเดตสดด้วย JS ตอนพิมพ์ (progressive enhancement; server ตรวจซ้ำเสมอ) ข้อความตาม D2:
1. ยาวอย่างน้อย 10 ตัวอักษร
2. ไม่เกิน 72 byte (ภาษาไทยตัวละ 3 byte)
3. ไม่เหมือนชื่อผู้ใช้
(บอร์ดมี 3 ข้อคือ "ยาวอย่างน้อย 10 ตัวอักษร", "มีตัวอักษรและตัวเลขผสมกัน", "ไม่ซ้ำกับรหัสผ่านเดิม" — ข้อ 2-3 ของบอร์ดไม่อยู่ใน Spec)

**ข้อความ error รหัสใหม่** `.field-error[data-field=new_password]`: "รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร" / "รหัสผ่านยาวเกิน 72 byte" / "รหัสผ่านต้องไม่เหมือนชื่อผู้ใช้" (ทั้งหมดเสนอ)

**พฤติกรรม [spec]** สำเร็จ → ลบ session อื่นทั้งหมดของผู้ใช้ (คง session ปัจจุบัน) + audit `password_changed` → 302 `/account?msg=password_changed` → `#flash-ok`
**RBAC** ทุกบทบาทที่ล็อกอิน · **Cache** `no-store` · **Test hooks** `.field-error[data-field=current_password]`, `#flash-ok`

---

### 2.4 Staffy-Users — `/admin/users` (admin เท่านั้น)

**Regions** หัวหน้า: `h1` "บัญชีผู้ใช้" + "จัดการสิทธิ์และสถานะการเข้าสู่ระบบ · เฉพาะผู้ดูแลระบบ" + ปุ่ม "เพิ่มผู้ใช้" → `/admin/users/new` → ตารางผู้ใช้ → ส่วน "สิทธิ์ของแต่ละบทบาท" (3 การ์ด)

**ตาราง** (caption ซ่อน "รายการผู้ใช้ระบบ")
| คอลัมน์ | เนื้อหา |
|---|---|
| ชื่อผู้ใช้ | username (16/600) |
| พนักงานที่ผูกไว้ | "{ชื่อ-นามสกุล} ({employee_code})" หรือ "ไม่ผูกพนักงาน" |
| สิทธิ์ | `<select name="role">` สูง 44 ใน `<form method="post" action="/admin/users/{id}/role">` + hidden csrf; เปลี่ยนค่าแล้วต้องกดยืนยัน — **ไม่ใช้ auto-submit ด้วย JS**: ให้มีปุ่มเล็ก "บันทึก" ต่อท้าย select **[เสนอ D11]** |
| เปิดใช้งาน | **toggle switch** (component ด้านล่าง) |
| รหัสผ่าน | ปุ่ม outline "ตั้งรหัสใหม่" → `<details>` ในแถวเปิดช่อง `new_password` + ปุ่ม "ตั้งรหัสผ่าน" (D12) `aria-label="ตั้งรหัสผ่านใหม่ให้ {username}"` |

**Component: toggle switch `.toggle`** (เฉพาะหน้านี้) — `<form method="post" action="/admin/users/{id}/toggle">` + csrf ภายในมี `<button type="submit" role="switch" aria-checked="true|false" aria-label="เปิดใช้งาน {username}">` พื้นที่กด 52×44; ราง 44×26 radius 13 (เปิด `#3B4BC4` / ปิด `#6B7189`); ปุ่มกลม 20px ขาว top 3px, left 21px (เปิด) / 3px (ปิด); ไม่ใช้ JS เพราะส่งฟอร์มทุกครั้ง; **แถวของตัวเอง: `disabled` + ข้อความ title "ปิดหรือเปลี่ยนสิทธิ์บัญชีตัวเองไม่ได้"** (server ตอบ 403 [spec])

**Component: การ์ดสิทธิ์บทบาท `.role-card`** ×3 เรียงแนวนอน (flex gap 16) ขาว radius 16 ขอบ `#E1E4EF` padding 20: badge บทบาท + `<ul>` (14px line-height 1.8) — **ข้อความ verbatim**:
- admin: ทุกอย่างที่ HR ทำได้ · จัดการบัญชีผู้ใช้และสิทธิ์ · ลบพนักงาน · ดูบันทึกการใช้งานและสถานะระบบ
- hr: เพิ่ม แก้ไข ลาออก พนักงาน · ดูเงินเดือน · นำเข้า/ส่งออก CSV · อนุมัติ/ปฏิเสธการลา
- employee: ดูและแก้ข้อมูลของตัวเอง · ขอลาและดูวันลาคงเหลือ · ดูรายชื่อพนักงาน (ไม่เห็นเงินเดือน)
(ข้อความของ employee ในบอร์ดขัดกับ Spec §4: employee **ดูรายการพนักงานทั้งหมดไม่ได้** และแก้ข้อมูลตัวเองไม่ได้ (เพิ่ม/แก้พนักงานเฉพาะ admin/hr) → แก้ข้อความเป็น "ดูข้อมูลและเงินเดือนของตัวเอง · ขอลาและดูใบลาของตัวเอง · พิมพ์บัตรพนักงานของตัวเอง" **[ต่าง]** ข้อความของ hr "ลาออก" ใช้ได้ตามตาราง; admin ใช้ตามบอร์ด)

**หน้าเพิ่มผู้ใช้ `/admin/users/new` (ไม่มีบอร์ด — ใช้ pattern ฟอร์มเดียวกับ Leave-New)** ฟิลด์ตาม [spec]: `username` (3–30 ตัว a-z 0-9 _ . - ไม่ซ้ำ, เก็บ lowercase), `role` (select), `employee_id` (select พนักงานที่ยังไม่ผูกบัญชี; **บังคับเมื่อ role=employee** และต้องมีพนักงานนั้นอยู่จริง ผูกได้คนละหนึ่งบัญชี), `password` (นโยบายเดียวกับ §2.3; **[เสนอ]** ผู้ดูแลตั้งรหัสเริ่มต้น) `POST /admin/users` → 302 `/admin/users?msg=user_created`; ผิด → 422 + `.field-error[data-field=...]`

**พฤติกรรม [spec]** ตั้งรหัสใหม่ให้ผู้อื่น → ลบ session ทั้งหมดของผู้ใช้นั้น; ปิดบัญชี → ลบ session ทั้งหมดของบัญชีนั้น; ปิด/เปลี่ยนบทบาทตัวเอง → 403 · ทุกการกระทำเขียน audit (§2.5)
**States** Empty ไม่เกิดขึ้น (มี admin ≥1 เสมอ); error ผ่าน `#flash-error` · **Test hooks** `table tbody tr[data-id][data-username]` (เสนอ), `button[role=switch][aria-checked]`

---

### 2.5 Staffy-Audit — `/admin/audit` (admin เท่านั้น)

**Regions** `h1` "บันทึกการใช้งาน" + "ใครทำอะไร เมื่อไหร่ · เก็บย้อนหลัง 90 วัน · เฉพาะผู้ดูแลระบบ" (D1) → ฟอร์มกรอง (`method="get"`) → ตาราง → `#pagination`

**ฟอร์มกรอง** แถวเดียว gap 12 align-end (สูง 44): `actor` (search, "ผู้ใช้", placeholder "ชื่อผู้ใช้", กว้าง 200, ตรงบางส่วน ไม่สนตัวพิมพ์), `action` (select "การกระทำ": ทั้งหมด + รายการด้านล่าง, กว้าง 220), `from` (date "ตั้งแต่วันที่", 170), `to` (date "ถึงวันที่", 170), ปุ่ม "กรอง" (พื้น `#232A5C` ตัวขาว) — เริ่มต้น **ว่างทั้งหมด** (ค่าในบอร์ดเป็นตัวอย่าง) ช่วงวันที่ตีความตาม `APP_TZ` รวมวันปลายทาง **[ตัวกรอง = เสนอ; spec: "ล่าสุด แบ่งหน้าละ 50"]**

**ตาราง** (caption "บันทึกการใช้งานระบบ"; เรียงใหม่สุดก่อน; **50 แถว/หน้า [spec]**)
| คอลัมน์ | เนื้อหา |
|---|---|
| เวลา | `<time>` รูป "20 ต.ค. 2569 09:42" ตาม `APP_TZ`, `white-space: nowrap` |
| ผู้ใช้ | username (600) หรือ `unknown` ถ้า login_failed ที่ไม่มีผู้ใช้นี้ |
| การกระทำ | badge ตามรหัสด้านล่าง |
| เป้าหมาย | ข้อความอิสระ เช่น "สุนิสา วงศ์ใหญ่ (E0137)", "ชื่อผู้ใช้ somchai", "employees_oct.csv (48 แถว)", "-" |
| IP | ที่อยู่ client (14px `#4F566E`) ใช้ `X-Forwarded-For` เฉพาะเมื่อมาจาก proxy ที่ตั้งค่า trusted |

ข้อความทุกช่อง (โดยเฉพาะ username ที่ผู้โจมตีพิมพ์เองใน login_failed) ต้อง **HTML-escape**

**รหัสการกระทำ → ป้าย** (ชื่อรหัสที่ [spec] ระบุ: `login`, `login_failed`, `password_changed`, `employees_imported`, `employees_exported`; ที่เหลือ **เสนอ**)
| code | ป้าย | สี (พื้น/ตัวอักษร) |
|---|---|---|
| `login` | เข้าสู่ระบบ | `#ECEEF6/#4F566E` |
| `login_failed` | เข้าสู่ระบบไม่สำเร็จ | `#FDECEA/#8E1B12` |
| `password_changed` | เปลี่ยนรหัสผ่าน | `#ECEEF6/#4F566E` |
| `employee_created` / `employee_updated` / `employee_resigned` / `employee_deleted` | เพิ่มพนักงาน / แก้ไขพนักงาน / ให้พนักงานออก / ลบพนักงาน | `#E0E4FA/#2B3699` (ลบ: `#FDECEA/#8E1B12`) |
| `leave_created` / `leave_approved` / `leave_rejected` / `leave_cancelled` | ยื่นลา / อนุมัติลา / ปฏิเสธลา / ยกเลิกลา | อนุมัติ `#E6F4EA/#14532D`, ปฏิเสธ `#FDECEA/#8E1B12`, อื่นๆ `#ECEEF6/#4F566E` |
| `user_created` / `user_toggled` / `user_password_set` / `user_role_changed` | เพิ่มผู้ใช้ / เปิด-ปิดบัญชี / ตั้งรหัสผ่านให้ผู้ใช้ / เปลี่ยนสิทธิ์ | `#FDE3C8/#7A3A07` |
| `employees_imported` / `employees_exported` | นำเข้า CSV / ส่งออก CSV | `#FFF4DB/#6B4A00` |
| `department_created` / `department_updated` / `department_deleted` | เพิ่มแผนก / แก้ไขแผนก / ลบแผนก | `#E0E4FA/#2B3699` |
| `company_updated` | แก้ข้อมูลบริษัท | `#E0E4FA/#2B3699` |

dropdown การกระทำของบอร์ดมีเพียง 6 ตัวเลือก (ทั้งหมด, เข้าสู่ระบบ, แก้ไขพนักงาน, อนุมัติลา, เปลี่ยนสิทธิ์, นำเข้า CSV) → ทำให้ครบตามตารางนี้
**Pagination** "แสดง {from}–{to} จาก {total} รายการ" + ลิงก์หน้า/ก่อนหน้า/ถัดไป (part 1 §4) รักษา query string ตัวกรอง · `#pagination[data-page][data-pages][data-total]`
**States** Empty: "ไม่พบบันทึกตามเงื่อนไขนี้" (เสนอ); วันที่ `from` > `to` → สลับกัน หรือใช้ค่าเริ่มต้น (ไม่ตอบ error)
**ข้อห้าม** ห้ามบันทึกรหัสผ่านหรือ token ใน audit [spec]

---

### 2.6 Staffy-Status — `/admin/status` (admin เท่านั้น)

**Regions** หัวหน้า: `h1` "สถานะระบบ" + คำอธิบาย "งานประจำวัน (cron) ทำงานทุกวัน {CRON_SCHEDULE_LABEL} · เฉพาะผู้ดูแลระบบ" (D13: ซ่อนวลี "ทำงานทุกวัน…" ถ้าไม่ตั้ง env) + ปุ่ม outline "รันทันที" (`<form method="post" action="/admin/status/run">` + csrf) → แถวบน: การ์ดสถานะล่าสุด (กว้าง 320) + การ์ดกราฟ 14 วัน → ตารางประวัติ

**การ์ด "รันล่าสุด"** (padding 24 radius 16)
- สำเร็จ (`status=ok`): พื้น `#E6F4EA` ขอบ `#B5DFC2` ตัวอักษร `#14532D` ไอคอนเครื่องหมายถูก 28px + "สำเร็จ" (Prompt 28/600)
- ล้มเหลว (`status=error`): พื้น `#FDECEA` ขอบ `#F3B8B2` ตัวอักษร `#8E1B12` ไอคอน ✕ + "ล้มเหลว"
- บรรทัด: "วันนี้ 06:00 · ใช้เวลา 4.2 วินาที" (วันนี้/เมื่อวาน/วันที่; เวลา APP_TZ; ระยะเวลา = finished_at − started_at), "ตรวจ {rows_scanned} คน · ส่งอีเมลแจ้ง {emailed} ฉบับ" (ข้อความ verbatim บอร์ด) — **ไม่มีบรรทัด "รันครั้งถัดไป"** (D13)
- ยังไม่เคยรัน: การ์ดสีกลาง `#F0F2F9` "ยังไม่เคยรันงาน"

**Component: กราฟแท่ง 14 วัน `.bar-chart`** (เฉพาะหน้านี้) การ์ดขาว หัวข้อ "จำนวนแถวที่ประมวลผล 14 วันล่าสุด" (16/600) → `<svg viewBox="0 0 532 90" width="100%" height="110" role="img" aria-label="…">` แท่ง 14 อัน กว้าง 28 ระยะห่าง 38 (x = 0, 38, … 494) radius 4; แท่ง ok สี `#3B4BC4` สูงตามสัดส่วน `rows_scanned/max` (สูงสุด 64 ที่ y=8…72); แท่ง error สี `#B3261E` สูงคงที่ 16 (y=56); เส้นฐาน y=73 สี `#C5CADB`; ป้ายซ้ายสุด/ขวาสุดเป็นวันที่ย่อ (font 11 `#4F566E`); วันที่ไม่มีแถว = ไม่วาดแท่ง; `aria-label` สร้างจากข้อมูลจริง เช่น "กราฟแท่ง 14 วัน ทุกวันสำเร็จ ยกเว้นวันที่ 13 ต.ค. ที่ล้มเหลว" ข้อความใต้กราฟ "แท่งสีแดง คือรอบที่ล้มเหลว ({วันที่} {สาเหตุสั้น})" แสดงเมื่อมีแท่งแดง สร้างเป็น SVG ฝั่ง server ไม่ต้องใช้ไลบรารีกราฟ

**ตาราง "ประวัติการรันงานประจำวัน"** **20 แถวล่าสุด [spec]**
| คอลัมน์ | ที่มา |
|---|---|
| เริ่ม | `started_at` APP_TZ "20 ต.ค. 2569 06:00:01" |
| จบ | `finished_at` เวลาอย่างเดียว (ว่าง "-" ถ้ารอบนั้นยังไม่จบ) |
| สถานะ | badge สำเร็จ `#E6F4EA/#14532D` / ล้มเหลว `#FDECEA/#8E1B12` |
| แหล่งที่มา | `source` = `cron` / `manual` **[เพิ่มตาม Spec §7; ไม่มีในบอร์ด]** |
| แถวที่ประมวลผล | `rows_scanned` |
| อีเมลที่ส่ง | "{n} ฉบับ" (จาก `emailed=` ใน detail) |
| หมายเหตุ | สรุปจาก `detail`: `mail_failed:<msg>` → "ส่งอีเมลไม่สำเร็จ: {msg}"; มี `inserted=N` (N>0) → "แจ้งเตือนใหม่ {N} รายการ"; ไม่มี → "-" ; แถวค้าง (`detail=started`) → "ไม่จบการทำงาน" ; เก็บ `runtime=` ไว้ใน `title` ของเซลล์ |

**Test hooks** `table tbody tr[data-source][data-status]` (**เสนอ**; ใช้ตรวจ Spec ข้อทดสอบ "source=cron status=ok อย่างน้อย 2 แถว") · **States** รันสำเร็จ → 302 `/admin/status?msg=job_ran`; รันแล้ว error ไม่ crash (Spec §7) → ตารางแสดงแถวใหม่สีแดง

---

### 2.7 Staffy-403 — หน้า "ไม่มีสิทธิ์"

**ใช้เมื่อ** ล็อกอินแล้วแต่ไม่มีสิทธิ์ และเมื่อ CSRF ผิด [spec] — ตอบสถานะ **403** `Cache-Control: no-store` ใน app shell (sidebar ตามบทบาทผู้ใช้จริง D16)
**เนื้อหา** (กลางหน้า max-width 460 กึ่งกลาง): ไอคอนกุญแจในวงกลม 72px พื้น `#FFF4DB` สี `#6B4A00` → "403" (14/600 `#4F566E`) → `h1` "คุณไม่มีสิทธิ์เข้าหน้านี้" (Prompt 28/600) → ย่อหน้า: "หน้า **{ชื่อหน้า}** เปิดให้เฉพาะ{บทบาทที่ต้องมี} บัญชีของคุณมีสิทธิ์ {role ของผู้ใช้} ถ้าต้องใช้งานจริง ๆ ให้ติดต่อ HR หรือผู้ดูแลระบบเพื่อขอเปลี่ยนสิทธิ์" (ข้อความบอร์ด: "หน้า บัญชีผู้ใช้ เปิดให้เฉพาะผู้ดูแลระบบ (admin) บัญชีของคุณมีสิทธิ์ employee …" → ทำเป็น template รับ `page_name`, `required_roles_label`, `current_role`; กรณี CSRF ผิดหรือหาชื่อหน้าไม่ได้ ใช้ข้อความ "คุณไม่มีสิทธิ์ทำรายการนี้ ลองโหลดหน้าใหม่แล้วทำอีกครั้ง")
**ปุ่ม** D15: "ไปแดชบอร์ด" (primary) → `/dashboard`; "การลา" (outline) → `/leaves` · ผู้ใช้ที่ไม่ล็อกอินไม่เห็นหน้านี้ (ได้ 302 ไป `/login` [spec])
**ชื่อหน้า/บทบาทที่ต้องมี:** `/employees*` → "พนักงาน" · "admin หรือ hr"; `/admin/users` → "บัญชีผู้ใช้" · "ผู้ดูแลระบบ (admin)"; `/admin/audit` "บันทึกการใช้งาน"; `/admin/status` "สถานะระบบ"; `/admin/company` "ข้อมูลบริษัท" (admin); `/admin/departments` "แผนก" (admin หรือ hr)

### 2.8 Staffy-404 — หน้า "ไม่พบหน้า"

**ใช้เมื่อ** path ไม่มี / `{id}` ไม่ใช่เลข / ไม่พบรายการ / `/setup` ตอนมีผู้ใช้แล้ว [spec] ตอบ **404** HTML
**เนื้อหา** "404" (Prompt 72/600 สี `#3B4BC4`) → `h1` "ไม่พบหน้าที่ต้องการ" → "ลิงก์อาจผิด หรือพนักงานคนนั้นถูกลบออกจากระบบแล้ว ลองค้นหาชื่อหรือรหัสพนักงานแทนได้" → ฟอร์มค้นหา `GET /employees` (`name="q"`, label ซ่อน "ค้นหาพนักงาน", placeholder "ชื่อ รหัสพนักงาน หรืออีเมล", ปุ่ม "ค้นหา") → ลิงก์ลัด: แดชบอร์ด, รายการพนักงาน, การลา
- **employee**: ซ่อนฟอร์มค้นหาและลิงก์ "รายการพนักงาน" (เข้าไม่ได้) เหลือ "แดชบอร์ด", "การลา" **[เสนอ]**
- **ไม่ล็อกอิน** (เช่น `/setup` ที่ถูกปิดแล้ว, path เหลวไหล): แสดงเลย์เอาต์ **ไม่มี sidebar** และมีลิงก์ "เข้าสู่ระบบ" แทนฟอร์มค้นหา **[เสนอ]**

---

### 2.9 Staffy-Departments — `/admin/departments` **[ทั้งหน้าเสนอ]**

**Regions** หัวหน้า: `h1` "แผนก" + "{n} แผนก · ใช้กรองรายชื่อพนักงานและระบุหัวหน้าแผนก" (D10) + ปุ่ม "เพิ่มแผนก" → `/admin/departments/new` → `#flash-ok` → แถว 2 คอลัมน์: ตาราง (flex 1) + แผงฟอร์ม aside 360px

**ตาราง** (caption ซ่อน "รายการแผนก") คอลัมน์: **แผนก** (name 16/600), **รหัส** (`code` 14 `#4F566E`), **หัวหน้าแผนก** (ชื่อ-นามสกุล หรือ "ไม่ระบุ"), **พนักงาน** (จำนวนพนักงาน `active` ในแผนก, ชิดขวา, 600), **สถานะ** (badge ใช้งาน `#E6F4EA/#14532D` / ปิดใช้งาน `#ECEEF6/#4F566E`), ปุ่มลิงก์ "แก้ไข" (`aria-label="แก้ไขแผนก{name}"`, สูง 44 `#3B4BC4`) → `/admin/departments/{id}` แถวที่กำลังแก้ไข พื้น `#EEF0FC`

**Component: แผงแก้ไขด้านข้าง `.side-panel`** (aside, ขาว radius 16 padding 24 **ขอบ 2px `#3B4BC4`**) ใช้ทั้งโหมดเพิ่ม (หัวข้อ "เพิ่มแผนก", ช่องว่าง) และแก้ (หัวข้อ "แก้ไขแผนก", ค่าเดิม) `<form method="post" action="/admin/departments[/{id}]">` + csrf
| `name` | Label | กติกา [เสนอ] | error (`.field-error[data-field]`) |
|---|---|---|---|
| `name` | ชื่อแผนก | 1–60 ตัวอักษร, **ไม่ซ้ำ** (เทียบแบบไม่สนตัวพิมพ์/ช่องว่างหัวท้าย) | ซ้ำ: `มีแผนกชื่อ "{name}" อยู่แล้ว` (**verbatim บอร์ด**); ว่าง: "กรอกชื่อแผนก" |
| `code` | รหัสแผนก | ไม่บังคับ 2–10 ตัว A–Z 0-9, ไม่ซ้ำ | "รหัสแผนกใช้ได้เฉพาะ A–Z และตัวเลข 2–10 ตัว" / "รหัสนี้ถูกใช้แล้ว" |
| `head_employee_id` | หัวหน้าแผนก | select พนักงาน `active`; ตัวเลือก "ไม่ระบุ" = NULL | "ไม่พบพนักงานที่เลือก" |
| `is_active` | เปิดใช้งานแผนกนี้ | checkbox 22px `accent-color #3B4BC4` | — |
ปุ่ม "บันทึก" (primary) + "ยกเลิก" (outline → `/admin/departments`) ใต้ฟอร์มมีกล่องคำเตือน (พื้น `#FFF4DB` ขอบ `#F0D58A` ตัวอักษร `#6B4A00` 14px): "แผนกที่ยังมีพนักงานลบไม่ได้ ให้ย้ายพนักงานไปแผนกอื่นก่อน หรือปิดใช้งานแผนกแทน"
- **ลบ** (โหมดแก้ไข): ลิงก์/ปุ่มข้อความ "ลบแผนกนี้" ใต้ฟอร์ม (สี `#8E1B12`) → `POST /admin/departments/{id}/delete` แสดงได้เฉพาะแผนกที่ **ไม่มีพนักงานเลย (นับทั้ง resigned)**; ถ้ามีพนักงาน ซ่อนปุ่มและแสดงข้อความคำเตือนด้านบน; ถ้า POST ตรงๆ → **422** `#flash-error` "ลบไม่ได้ เพราะยังมีพนักงานในแผนกนี้ ให้ปิดใช้งานแทน"
- **422** (ชื่อซ้ำ ฯลฯ): re-render หน้าเดียวกัน แผงแสดงค่าที่กรอก ช่องผิดขอบ 2px `#B3261E` `aria-invalid` (ตัวอย่างในบอร์ด: แก้ "ขาย" แล้วชนชื่อ)
- สำเร็จ: 302 `/admin/departments?msg=department_created|department_updated|department_deleted` + audit
- แผนกที่ปิดใช้งาน: ไม่อยู่ในตัวเลือกแผนกของฟอร์มเพิ่ม/แก้พนักงาน (ยกเว้นแผนกปัจจุบันของพนักงานคนนั้นตอนแก้) และ **ไม่ถูกนับว่า "มีอยู่"** ตอนนำเข้า CSV → `unknown_department` ส่วนตัวกรอง `dept` ในรายการพนักงานแสดงทุกแผนก
- RBAC admin + hr · **Test hooks** `table tbody tr[data-id]`, `.field-error[data-field=name]`, `#flash-ok`
- ข้อมูลตัวอย่างในบอร์ด (บัญชี/ขาย/ไอที ...) เป็น placeholder; ข้อมูลตั้งต้นจริงคือ 8 แผนกใน seed: ฝ่ายบุคคล, ฝ่ายบัญชี, ฝ่ายขาย, ฝ่ายการตลาด, ฝ่ายผลิต, ฝ่ายคลังสินค้า, ฝ่ายไอที, ฝ่ายจัดซื้อ [spec §8]

---

### 2.10 Staffy-Company — `/admin/company` (admin เท่านั้น) **[ทั้งหน้าเสนอ]**

**Regions** `h1` "ข้อมูลบริษัท" + "ใช้บนบัตรพนักงาน อีเมลสรุปประจำวัน และค่าเริ่มต้นของระบบ · เฉพาะผู้ดูแลระบบ" → `#flash-error` (เมื่อ 422) → แถว 2 คอลัมน์: ฟอร์ม 3 การ์ด (flex 1) + aside 320px (โลโก้ + ตัวอย่างบัตร)

**โครง HTML ที่ต้องแก้จากบอร์ด** `<form id="company-form" method="post" action="/admin/company" enctype="multipart/form-data">` — ช่องไฟล์โลโก้ในบอร์ดอยู่ใน `<aside>` **นอก** `<form>` ให้ย้ายเข้าในฟอร์ม หรือใส่ `form="company-form"` ที่ `<input type="file">`; ปุ่มบันทึกอยู่ใต้การ์ดที่ 3

**การ์ด 1 "ข้อมูลทั่วไป"** (กริด 2 คอลัมน์ gap 16)
| `name` | Label | กติกา | error |
|---|---|---|---|
| `name_th` | ชื่อบริษัท (ไทย) | บังคับ 1–120 | "กรอกชื่อบริษัท" |
| `name_en` | ชื่อบริษัท (อังกฤษ) | ไม่บังคับ ≤120 | "ยาวเกิน 120 ตัวอักษร" |
| `tax_id` | เลขประจำตัวผู้เสียภาษี | ไม่บังคับ; ถ้ากรอกต้อง `^[0-9]{13}$`, `inputmode="numeric"` | **"ต้องเป็นตัวเลข 13 หลัก"** (verbatim บอร์ด; ตัวอย่างบอร์ดกรอก "01055") |
| `phone` | โทรศัพท์ | ≤20 เฉพาะตัวเลข + - ช่องว่าง (กติกาเดียวกับ phone พนักงาน [spec]) | "เบอร์โทรใช้ได้เฉพาะตัวเลข + - และช่องว่าง" |
| `address` | ที่อยู่ | textarea 3 แถว ≤255 | "ยาวเกิน 255 ตัวอักษร" |

**การ์ด 2 "ค่าเริ่มต้นของระบบ"** ("ใช้ตอนเพิ่มพนักงานใหม่และคำนวณวันลา")
| `name` | Label | ชนิด/กติกา |
|---|---|---|
| `emp_prefix` | รหัสพนักงานขึ้นต้นด้วย | text 1 ตัว A–Z (D3), default `E` |
| `work_start` | เริ่มงาน | `type=time` `HH:MM` |
| `work_end` | เลิกงาน | `type=time` ต้องหลัง `work_start` ("เวลาเลิกงานต้องหลังเวลาเริ่มงาน") |
| `quota_sick` / `quota_personal` / `quota_annual` | ลาป่วย / ลากิจ / พักร้อน (หัวข้อกลุ่ม "สิทธิ์วันลาต่อปี (วัน)") | `type=number min=0` จำนวนเต็ม 0–365; ค่าเริ่มต้นตัวอย่าง 30 / 6 / 10 |
**Component: ช่องเวลา `.time-input`** `<input type="time">` สูง 48 กว้างเต็มคอลัมน์ ใช้รูป 24 ชม.; ไม่ต้องมี JS

**การ์ด 3 "อีเมลสรุปประจำวัน"** ("งานตั้งเวลาจะส่งสรุปสัญญาใกล้หมด วันเกิด และใบลารออนุมัติ" → แก้ข้อความ: ใบลารออนุมัติ **ไม่อยู่ในสรุป** ตาม Spec §7 เหลือ "สัญญาใกล้หมดและวันเกิด") ฟิลด์: `digest_to` (email ≤120, "ส่งถึง", D4), `digest_time` ("เวลาส่ง": **อ่านอย่างเดียว** + ข้อความ "ตั้งเวลาที่ Cron Jobs ของ DirectAdmin" D5), checkbox `digest_on` "ส่งอีเมลสรุปทุกวัน" (สูง 44)

**Aside**
- **Component: ช่องอัปโหลดโลโก้ `.logo-uploader`**: ภาพปัจจุบัน 72×72 radius 16 (ไม่มีโลโก้ → ตัวอักษรแรกของ `name_th` บนพื้น `#232A5C` ตัวขาว Prompt 28/600) + `<label for="logo">` หน้าตาเป็นปุ่ม outline "เลือกไฟล์ใหม่" (สูง 44) + `<input id="logo" name="logo" type="file" accept="image/png,image/jpeg">` ซ่อนแบบเข้าถึงได้ (ไม่ใช้ `display:none`; ต้องโฟกัสด้วยคีย์บอร์ดได้ และขอบ focus แสดงที่ label) + ข้อความ "PNG หรือ JPG ไม่เกิน 1 MB"; error `.field-error[data-field=logo]`: "ไฟล์ต้องเป็น PNG หรือ JPG" / "ไฟล์ใหญ่เกิน 1 MB"
- **ตัวอย่างบัตรพนักงาน** (preview แบบ static, อัปเดตด้วย JS ตอนพิมพ์ชื่อได้ ไม่บังคับ): หัวบัตรพื้น `#232A5C` มีโลโก้ 32px + ชื่อบริษัท; เนื้อบัตร avatar 56px + ชื่อ + "ตำแหน่ง · รหัส" (placeholder) — D7

**พฤติกรรม**
- บันทึกสำเร็จ: 302 `/admin/company?msg=company_updated` + audit `company_updated`
- 422: `#flash-error` "บันทึกไม่สำเร็จ กรุณาแก้ {n} ช่องที่มีข้อความสีแดง" (บอร์ด n=1) ช่องผิดขอบ 2px `#B3261E` + `aria-invalid`; **ไฟล์โลโก้ที่เลือกไว้หายเมื่อ 422** (ข้อจำกัดของเบราว์เซอร์) ให้แจ้งใน flash ว่า "เลือกไฟล์โลโก้ใหม่อีกครั้ง" ถ้ามีไฟล์แนบมาด้วย
- ตรวจไฟล์โลโก้ที่ **magic bytes** (PNG `89 50 4E 47`, JPEG `FF D8 FF`) ไม่เชื่อ Content-Type/นามสกุล; จำกัด 1 MB ที่ระดับ server ด้วย (`upload_max_filesize` / body limit); เก็บนอก web root และเสิร์ฟผ่าน `GET /admin/company/logo` (ต้องล็อกอิน) ตั้งชื่อไฟล์เองไม่ใช้ชื่อจากผู้ใช้
- ที่ที่ใช้ค่า: `name_th` แทน `COMPANY_NAME` บนบัตร PDF (fallback env ถ้า DB ว่าง); `quota_*` ในแผง §2.2; `digest_*` ในงานรายวัน (D4/D5)
- `company` เป็นแถวเดียว (id=1) สร้างตอน seed; หน้านี้ UPDATE เท่านั้น

---

## 3. ข้อเสนอ schema และ route (proposed — ต้องเพิ่มใน Spec Doc)

> Spec §3 บอกว่า "9 ตาราง" — เมื่อเพิ่ม `company` เป็น **10 ตาราง** ต้องแก้ตัวเลขและเรื่อง `/test/seed?reset=1` (ต้องไม่ลบ `company` และ `departments` ที่ผู้ใช้สร้าง) ใน Spec ด้วย

### 3.1 `departments` (มีอยู่แล้วใน Spec — เพิ่มคอลัมน์)
```sql
-- ถ้ายังไม่มี UNIQUE บน name ให้เพิ่ม
ALTER TABLE departments
  ADD COLUMN code VARCHAR(10) NULL,
  ADD COLUMN head_employee_id INT UNSIGNED NULL,
  ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1,
  ADD UNIQUE KEY uq_departments_name (name),
  ADD UNIQUE KEY uq_departments_code (code),
  ADD CONSTRAINT fk_departments_head FOREIGN KEY (head_employee_id)
      REFERENCES employees(id) ON DELETE SET NULL;
-- employees.department_id ต้องเป็น FK ... ON DELETE RESTRICT (ลบแผนกที่มีพนักงานไม่ได้)
```
ชนิดของ `id` ให้ตรงกับที่ Spec/`schema.sql` ใช้จริง · seed 8 แผนกเดิมให้ `is_active=1`, `code` = NULL หรือรหัสย่อ (เช่น HR, ACC, SAL, MKT, PRD, WH, IT, PUR)

### 3.2 `company` (ตารางใหม่ แถวเดียว)
```sql
CREATE TABLE company (
  id            TINYINT UNSIGNED NOT NULL DEFAULT 1 PRIMARY KEY,
  name_th       VARCHAR(120) NOT NULL,
  name_en       VARCHAR(120) NULL,
  tax_id        CHAR(13)     NULL,
  phone         VARCHAR(20)  NULL,
  address       VARCHAR(255) NULL,
  logo_path     VARCHAR(255) NULL,          -- ชื่อไฟล์ที่ระบบตั้งเอง ไม่ใช่ชื่อจากผู้ใช้
  emp_prefix    CHAR(1)      NOT NULL DEFAULT 'E',
  work_start    TIME         NOT NULL DEFAULT '08:30:00',
  work_end      TIME         NOT NULL DEFAULT '17:30:00',
  quota_sick     TINYINT UNSIGNED NOT NULL DEFAULT 30,
  quota_personal TINYINT UNSIGNED NOT NULL DEFAULT 6,
  quota_annual   TINYINT UNSIGNED NOT NULL DEFAULT 10,
  digest_to     VARCHAR(120) NULL,          -- ว่าง = ใช้ HR_EMAIL จาก config
  digest_on     TINYINT(1)   NOT NULL DEFAULT 1,
  updated_at    DATETIME     NOT NULL,      -- UTC เหมือนตารางอื่น
  updated_by    INT UNSIGNED NULL,          -- users.id
  CONSTRAINT chk_company_single CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
INSERT INTO company (id, name_th, updated_at) VALUES (1, 'บริษัท ตัวอย่าง จำกัด', UTC_TIMESTAMP());
```
(ไม่เก็บ `digest_time` — D5) · ทุก stack ใช้ DDL เดียวกัน; MySQL เก่าที่ไม่บังคับ CHECK ให้ตรวจ `id=1` ในโค้ด

### 3.3 `leave_requests` / `users`
- `leave_requests.status` ต้องรองรับ `pending`, `approved`, `rejected`, **`cancelled`** (Spec ใช้คำว่า "ยกเลิก" แต่ไม่ระบุค่า) — ยืนยันกับ `schema.sql` ปัจจุบัน
- ไม่เพิ่มคอลัมน์ `days` (คำนวณตอนแสดง) — หรือเพิ่ม `days TINYINT` ถ้าต้องการเร่งความเร็วแผงโควตา

### 3.4 `job_runs` (หน้า Status)
```sql
ALTER TABLE job_runs
  ADD COLUMN finished_at  DATETIME NULL,
  ADD COLUMN rows_scanned INT UNSIGNED NULL;   -- จำนวนพนักงาน active ที่ตรวจ
```
งานรายวันเซ็ตสองค่านี้ตอนจบรอบ (UTC) ส่วน `source`, `status`, `detail` และรูปแบบ `detail` ตาม Spec §7 คงเดิม

### 3.5 Routes ใหม่ทั้งหมด (สรุป)
| Method | Path | ใคร | พฤติกรรม | สำเร็จ | ผิด |
|---|---|---|---|---|---|
| GET | `/admin/departments` | admin, hr | รายการ + แผงโหมดเพิ่มว่าง (ซ่อนแผงจนกด "เพิ่มแผนก" หรือแสดงแผงเพิ่มตลอดก็ได้) | 200 | 403 |
| GET | `/admin/departments/new` | admin, hr | หน้าเดียวกัน แผงโหมดเพิ่ม | 200 | 403 |
| GET | `/admin/departments/{id}` | admin, hr | หน้าเดียวกัน แผงโหมดแก้ | 200 | 404 ถ้าไม่พบ |
| POST | `/admin/departments` | admin, hr | สร้าง | 302 `/admin/departments?msg=department_created` | 422 |
| POST | `/admin/departments/{id}` | admin, hr | แก้ | 302 `…?msg=department_updated` | 422 / 404 |
| POST | `/admin/departments/{id}/delete` | admin, hr | ลบเมื่อไม่มีพนักงานเลย | 302 `…?msg=department_deleted` | 422 ถ้ามีพนักงาน / 404 |
| GET | `/admin/company` | admin | ฟอร์ม | 200 | 403 |
| POST | `/admin/company` (multipart) | admin | บันทึก (UPDATE id=1) | 302 `/admin/company?msg=company_updated` | 422 |
| GET | `/admin/company/logo` | ล็อกอินแล้ว | ส่งไฟล์โลโก้ `Cache-Control: private, max-age=300` | 200 | 404 ถ้าไม่มี |
| POST | `/admin/status/run` | admin | เรียก daily ด้วย `source=manual` | 302 `/admin/status?msg=job_ran` | 403 |
| GET | `/admin/users/new` | admin | ฟอร์มเพิ่มผู้ใช้ | 200 | 403 |
| POST | `/admin/users/{id}/role` | admin | เปลี่ยนบทบาท (ตัวเอง → 403; เปลี่ยนเป็น employee ต้องมี `employee_id`) | 302 `/admin/users?msg=user_updated` | 403 / 422 |
ทุก POST: ตรวจ CSRF (ผิด → 403), redirect ใช้ path สัมพัทธ์ [spec], ล้าง `cache/stats.json` เมื่อเขียน `employees`/`leave_requests` [spec §8]

### 3.6 ตารางตรวจข้อมูล (สรุปกติกาที่เสนอ)
| ข้อมูล | กติกา |
|---|---|
| `departments.name` | 1–60, ไม่ซ้ำ (trim, ไม่สนตัวพิมพ์) |
| `departments.code` | ว่าง หรือ `^[A-Z0-9]{2,10}$` ไม่ซ้ำ |
| `departments.head_employee_id` | ว่าง หรือพนักงาน `active` ที่มีอยู่จริง |
| ลบแผนก | ได้เมื่อ `COUNT(employees WHERE department_id=?)=0` (รวม resigned) ไม่เช่นนั้นให้ปิดใช้งาน |
| `company.tax_id` | ว่าง หรือ `^[0-9]{13}$` |
| `company.name_th` | บังคับ 1–120 |
| `company.emp_prefix` | `^[A-Z]$` |
| `company.work_start/end` | `HH:MM`, end > start |
| `company.quota_*` | จำนวนเต็ม 0–365 |
| `company.digest_to` | ว่าง หรืออีเมลถูกรูปแบบ ≤120 |
| โลโก้ | PNG/JPEG (magic bytes) ≤ 1 MB |

---

## 4. Key flows (ผลที่ต้องได้ตรงกันทุก stack)

**F-A ยื่นลา → อนุมัติ/ปฏิเสธ** [spec]
1. employee `GET /leaves/new` → 200; กรอกแล้ว `POST /leaves` → ผ่าน = **302** `/leaves?msg=leave_created` แถวใหม่ `pending`
2. กรณีผิด: `end_date` < `start_date` / ช่วง > 30 วัน / ทับใบ pending-approved ของตัวเอง → **422** ฟอร์มเดิม + ค่าที่กรอก + `.field-error[data-field]`
3. hr `GET /leaves` (แท็บ "รออนุมัติ" default) เห็นใบ → `POST /leaves/{id}/approve` = **302** (หรือ `/reject`) → ใบเปลี่ยนสถานะ + audit `leave_approved`/`leave_rejected`
4. hr อนุมัติใบ **ตัวเอง** → **403**; ใบที่ไม่ pending → **422**; employee อนุมัติ → **403**
5. เจ้าของ `POST /leaves/{id}/cancel` ใบ pending → **302** `leave_cancelled`; ใบที่ไม่ pending → **422**

**F-B เปลี่ยนรหัสผ่านตัวเอง** [spec §5] `GET /account` → `POST /account/password`: รหัสปัจจุบันผิด = **422** `data-field=current_password`; นโยบายไม่ผ่าน = 422 `data-field=new_password`; สำเร็จ = session อื่นถูกลบ, session นี้อยู่, audit `password_changed`, **302** `/account?msg=password_changed`

**F-C เพิ่มผู้ใช้ / ตั้งรหัสใหม่** (admin) `/admin/users/new` → `POST /admin/users`: username ซ้ำ/รูปแบบผิด/ role=employee ไม่มี `employee_id`/ พนักงานถูกผูกแล้ว = **422**; สำเร็จ **302** + audit `user_created` · ตั้งรหัสใหม่ `POST /admin/users/{id}/password` → ลบ session ทั้งหมดของผู้ใช้นั้น + audit `user_password_set` · ปิดบัญชี `…/toggle` → ลบ session บัญชีนั้น + audit `user_toggled`; ทำกับตัวเอง = **403**

**F-D ดู audit** (admin) ทำ F-A…F-C แล้วเปิด `/admin/audit` → เห็นแถวตามลำดับใหม่สุดก่อน, ตัวกรอง `actor`/`action`/`from`/`to` ทำงานร่วมกันแบบ AND, 50 แถว/หน้า, ไม่มีรหัสผ่านในข้อมูล; hr/employee เรียก = **403**; ไม่ล็อกอิน = **302** `/login`

**F-E รันงานรายวันทันที** (admin) `/admin/status` → "รันทันที" `POST /admin/status/run` → ใช้โค้ดชุดเดียวกับ cron (`source=manual`) → **302** `/admin/status?msg=job_ran` → ตารางมีแถวใหม่ (`status=ok` หรือ `error` + `detail` มี `mail_failed:` ถ้าอีเมลล้ม — ไม่ crash) รันซ้ำวันเดียวกัน = ไม่มีแจ้งเตือน/อีเมลซ้ำ [spec]

**F-F แก้แผนก ชื่อซ้ำ** (admin/hr) `GET /admin/departments/{id}` → เปลี่ยนชื่อเป็นชื่อแผนกอื่น → `POST` = **422** หน้าเดิม แผงยังเปิดโหมดแก้ ค่าที่กรอกคงอยู่ `.field-error[data-field=name]` `มีแผนกชื่อ "ขาย" อยู่แล้ว`; แก้เป็นชื่อใหม่ = **302** `department_updated`; ปิดใช้งาน = พนักงานเดิมยังอยู่ในแผนก แผนกหายจากตัวเลือกฟอร์ม; ลบแผนกที่มีพนักงาน = **422**

**F-G แก้ข้อมูลบริษัท + โลโก้** (admin) `GET /admin/company` → แก้ `tax_id` เป็น 5 หลัก → `POST` = **422** `data-field=tax_id` "ต้องเป็นตัวเลข 13 หลัก" + `#flash-error`; แก้ถูก + แนบ PNG 200 KB = **302** `company_updated`, `GET /admin/company/logo` ส่งภาพได้; แนบ .exe เปลี่ยนนามสกุลเป็น .png = **422** `data-field=logo`; hr เรียก = **403**

---

## 5. Checklist สำหรับ Claude Code

### 5.1 ไฟล์ template/ส่วนที่ต้องมี (ชื่อกลางๆ ปรับตาม stack)
```
templates/
  layout.html                 # shell + sidebar กรองตามบทบาท (part 1)
  layout_public.html          # ไม่มี sidebar (404 ตอนไม่ล็อกอิน, /login, /setup)
  leaves/index.html           leaves/new.html
  account/index.html
  admin/users.html            admin/users_new.html
  admin/audit.html            admin/status.html
  admin/departments.html      admin/company.html
  errors/403.html             errors/404.html
partials/
  pagination, flash, field_error, status_badge, leave_type_label      # part 1
  toggle_switch, role_card, bar_chart_svg, progress_bar, side_panel   # ภาคนี้
static/css/staffy.css         # tokens จาก part 1 + component ของภาคนี้
lib/
  thai_date (พ.ศ., เดือนย่อ), weekday_count, audit_write(action,target), flash_codes
sql/schema.sql  sql/migrate_company_departments.sql  # §3
```
Component CSS ของภาคนี้: `.toggle`, `.role-card`, `.bar-chart`, `.progress` (balance), `.side-panel`, `.logo-uploader`, `.checklist` (กติการหัสผ่าน), `.tabs-nav` (แท็บสถานะ), `.time-input` — ค่าสี/ขนาดตามที่ระบุในแต่ละหน้า; ขนาดกดทุกปุ่ม ≥ 44px; contrast ≥ 4.5:1 (ตัวอักษร `#4F566E` บน `#F5F6FA/#FFF` ผ่านแล้ว)

### 5.2 ลำดับการทำงาน
1. Migration §3 (`company`, ALTER `departments`, `job_runs`) + seed แถว `company` + อัปเดต `/test/seed` ไม่ให้ reset แตะสองตารางนี้
2. Helper กลาง: `audit_write`, flash code map (§1.3), `thai_date`, `weekday_count`, sidebar ตามบทบาท (§1.2), หน้า 403/404 (§2.7–2.8)
3. Account (§2.3) — ง่ายสุด ลองระบบ CSRF + `.field-error` + flash ก่อน
4. Leaves + Leave-New (§2.1–2.2) รวม approve/reject/cancel และกติกา 422/403
5. Users + users/new + role/toggle/password (§2.4)
6. Departments (§2.9) แล้วไปแก้ฟอร์มพนักงาน/CSV import ให้เคารพ `is_active` (§2.9)
7. Company (§2.10) + upload โลโก้ + ต่อเข้า PDF `COMPANY_NAME` fallback + โควตาใน §2.2 + `digest_on/digest_to` ใน daily job
8. Audit (§2.5) — ทำท้ายสุดเพราะต้องมีเหตุการณ์ครบ แล้วตามด้วย Status (§2.6) + migration `job_runs` + ปุ่มรันทันที
9. ตรวจเมนู/ลิงก์ข้ามหน้าครบ, ไล่ a11y

### 5.3 Acceptance checks (ผูกกับข้อทดสอบใน Spec §11)
| # | ตรวจ | ผลที่ต้องได้ |
|---|---|---|
| A1 | F9: ยื่น/ทับ/end<start/>30 วัน/อนุมัติ/ปฏิเสธ/ยกเลิก pending และไม่ใช่ pending | 302 / 422 / 422 / 422 / 302 / 302 / 302 / 422 |
| A2 | hr อนุมัติใบลาของตัวเอง; employee อนุมัติ | 403 ทั้งสอง |
| A3 | ไม่ล็อกอินเรียก `/leaves`, `/account`, `/admin/*` (GET และ POST) | 302 `/login` |
| A4 | ล็อกอินแล้ว employee เปิด `/admin/users`, `/admin/audit`, `/admin/status`, `/admin/company`, `/admin/departments`; hr เปิด `/admin/users`, `/admin/company` | 403 พร้อมหน้า errors/403 และ `Cache-Control: no-store` |
| A5 | hr เปิด `/admin/departments` | 200 |
| A6 | เปลี่ยนรหัสผ่าน: current ผิด → 422 `current_password`; สำเร็จ → session อื่นหาย, audit `password_changed` | ตรงตามนี้ |
| A7 | Users: ปิด/เปลี่ยนสิทธิ์บัญชีตัวเอง | 403 |
| A8 | แผนกชื่อซ้ำ → 422 ข้อความ `มีแผนกชื่อ "…" อยู่แล้ว`; ลบแผนกที่มีพนักงาน → 422; แผนก inactive ไม่อยู่ในฟอร์มพนักงาน | ตรงตามนี้ |
| A9 | Company: `tax_id` ไม่ครบ 13 หลัก → 422; โลโก้ผิดชนิด/ใหญ่เกิน → 422; admin บันทึกถูก → 302 และมี audit | ตรงตามนี้ |
| A10 | Audit: กรองด้วย `actor`/`action`/ช่วงวัน, 50 แถว/หน้า, ไม่มี password ใน HTML; ข้อความผู้ใช้ถูก escape (ลอง username `<script>`) | ตรงตามนี้ |
| A11 | Status: `/admin/status` มีแถว `source=cron status=ok` ≥ 2 แถวหลังรัน cron สองรอบ; `POST /admin/status/run` เพิ่มแถว `source=manual`; จำลองอีเมลล้ม → `status=error` `detail` มี `mail_failed` ไม่ crash | ตรงตามนี้ |
| A12 | หน้าทุกหน้าของภาคนี้ผ่านแป้นพิมพ์ล้วน (Tab ได้ครบ, โฟกัสมองเห็น), ฟอร์มมี `<label for>`, ข้อผิดพลาดผูก `aria-describedby`, ปุ่มสวิตช์มี `aria-checked`, ตาราง `<caption>`+`<th scope>` | ผ่านทั้งหมด |
| A13 | ทุกฟอร์ม POST มี `input[name=csrf]`; ส่งโดยไม่มี/ผิด → 403 ไม่ทำรายการ | ตรงตามนี้ |
| A14 | ไม่มี `{{ ... }}` หรือ ข้อมูลตัวอย่างของบอร์ด (สมหญิง ใจดี, EMP-0137, 203.0.113.x) หลุดมาในโค้ด/seed จริง | ตรวจด้วย grep |

### 5.4 สิ่งที่ต้องกลับไปแก้ Spec Doc (สรุป)
ตาราง `company` (10 ตาราง), คอลัมน์ใหม่ของ `departments` และ `job_runs`, routes ใน §3.5, สถานะ `cancelled`, ข้อความเรื่องผู้รับอีเมลจาก DB (D4), การคำนวณวันลา/โควตา (D8), `POST /admin/status/run` (D14), ตัวกรองของ `/admin/audit`, และ `employee_code` กับ `emp_prefix` (D3)
