# Staffy — Design Spec ส่วนที่ 1 (shell, tokens, components, 8 หน้าหลัก)

ใช้คู่กับ Spec: Staffy (Claude Doc id `0776144b-d033-4b27-8f2e-0cc4d473f027`) และไฟล์ออกแบบอ้างอิงใน `reference-boards/*.dc.html` ถ้าเอกสารนี้ขัดกับ Spec ให้ **ยึด Spec** (ดูหัวข้อ 0)

ส่วนที่ 2 (`DESIGN-staffy-2.md`) ครอบคลุม: Leaves, Leave-New, Account, Users, Audit, Status, 403, 404, Departments, Company ใช้ tokens/components/shell จากไฟล์นี้ร่วมกัน

ขอบเขตเทคนิค: Staffy render ฝั่ง server เป็นภาษาไทยอย่างเดียว ต้องทำได้ทั้ง 4 stack (Apache+PHP, Nginx+PHP-FPM, Node/Express, Flask) ให้หน้าตาเหมือนกัน จึงใช้ **CSS ไฟล์เดียว** (`static/css/staffy.css`), JS น้อยที่สุด (ไม่มี build step, ไม่มี framework) และ markup ที่ template ทุก stack เขียนซ้ำได้ตรงๆ

---

## 0. จุดที่ design board ไม่ตรงกับ Spec (อ่านก่อนเริ่ม)

บอร์ดวาดก่อนตรวจ Spec ละเอียด ตารางนี้คือข้อสรุปว่าต้องทำตามอะไร

| # | บอร์ดแสดง | Spec กำหนด | ให้ทำ |
|---|---|---|---|
| 1 | รหัสพนักงาน `EMP-0137` | `employee_code` ตรง `^[A-Z][0-9]{4,9}$` เช่น `E0001` (seed ใช้ `S`) | ใช้รูปแบบ Spec ในทุกที่ (ข้อมูลตัวอย่างในบอร์ดอ่านเป็น `E0137`) placeholder ของช่องรหัส: `เช่น E0138` |
| 2 | ฟอร์มพนักงานมี `national_id` และ `address` | ไม่มีสองฟิลด์นี้ใน schema (หัวข้อ 3–4) | **ไม่ทำ** ถ้าพี่ต้องการ ให้เพิ่มคอลัมน์และกติกาตรวจใน Spec ก่อน |
| 3 | ฟอร์มไม่มี nickname; ช่องตำแหน่ง `name="position"`, แผนก `name="department"` | ฟิลด์คือ `nickname` (ไม่บังคับ ≤30), `job_title`, `department_id` | เพิ่มช่อง "ชื่อเล่น" และใช้ชื่อฟิลด์ตาม Spec |
| 4 | ข้อความ error วันเริ่มงาน "ไม่อยู่ในอนาคตเกิน 90 วัน" | `hire_date` ≤ วันนี้ + **365** วัน, ≥ 1970-01-01 | ข้อความ: `วันเริ่มงานต้องไม่เกินวันนี้ไป 365 วัน` |
| 5 | `/setup` มี `full_name`, `email`, `password_confirm`, และเงื่อนไข "ต้องมีตัวอักษรและตัวเลข" | ฟิลด์คือ `username`, `password`, `confirm_password` เท่านั้น; รหัสผ่าน ≥10 ตัว, ≤72 byte (UTF-8), ไม่เหมือน username | ตัด `full_name`/`email` ออก, ใช้ชื่อ `confirm_password`, ข้อความกติกาตาม Spec ส่วนแถบความแข็งแรงเป็นแค่ตัวช่วยฝั่ง client (ไม่บังคับ) |
| 6 | "ออกจากระบบ" เป็นลิงก์ | `POST /logout` ต้องมี csrf | ใช้ `<form method="post" action="/logout">` + `<button>` ที่หน้าตาเหมือนลิงก์ |
| 7 | Dialog ลาออกมีช่อง `resign_date` | `POST /employees/{id}/resign` แค่ตั้งสถานะ `resigned` ไม่มีวันที่ | ตัดช่องวันที่ออก (ถ้าต้องการเก็บวันที่ลาออก ต้องเพิ่มคอลัมน์ใน Spec ก่อน) ข้อความ "ย้อนกลับได้โดย HR" ให้ตัดออกเว้นแต่มีฟีเจอร์ย้อนกลับจริง |
| 8 | นำเข้า CSV: จำกัด 2 MB / 1,000 แถว, ติ๊ก "ลองตรวจก่อน (dry run)", ลิงก์ `template.csv`, ปุ่ม "ดาวน์โหลดแถวที่มีปัญหา", ตาราง 7 คอลัมน์ | จำกัด **5 MB / 5,000 แถว**, หัวตาราง **13 คอลัมน์**, ไม่มี dry run, ไม่มี route template/ดาวน์โหลดแถวเสีย | ใช้ตัวเลขและคอลัมน์ตาม Spec; ตัด dry-run checkbox, ลิงก์ template และปุ่มดาวน์โหลด (ทางลัด: ส่งออก CSV จะได้ไฟล์ที่ใช้เป็นแม่แบบได้) |
| 9 | ตารางผลนำเข้ามีคอลัมน์ "ชื่อ" + ข้อความปัญหา | แต่ละแถวบอก **เลขบรรทัด, employee_code, เหตุผล** (`invalid_field:<field>`, `unknown_department`, `duplicate`) แสดงสูงสุด 100 แถวแรก | เปลี่ยนคอลัมน์ "ชื่อ" เป็น "รหัสพนักงาน" แล้วแปลงรหัสเหตุผลเป็นข้อความไทยตอน render (ดูหัวข้อ 5.8) |
| 10 | วันที่แสดงแบบ พ.ศ. (`3 ก.ย. 2569`) | DB/CSV/PDF เป็น ค.ศ. `YYYY-MM-DD`; หน้ารายละเอียดต้องแสดง "สร้างเมื่อ/แก้ไขล่าสุด" เป็น `YYYY-MM-DD HH:MM` ตาม `APP_TZ` | UI ทั่วไปแสดงวันที่แบบไทยสั้น พ.ศ. ผ่าน helper เดียว (`format_date_th`) ส่วน `input[type=date]`, CSV, PDF และเวลา "สร้างเมื่อ/แก้ไขล่าสุด" ใช้ ค.ศ. ตาม Spec |
| 11 | แผงใน dashboard (ใบลารออนุมัติ, สัญญาใกล้หมด, วันเกิด) | Spec กำหนดแค่ "ตัวเลขสรุป" + `#dashboard` data-* | แผงเหล่านี้เป็นส่วนเสริมที่ไม่ขัด Spec ทำได้ ให้ query จากตารางเดิม (ดู 5.3) |
| 12 | หน้า Departments/Company (ส่วนที่ 2) | ยังไม่มี route/ตารางใน Spec (มี `departments` แต่ไม่มี company/route ตั้งค่า) | เพิ่มลง Spec ก่อนทำ (ดูส่วนที่ 2) |
| 13 | ตัวอย่างข้อมูลในบอร์ด (ชื่อ, ตัวเลข 137/128, เงินเดือน 28,000) | — | เป็นข้อมูลสาธิต ห้าม hardcode |

---

## 1. ภาพรวมและแผนที่ board → route

บทบาท: `admin`, `hr`, `employee` (ฟอร์ม HTML ใช้แค่ GET/POST, POST สำเร็จแล้ว 302 ไปหน้าผลลัพธ์พร้อม `?msg=<code>`)

| Board (ไฟล์ใน reference-boards) | Route | Method | ใครเข้าได้ | ผลเมื่อไม่ผ่าน |
|---|---|---|---|---|
| `Staffy-Login` | `/login` | GET, POST | ยังไม่ล็อกอิน | POST ผิด → 401 + `#login-error[data-reason]` |
| `Staffy-Setup` | `/setup` | GET, POST | ยังไม่ล็อกอิน **และตาราง users ว่าง** | มีผู้ใช้แล้ว → 404 ทั้ง GET/POST |
| `Staffy-Dashboard` | `/dashboard` | GET | ทุกบทบาท (employee เห็นเฉพาะใบลาตัวเอง) | ไม่ล็อกอิน → 302 `/login` |
| `Staffy-Employees` | `/employees` | GET | admin, hr | employee → 403 |
| `Staffy-Emp-Form` (เพิ่ม) | `/employees/new` → POST `/employees` | GET, POST | admin, hr | ข้อมูลผิด → 422 แสดงฟอร์มเดิม |
| `Staffy-Emp-Form` (แก้) | `/employees/{id}/edit` → POST `/employees/{id}` | GET, POST | admin, hr | 422 เหมือนกัน |
| `Staffy-Emp-Detail` | `/employees/{id}` | GET | admin, hr, **เจ้าของข้อมูล** | อื่นๆ → 403 |
| (dialog ใน Emp-Detail) | `/employees/{id}/resign` | POST | admin, hr | — |
| (ปุ่ม "ลบ" ใน Emp-Detail) | `/employees/{id}/delete` | POST | **admin เท่านั้น** | hr → 403 |
| (ปุ่ม "พิมพ์บัตร PDF") | `/employees/{id}/card.pdf` | GET | admin, hr, เจ้าของ | — |
| (ปุ่ม "ส่งออก CSV") | `/employees/export.csv` | GET | admin, hr | — |
| `Staffy-Import-Upload` | `/employees/import` | GET, POST | admin, hr | — |
| `Staffy-Import` | ผลของ POST `/employees/import` | — | admin, hr | ตอบ **200** เป็นหน้ารายงาน (ไม่ redirect) |
| ออกจากระบบ | `/logout` | POST | ล็อกอินแล้ว | — |

`{id}` ต้องเป็นเลขจำนวนเต็ม; `/employees/new`, `/employees/import`, `/employees/export.csv` ต้องจับคู่ก่อน `{id}` รหัสตอบกลับมาตรฐาน: ยังไม่ล็อกอิน → 302 `/login`; ไม่มีสิทธิ์ → 403 (หน้าไทย); ไม่พบ → 404 (หน้าไทย); CSRF ผิด → 403; ฟอร์มไม่ผ่าน → 422 พร้อมค่าที่กรอก; Redirect ใช้ path สัมพัทธ์เสมอ ทุกหน้าที่ล็อกอินแล้วส่ง `Cache-Control: no-store`

---

## 2. Design tokens

```css
:root {
  /* พื้นผิว */
  --bg: #F5F6FA;            /* พื้นหลังหน้า */
  --surface: #FFFFFF;       /* การ์ด ตาราง ฟอร์ม */
  --surface-tint: #F0F2FB;  /* กลุ่มข้อมูลอ่อนไหว (เงินเดือน) */
  --surface-tint-border: #C9CDE8;

  /* ตัวอักษร */
  --ink: #1B2033;
  --muted: #4F566E;         /* คำอธิบาย, label รอง (ตัดกับ --bg ≥ 4.5:1) */
  --faint: #8A90A8;         /* เฉพาะ disabled เช่น "ก่อนหน้า" ที่ปิดอยู่ */

  /* เส้นขอบ */
  --border: #E1E4EF;        /* การ์ด */
  --border-input: #C5CADB;  /* input, ปุ่ม secondary */
  --border-row: #ECEEF6;    /* เส้นคั่นแถวตาราง/รายการ */
  --border-tab: #D5D9E8;
  --border-dashed: #9AA1C8; /* dropzone */
  --th-bg: #F0F2F9;         /* หัวตาราง */

  /* แบรนด์ */
  --nav: #232A5C;           /* sidebar */
  --nav-ink: #E4E6F6;
  --nav-ink-muted: #C9CDE8;
  --nav-line: #3A4278;
  --primary: #3B4BC4;
  --primary-ink: #FFFFFF;
  --primary-soft: #E0E4FA;  /* avatar/ชิป */
  --primary-soft-ink: #2B3699;

  /* semantic: ทุกชุดคือ bg / ink / border (ink บน bg ≥ 4.5:1) */
  --success-bg: #E6F4EA;  --success-ink: #14532D;  --success-border: #B5DFC2;
  --warn-bg:    #FFF4DB;  --warn-ink:    #6B4A00;  --warn-border:    #F0D58A;
  --danger-bg:  #FDECEA;  --danger-ink:  #8E1B12;  --danger-border:  #F3B8B2;
  --danger:     #B3261E;  /* ขอบ input ผิด, ข้อความ error, ปุ่มยืนยันลบ */
  --danger-outline: #E5A9A3; /* ขอบปุ่ม "ลบ" แบบ outline */
  --neutral-bg: #ECEEF6;  --neutral-ink: #4F566E;  /* badge "ลาออก", "ยกเลิก", "เหลืออีกนาน" */
  --badge-alert: #D0584E; /* ตัวเลขบน sidebar (ตัวอักษรขาว 12px/600 — ใช้ #B3261E ถ้าต้องการ contrast สูงกว่า) */
  --meter-on: #2E7D4F;    /* แถบความแข็งแรงรหัสผ่าน (ช่องที่เต็ม) */
  --stat-active: #232A5C; --stat-alert: #B3261E; --stat-warn: #8A5A00; --stat-ok: #14573A;
  --overlay: rgba(20, 24, 50, 0.55);

  /* avatar: คู่ bg/ink วนตามลำดับหรือ hash ของชื่อ */
  --av1-bg: #E0E4FA; --av1-ink: #2B3699;
  --av2-bg: #FDE3C8; --av2-ink: #7A3A07;
  --av3-bg: #DDEFE4; --av3-ink: #14573A;

  /* ตัวอักษร */
  --font-body: 'Noto Sans Thai', 'Sarabun', system-ui, 'Leelawadee UI', Tahoma, sans-serif;
  --font-head: 'Prompt', 'Noto Sans Thai', system-ui, sans-serif;
  --font-mono: ui-monospace, Menlo, Consolas, monospace;
  --fs-xs: 12px;   /* badge บน sidebar */
  --fs-sm: 14px;   /* label, คำอธิบาย, ปุ่มเล็ก, ตาราง */
  --fs-base: 16px; /* เนื้อหา, input, ปุ่มหลักในฟอร์ม */
  --fs-h3: 18px;   /* หัวข้อการ์ด/section (600) */
  --fs-h2: 22px;   /* หัวข้อ dialog (Prompt 600) */
  --fs-h1: 28px;   /* หัวข้อหน้า (Prompt 600); หน้า detail ใช้ 26px */
  --fs-stat: 40px; /* ตัวเลขใน stat card (Prompt 600, line-height 1.1) */
  --fs-display: 36px; /* หัวข้อบนแผงซ้ายหน้า login */
  --lh-body: 1.6;  /* ภาษาไทยต้องการ line-height สูงกว่าละติน */

  /* รัศมี */
  --r-sm: 10px;    /* ปุ่ม, input, ลิงก์เมนู */
  --r-md: 12px;    /* banner, input หน้า login/setup, ปุ่มหน้า login */
  --r-lg: 16px;    /* การ์ด, ตาราง, fieldset */
  --r-xl: 20px;    /* card หน้า setup, dialog */
  --r-pill: 12px;  /* badge */

  /* ระยะ (4px base) */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 20px;
  --sp-6: 24px; --sp-8: 32px; --sp-10: 40px; --sp-14: 56px;

  /* ขนาดโครง */
  --sidebar-w: 240px;
  --main-pad-y: 32px; --main-pad-x: 40px;
  --tap: 44px;     /* ขนาดคลิกขั้นต่ำ */
  --control-h: 48px; /* ความสูง input / ปุ่มหลักในฟอร์ม */
  --shadow-dialog: 0 20px 50px rgba(0, 0, 0, 0.3);
  --focus: 0 0 0 3px rgba(59, 75, 196, 0.45); /* ใช้กับ :focus-visible ทุก element */
}
```

ฟอนต์: **self-host** woff2 ของ Prompt (500, 600) และ Noto Sans Thai (400, 500, 600) ที่ `static/fonts/` ผ่าน `@font-face` (`font-display: swap`) ห้ามโหลดจาก Google Fonts (บอร์ดใช้ลิงก์ Google เฉพาะตอนออกแบบ) น้ำหนัก 500 ใช้กับลิงก์เมนูที่ไม่ active, 600 กับ active/หัวข้อ/ปุ่ม

---

## 3. App shell

โครงหน้า (ทุกหน้าที่ล็อกอินแล้ว ยกเว้น login/setup): `display:flex; min-height:100vh; background:var(--bg)`

```html
<body class="app">
  <a class="skip-link" href="#main">ข้ามไปเนื้อหา</a>
  <nav class="sidebar" aria-label="เมนูหลัก"> … </nav>
  <main id="main" class="main"> … </main>
</body>
```

**Sidebar** — กว้าง 240px, padding 24px 16px, พื้น `--nav`, ตัวอักษร `--nav-ink`, `flex-direction:column`
- โลโก้ข้อความ "Staffy" Prompt 24/600 ขาว margin `0 8px 24px`
- รายการเมนู (ลิงก์ สูงขั้นต่ำ 44px, padding `0 12px`, radius 10px, ห่างกัน 4px, 16px; ปกติ weight 500 สี `--nav-ink`; **หน้าปัจจุบัน** `aria-current="page"` พื้น `--primary` ตัวขาว weight 600) badge ตัวเลขชิดขวา 12px/600 ขาว บน `--badge-alert` radius 10 padding `2px 8px` แสดงเฉพาะเมื่อ > 0
- ท้าย sidebar (`margin-top:auto`, `padding:12px`, เส้นบน `--nav-line`): ชื่อผู้ใช้ 14/600, บทบาท 14 สี `--nav-ink-muted` (แสดง `Admin` / `HR` / `พนักงาน`), ลิงก์ "บัญชีของฉัน" (→ `/account`) และปุ่ม "ออกจากระบบ" (POST, 14px, สูง ≥44px, สี `--nav-ink`)

เมนู (เรียงตามนี้) และการมองเห็นตามบทบาท

| เมนู | ลิงก์ | admin | hr | employee |
|---|---|---|---|---|
| แดชบอร์ด | `/dashboard` | ✓ | ✓ | ✓ |
| พนักงาน | `/employees` | ✓ | ✓ | ✗ (ใส่ "ข้อมูลของฉัน" → `/employees/{own_id}` แทนถ้าบัญชีผูกพนักงาน) |
| การลา (badge = จำนวน pending; ของ employee = ใบลา pending ของตัวเอง) | `/leaves` | ✓ | ✓ | ✓ |
| บัญชีผู้ใช้ | `/admin/users` | ✓ | ✗ | ✗ |
| บันทึกการใช้งาน | `/admin/audit` | ✓ | ✗ | ✗ |
| สถานะระบบ | `/admin/status` | ✓ | ✗ | ✗ |
| แผนก | ส่วนที่ 2 | ตามส่วนที่ 2 | ตามส่วนที่ 2 | ✗ |
| ข้อมูลบริษัท | ส่วนที่ 2 | ตามส่วนที่ 2 | ✗ | ✗ |

เมนูที่ผู้ใช้เข้าไม่ได้ **ต้องไม่ render** (ไม่ใช่แค่ซ่อนด้วย CSS) และฝั่ง server ยังตรวจสิทธิ์ตามตาราง Spec เสมอ

**Main** — `flex:1; min-width:0; padding:32px 40px`
- ลำดับ: (ลิงก์ย้อนกลับถ้ามี) → page header → flash/error banner → เนื้อหา
- หน้าฟอร์ม/รายละเอียดจำกัดความกว้าง: Emp-Form `max-width:980px` (padding-bottom 120px เพื่อไม่ให้แถบปุ่ม sticky บังเนื้อหา), Emp-Detail `1040px`, Import-Upload/Import `960px`; หน้ารายการ/แดชบอร์ดเต็มความกว้าง
- **ลิงก์ย้อนกลับ**: `← กลับไปรายการพนักงาน` 14/600 สี `--primary` สูง ≥44px
- **Page header**: แถว `display:flex; justify-content:space-between; gap:16px; align-items:flex-start` ซ้าย = `<h1>` (Prompt 28/600) + คำอธิบายใต้ h1 (14px `--muted` margin-top 4px) ขวา = กลุ่ม action (gap 8px) ปุ่มหลักอยู่ขวาสุด หนึ่งหน้ามี primary action ได้หนึ่งปุ่ม

**Flash banner** อยู่ใต้ page header (margin-top 20px) ดูหัวข้อ 4.8 `#flash-ok` มาจาก `?msg=<code>` ที่อยู่ในรายการคงที่เท่านั้น (ห้ามพิมพ์ค่า query ลงหน้า)

**Responsive (ข้อแนะนำสำหรับการ implement — บอร์ดมีแต่ desktop 1280px)**
- ≥1024px: ตามบอร์ด
- <1024px: sidebar กลายเป็นแถบบน (โลโก้ + ปุ่ม "เมนู" `aria-expanded`/`aria-controls`) กดแล้วเปิดรายการเมนูแบบเต็มความกว้าง ใช้ `<button>` + JS สลับ attribute แค่ไม่กี่บรรทัด (ไม่มีก็ใช้ `<details>`) พื้นที่ main padding เหลือ `20px 16px`
- <720px: แถว flex หลายคอลัมน์ (stat card, fieldset 2–3 ช่อง, แผง dashboard) เรียงลงเป็นคอลัมน์เดียว; ตารางห่อด้วย `<div class="table-scroll" role="region" aria-label="…" tabindex="0">` ที่ `overflow-x:auto`; กลุ่มปุ่ม page header ตัดบรรทัดได้ (`flex-wrap:wrap`)
- ปุ่ม/ลิงก์ทั้งหมด ≥44×44px ทุก breakpoint

---

## 4. Shared components

กติกากลาง: ทุก interactive element มี `:focus-visible { outline:none; box-shadow:var(--focus) }`; ห้ามสื่อความหมายด้วยสีอย่างเดียว (badge มีข้อความ, error มีข้อความ); ปุ่มที่เป็นการกระทำ POST ต้องเป็น `<button>` ในฟอร์มที่มี `csrf`, ปุ่มนำทางเป็น `<a>`

### 4.1 ปุ่ม
```html
<a class="btn btn--primary" href="/employees/new">เพิ่มพนักงาน</a>
<button class="btn btn--secondary" type="submit">…</button>
<button class="btn btn--danger" type="submit">ยืนยันลาออก</button>
<button class="btn btn--danger-outline" type="submit">ลบ (admin)</button>
<button class="btn btn--text" type="button">เอาออก</button>
```
| รูปแบบ | พื้น | ตัวอักษร | ขอบ |
|---|---|---|---|
| primary | `--primary` | ขาว | — |
| secondary | `--surface` | `--ink` | 1.5px `--border-input` |
| danger | `--danger` | ขาว | — |
| danger-outline | `--surface` | `--danger-ink` | 1.5px `--danger-outline` |
| text | โปร่งใส | `--primary` หรือ `--danger-ink` | — |

ขนาด: ปุ่มในแถว header/ตาราง `min-height:44px; padding:0 16px; 14px/600; radius 10px`; ปุ่มหลักของฟอร์ม `min-height:48px; padding:0 24–28px; 16px/600`; ปุ่ม login/setup `height:52px; width:100%; radius 12px` สถานะ: hover เข้มขึ้นเล็กน้อย, `:disabled` พื้น `--neutral-bg` ตัว `--faint` `cursor:not-allowed` ห้ามปิดปุ่ม submit ก่อนผู้ใช้ลองส่ง (ให้ server ตรวจ)

### 4.2 ช่องฟอร์ม + error
```html
<div class="field">
  <label for="email">อีเมล</label>
  <input id="email" name="email" type="email" value="…"
         aria-invalid="true" aria-describedby="err-email">
  <p id="err-email" class="field-error" data-field="email">รูปแบบอีเมลไม่ถูกต้อง เช่น name@company.co.th</p>
</div>
```
- label อยู่บน input เสมอ 14/600 margin-bottom 6px; ส่วนเสริมต่อท้าย label เช่น `(ถ้ามี)` 400 สี `--muted`
- input สูง 48px, padding `0 14px`, ขอบ 1.5px `--border-input`, radius 10px, 16px; textarea padding `12px 14px` line-height 1.6 `resize:vertical`
- สถานะ error (หลัง 422): ขอบ 2px `--danger`, `aria-invalid="true"`, `<p class="field-error" data-field="<name>">` 14/500 `--danger` ใต้ input (margin-top 6px) ค่า `data-field` = ชื่อฟิลด์ใน `name` ต้อง render ค่าที่ผู้ใช้กรอกกลับลง input (ยกเว้นรหัสผ่านและไฟล์)
- ไม่ใช้ placeholder แทน label; `autocomplete` ตามชนิด (`username`, `current-password`, `new-password`)
- ฟิลด์วันที่ใช้ `type="date"` (ค่า `YYYY-MM-DD`), เบอร์โทร `type="tel"`, ตัวเลข `inputmode="numeric|decimal"`

### 4.3 Error summary (ฟอร์ม 422)
`#flash-error` เป็น `role="alert"` ที่ด้านบนฟอร์ม พื้น `--danger-bg` ขอบ 1px `--danger-border` ตัว `--danger-ink` radius 12px padding `14px 18px`
```html
<div id="flash-error" role="alert" class="banner banner--danger">
  <p class="banner__title">บันทึกไม่สำเร็จ แก้ 3 ช่องด้านล่างแล้วลองอีกครั้ง</p>
  <ul><li><a href="#national_id">เลขบัตรประชาชน</a></li> …</ul>
</div>
```
ลิงก์แต่ละข้อไปที่ `id` ของ input ที่ผิด จำนวนในประโยคมาจากจำนวน error จริง

### 4.4 Select / Checkbox
- `<select>` สไตล์เดียวกับ input (สูง 48px; ในแถบกรองสูง 44px)
- checkbox: `<label>` คลิกได้ทั้งแถวสูง ≥44px, กล่อง 22×22 `accent-color:var(--primary)` ข้อความ 16px

### 4.5 Badge สถานะ
`<span class="badge badge--success">ปฏิบัติงาน</span>` — inline-block, padding `2px 10px`, radius 12px, 14/600
| class | สี | ใช้กับ |
|---|---|---|
| success | `--success-bg/ink` | ปฏิบัติงาน (`active`), อนุมัติแล้ว |
| warn | `--warn-bg/ink` | รออนุมัติ, สัญญาเหลือ ≤14 วัน, ข้าม |
| danger | `--danger-bg/ink` | ปฏิเสธ, ข้อมูลไม่ถูกต้อง |
| neutral | `--neutral-bg/ink` | ลาออก (`resigned`), ยกเลิก, สัญญาเหลือ >14 วัน |
| primary | `--primary-soft` + `--primary-soft-ink` | ชิป/บทบาท (ส่วนที่ 2) |

### 4.6 ตารางข้อมูล
```html
<div class="table-scroll"> <!-- หรือห่อทั้งการ์ด -->
  <table id="employees-table" class="table">
    <caption class="sr-only">รายการพนักงาน</caption>
    <thead><tr><th scope="col">พนักงาน</th> …</tr></thead>
    <tbody><tr data-id="137"> … </tr></tbody>
  </table>
</div>
```
- ห่อการ์ด: พื้น `--surface`, ขอบ 1px `--border`, radius 16px, `overflow:hidden`
- `th`: พื้น `--th-bg`, 14/600 `--muted`, padding `12px 16px`, `text-align:left` (ตัวเลข/จำนวนชิดขวา); `td`: padding `10px 16px`, 14px (ชื่อ 16/600), เส้นบน 1px `--border-row`
- คอลัมน์ที่เรียงได้ = `<a>` ใน `th` พร้อมลูกศร ↑/↓ และ `aria-sort="ascending|descending"` บน `th`
- ปุ่ม/ลิงก์การกระทำท้ายแถวสูง ≥44px และมี `aria-label` ระบุชื่อแถว (`aria-label="ดูข้อมูล สุนิสา วงศ์ใหญ่"`)
- ไม่มี header sticky ไม่มี zebra stripe; ข้อความยาวตัดบรรทัดได้ (`overflow-wrap:anywhere`) ไม่ใช้ `white-space:nowrap` กับชื่อ
- **Empty state** ในตาราง: แถวเดียว `<td colspan>` ข้อความกลาง `ไม่พบพนักงานที่ตรงกับเงื่อนไข` + ลิงก์ "ล้างตัวกรอง" (→ `/employees`)

### 4.7 แบ่งหน้า `#pagination`
```html
<nav id="pagination" aria-label="แบ่งหน้า" data-page="1" data-pages="7" data-total="137">
  <p>แสดง 1–20 จาก 137 คน</p>
  <ul>
    <li><a aria-disabled="true">ก่อนหน้า</a></li>
    <li><a aria-current="page" href="?page=1&…">1</a></li> …
    <li><a href="?page=2&…">ถัดไป</a></li>
  </ul>
</nav>
```
- ซ้าย: ข้อความช่วงที่แสดง 14px `--muted`; ขวา: ปุ่มเลขหน้า 44×44 radius 10 (หน้าปัจจุบันพื้น `--nav` ตัวขาว 600) "ก่อนหน้า/ถัดไป" padding `0 14px` (ถัดไปสี `--primary` 600; ปิดอยู่ใช้ `--faint`)
- ลิงก์ทุกอันต้องคง query เดิม (`q`, `dept`, `status`, `sort`, `dir`, `per_page`) เปลี่ยนแค่ `page`; ถ้ามีหลายหน้าให้ย่อเลขด้วย `…`
- `data-page`, `data-pages`, `data-total` ต้องมีเสมอ (สคริปต์ทดสอบอ่าน)

### 4.8 Banner / Flash
`.banner` radius 12px, padding `12px 16px`, 14/500, `role="status"` (สำเร็จ) หรือ `role="alert"` (ผิดพลาด)
| ชนิด | id | สี | ตัวอย่างข้อความ |
|---|---|---|---|
| สำเร็จ | `#flash-ok` | success | `บันทึกข้อมูลสุนิสา วงศ์ใหญ่ เรียบร้อยแล้ว` |
| ผิดพลาดระดับหน้า | `#flash-error` | danger | ดู 4.3 |
| คำเตือน | — | warn | ข้อความอธิบายข้อจำกัด |
ตาราง `msg` code → ข้อความไทย อยู่ฝั่ง server (ตัวอย่าง: `created`, `updated`, `deleted`, `resigned`, `setup_done`) ไม่รู้จัก code → ไม่แสดง banner

### 4.9 Confirm dialog (ลาออก / ลบ)
```html
<div class="overlay">
  <form method="post" action="/employees/137/resign" role="dialog" aria-modal="true"
        aria-labelledby="resign-title" class="dialog">
    <input type="hidden" name="csrf" value="…">
    <h2 id="resign-title">บันทึกการลาออกของสุนิสา?</h2>
    <p>สถานะจะเปลี่ยนเป็น "ลาออก" ข้อมูลทั้งหมดยังอยู่</p>
    <div class="dialog__actions">
      <button type="button" class="btn btn--secondary">ยกเลิก</button>
      <button type="submit" class="btn btn--danger">ยืนยันลาออก</button>
    </div>
  </form>
</div>
```
- overlay `position:fixed; inset:0; background:var(--overlay)` จัดกลาง; dialog กว้าง ≤460px padding 28px radius 20px `--shadow-dialog` หัวข้อ Prompt 22/600, เนื้อหา 16px `--muted` line-height 1.6, ปุ่มชิดขวา gap 12 สูง 48
- ต้องทำงานโดยไม่มี JS ไม่ได้ก็ใช้ `<dialog>` พร้อม JS เล็กน้อย: เปิด → โฟกัสไปปุ่มยกเลิก/ฟิลด์แรก, `Esc` ปิด, โฟกัสวนอยู่ใน dialog, ปิดแล้วคืนโฟกัสไปปุ่มที่เปิด ปุ่มยืนยันที่ทำลายข้อมูล (ลบ) ใช้ `btn--danger` และข้อความระบุสิ่งที่จะหาย (`ลบ <ชื่อ> ถาวร ใบลาและการแจ้งเตือนของพนักงานจะถูกลบด้วย`)
- Fallback ไม่มี JS: ปุ่ม "ลาออก"/"ลบ" ลิงก์ไปหน้า confirm แยก หรือ `<details>` ที่มีฟอร์มยืนยัน (เลือกอย่างใดอย่างหนึ่งให้เหมือนกันทุก stack)

### 4.10 Stat card (dashboard)
ลิงก์ทั้งใบ: `<a class="stat" href="…">` padding 20px, พื้น `--surface`, ขอบ `--border`, radius 16px
- label 14/600 `--muted`; ตัวเลข Prompt 40/600 line-height 1.1 สีตามความหมาย (`--stat-*`) margin-top 8px; hint 14px `--muted` margin-top 6px
- เรียงใน flex เท่ากัน gap 16px

### 4.11 Empty state (รายการ/แผง)
กลางการ์ด padding 40px: ข้อความหลัก 16/600, ข้อความรอง 14 `--muted`, ปุ่ม/ลิงก์ที่ทำต่อได้ (เช่น "เพิ่มพนักงานคนแรก", "นำเข้า CSV") ใช้เมื่อ `total = 0` จริง ต่างจากกรณีกรองแล้วไม่เจอ (4.6)

### 4.12 Avatar อักษรย่อ
วงกลม (`border-radius:50%`) `aria-hidden="true"` ขนาด 36px (ตาราง), 40px (รายการ dashboard), 72px (หัวหน้า detail, ตัวอักษร Prompt 28/600) แสดงอักษรแรกของชื่อ สีเลือกจาก `--av1/2/3` ด้วย `employee_id % 3` ให้คนเดิมได้สีเดิมเสมอ (ข้อมูลชื่ออยู่ในข้อความข้างๆ แล้ว avatar จึงเป็นตกแต่ง)

---

## 5. หน้าจอทีละหน้า

### 5.1 `Staffy-Login` — `/login`
- **เป้าหมาย**: เข้าสู่ระบบด้วย username/password
- **เลย์เอาต์**: ไม่มี sidebar สองคอลัมน์เท่ากัน min-height 720px
  - ซ้าย: พื้น `--nav` padding 56px ตัวอักษรอ่อน — "Staffy" Prompt 28/600; หัวข้อ `ข้อมูลพนักงานทั้งหมด อยู่ที่เดียว` Prompt 36/600 line-height 1.35 กว้าง ≤420px; คำอธิบาย `ดูรายชื่อ อนุมัติลา ออกบัตรพนักงาน และนำเข้าข้อมูลจากไฟล์ CSV ได้ในไม่กี่คลิก` 16px สี `--nav-ink-muted`; ท้าย `ระบบภายในสำหรับ HR และผู้ดูแล` 14px
  - ขวา: ฟอร์มกึ่งกลางกว้าง ≤380px: `<h1>` `เข้าสู่ระบบ` Prompt 28/600; `ใช้ชื่อผู้ใช้และรหัสผ่านที่ HR ให้ไว้` 16px `--muted`
- **ฟิลด์**: `username` (`autocomplete=username`, label `ชื่อผู้ใช้`), `password` (`current-password`, label `รหัสผ่าน`), hidden `csrf` (ค่า = cookie `sf_lt` ที่ server ตั้งตอน GET `/login`), ปุ่ม `เข้าสู่ระบบ` (กว้างเต็ม สูง 52 radius 12), ข้อความท้าย `ลืมรหัสผ่าน? ติดต่อผู้ดูแลระบบให้ตั้งรหัสใหม่ให้`
- **Error**: `<div id="login-error" data-reason="invalid|locked" role="alert">` พื้น danger ไอคอนวงกลมอัศเจรีย์ 20px
  - `invalid` (ผู้ใช้ไม่พบ/ปิดบัญชี/รหัสผิด — **ข้อความต้องเหมือนกันทุกกรณี**): `ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง ลองใหม่อีกครั้ง`
  - `locked` (ผิดครบ 5 ครั้ง ครั้งที่ 6 ได้ locked): ข้อความเสนอ — `บัญชีถูกล็อกชั่วคราวเพราะลองผิดหลายครั้ง กรุณาลองใหม่ภายหลัง` (ห้ามบอกว่า username นั้นมีอยู่จริงหรือไม่ และไม่ต้องแสดงเวลานับถอยหลัง)
  - ตอบ HTTP 401; คงค่า `username` ที่กรอกไว้ **ห้ามเติมรหัสผ่านกลับ**; โฟกัสไปที่ error (หรือช่อง username)
- **ค่าในบอร์ด** (`hr.somying`, `password`) เป็นตัวอย่างสถานะ error เท่านั้น
- ล็อกอินสำเร็จ → 302 `/dashboard`; `msg=setup_done` หลัง setup แสดง banner success `สร้างผู้ดูแลระบบแล้ว เข้าสู่ระบบได้เลย`

### 5.2 `Staffy-Setup` — `/setup`
- **เป้าหมาย**: สร้าง admin คนแรก ใช้ได้ครั้งเดียว (ตาราง users ว่าง) หลังนั้น 404
- **เลย์เอาต์**: การ์ดกลางหน้า กว้าง ≤480px padding 40px radius 20px ขอบ `--border` พื้นหน้า `--bg` ไม่มี sidebar
- **เนื้อหา**: "Staffy" Prompt 20/600 สี `--primary`; `<h1>` `ตั้งค่าครั้งแรก` Prompt 28/600; `สร้างบัญชีผู้ดูแลระบบคนแรก หน้านี้จะใช้ได้แค่ครั้งเดียว หลังจากนั้นจะเข้าสู่ระบบตามปกติ` 16px `--muted`
- **ฟิลด์** (ตาม Spec เท่านั้น): `username` (label `ชื่อผู้ใช้`; 3–30 ตัว a-z 0-9 `_ . -`), `password` (`ความยาวอย่างน้อย 10 ตัวอักษร ไม่เกิน 72 ไบต์ และต้องไม่เหมือนชื่อผู้ใช้` ผูกด้วย `aria-describedby`), `confirm_password` (`ยืนยันรหัสผ่าน`), hidden `csrf`
- **ตัวช่วย (ไม่บังคับ)**: แถบความแข็งแรง 4 ช่อง สูง 6px gap 6 (ช่องเต็ม `--meter-on`, ช่องว่าง `--border`) `aria-hidden="true"` พร้อมข้อความ `ความแข็งแรง: ดี` ใต้แถบ (JS ฟากเดียว ไม่แทนการตรวจฝั่ง server)
- **ปุ่ม**: `สร้างผู้ดูแลระบบ` เต็มกว้าง สูง 52
- **422**: แสดง `.field-error[data-field=username|password|confirm_password]` และ `#flash-error` ถ้ามีมากกว่าหนึ่งช่อง รหัสผ่านไม่ถูกเติมกลับ
- **สำเร็จ**: 302 `/login?msg=setup_done`; มีผู้ใช้แล้ว → 404 (หน้า 404 มาตรฐาน)

### 5.3 `Staffy-Dashboard` — `/dashboard`
- **เป้าหมาย**: ภาพรวมและทางลัดไปสิ่งที่ต้องทำ
- **เลย์เอาต์**: page header → แถบ stat 4 ใบ → สองคอลัมน์ (ซ้าย flex 3: ใบลารออนุมัติ, ขวา flex 2: สัญญาใกล้หมด + วันเกิด)
- **Page header**: `<h1>` `แดชบอร์ด`; วันที่วันนี้แบบไทยเต็ม (`วันอังคารที่ 20 ตุลาคม 2569`); ปุ่ม secondary `นำเข้า CSV` และ primary `เพิ่มพนักงาน` (**เฉพาะ admin/hr**)
- **`<main id="dashboard" data-active data-pending-leaves data-expiring data-birthdays>`** ใส่ data-* ที่ element นี้ (employee มีแค่ `data-pending-leaves`)
- **Stat card 4 ใบ** (ลำดับ/สี/ลิงก์):
  1. `ปฏิบัติงานอยู่` = จำนวน `status=active` (`--stat-active`), hint `จากทั้งหมด N คน` → `/employees?status=active`
  2. `ใบลารออนุมัติ` = pending ทั้งหมด (`--stat-alert`), hint `ต้องดำเนินการ` → `/leaves?status=pending`
  3. `สัญญาใกล้หมดใน 30 วัน` = active ที่ `contract_end` ภายใน 30 วัน (`--stat-warn`), hint `ควรต่อหรือแจ้งผล` → `/employees`
  4. `วันเกิดเดือนนี้` = active ที่เกิดเดือนปัจจุบัน (`--stat-ok`), hint `เดือน<ชื่อเดือน>` → `/employees`
- **แผง `ใบลารออนุมัติ`**: การ์ด; หัวข้อ 18/600 + ลิงก์ `ดูทั้งหมด` (→ `/leaves`); แต่ละแถว: avatar 40, ชื่อ 16/600, `<ประเภท> · <ช่วงวัน> (<n> วัน)` 14px `--muted`, ปุ่ม `ปฏิเสธ` (secondary ตัว `--danger-ink`) และ `อนุมัติ` (primary) เป็นฟอร์ม POST `/leaves/{id}/reject|approve` + `csrf` ของใบลาตัวเองให้ซ่อนปุ่มทั้งสอง (Spec: อนุมัติของตัวเอง → 403) ประเภท: annual=`ลาพักร้อน`, sick=`ลาป่วย`, personal=`ลากิจ` แสดงสูงสุด 4–5 แถว
- **แผง `สัญญาใกล้หมดใน 30 วัน`**: ชื่อ 16/600; `<แผนก> · หมดสัญญา <วันที่>` 14px; badge `อีก N วัน` (warn เมื่อ ≤14 วัน, neutral เมื่อมากกว่า)
- **แผง `วันเกิดเดือนนี้`**: ชื่อ + วันที่ `24 ต.ค.`
- **ตามบทบาท**: admin/hr เห็นทั้งหมด; employee เห็นเฉพาะ stat `ใบลารออนุมัติ` ของตัวเอง + รายการใบลาของตัวเอง (ไม่มีปุ่มอนุมัติ ไม่มีแผงสัญญา/วันเกิด/นำเข้า)
- **Empty**: แต่ละแผงเมื่อไม่มีข้อมูล แสดงข้อความ 14px `--muted` เช่น `ไม่มีใบลารออนุมัติ`
- แผงทั้งสามเป็นส่วนเสริมนอก Spec (Spec ระบุแค่ตัวเลข) ใช้ query จาก `leave_requests` / `employees` ตรงๆ จำกัดจำนวนแถวเสมอ

### 5.4 `Staffy-Employees` — `/employees` (admin, hr)
- **Page header**: `<h1>` `พนักงาน`; คำอธิบาย `ทั้งหมด N คน · ปฏิบัติงานอยู่ M คน`; actions: secondary `นำเข้า CSV` (→ `/employees/import`), secondary `ส่งออก CSV` (→ `/employees/export.csv` **พก query ตัวกรองปัจจุบัน** `q, dept, status, sort, dir`, ไม่ส่ง `page/per_page`), primary `เพิ่มพนักงาน` (→ `/employees/new`)
- **`#flash-ok`** จาก `?msg=` (เช่น `บันทึกข้อมูลสุนิสา วงศ์ใหญ่ เรียบร้อยแล้ว`)
- **แถบกรอง** = `<form method="get">` (GET เท่านั้น ลิงก์แชร์/บุ๊กมาร์กได้) แถว flex gap 12px align-end:
  - `ค้นหา` `name="q"` `type="search"` flex 1 placeholder `ชื่อ รหัสพนักงาน หรืออีเมล` (Spec: ตรง `employee_code`, `first_name`, `last_name`, `nickname`, `email` แบบ `LIKE %q%`)
  - `แผนก` `name="dept"` กว้าง 200px ตัวเลือกแรก `ทุกแผนก` (ค่าว่าง) ค่า option = id แผนก
  - `สถานะ` `name="status"` กว้าง 160px ตัวเลือก `ทั้งหมด` (ว่าง), `ปฏิบัติงาน` (`active`), `ลาออก` (`resigned`) (ลำดับในบอร์ดเรียงไม่ตรง — ใช้ลำดับนี้, ค่าเริ่มต้น = ทั้งหมด)
  - ปุ่ม `ค้นหา` สูง 44 พื้น `--nav` ตัวขาว (ไม่มี JS ก็ใช้งานได้)
  - **ส่วนเสริมที่ Spec รองรับแต่บอร์ดไม่ได้วาด** (ให้ทำ): `per_page` ตัวเลือก 20/50/100 (ค่าเริ่มต้น 20) ใต้ตารางหรือในแถบกรอง; หัวคอลัมน์ `พนักงาน`(`sort=name`), `แผนก`(`sort=department`), `วันเริ่มงาน`(`sort=hire_date`) กดสลับ `dir=asc|desc` ค่าเริ่มต้น `name asc` ค่าพารามิเตอร์ไม่ถูกต้อง → ใช้ค่าเริ่มต้น ไม่ error
- **ตาราง `#employees-table`** คอลัมน์: `พนักงาน` (avatar 36 + ชื่อ-นามสกุล 16/600 + อีเมล 14 `--muted`), `รหัส`, `แผนก`, `ตำแหน่ง` (`job_title`), `วันเริ่มงาน` (คอลัมน์เรียงปัจจุบันมีลูกศร), `สถานะ` (badge), ท้ายแถว `ดู` (→ `/employees/{id}`) แต่ละ `<tr data-id>` **ไม่แสดงเงินเดือนในรายการเด็ดขาด**
- **`#pagination`** ใต้ตาราง (หัวข้อ 4.7) ข้อความ `แสดง 1–20 จาก 137 คน`
- **สถานะ**: ไม่พบ → empty ในตาราง (4.6); ไม่มีพนักงานเลย → empty state (4.11)
- **RBAC**: employee → 403

### 5.5 `Staffy-Emp-Form` — `/employees/new` และ `/employees/{id}/edit` (admin, hr)
- **เป้าหมาย**: เพิ่ม/แก้ข้อมูลพนักงาน หน้าเดียวใช้ทั้งสองโหมด
- **Header**: ลิงก์ `← กลับไปรายการพนักงาน`; `<h1>` `เพิ่มพนักงานใหม่` (โหมดแก้: `แก้ไขข้อมูลพนักงาน` + ชื่อ) จำกัดกว้าง 980px
- **ฟอร์ม**: `<form id="employee-form" method="post" action="/employees">` (แก้: `/employees/{id}`) + hidden `csrf`; ปุ่ม submit POST ตามด้วย 302 ไป `/employees/{id}?msg=created|updated`
- **กลุ่มข้อมูล** (4 `<fieldset>` พื้นขาว ขอบ `--border` radius 16 padding 24, `<legend>` 18/600 แต่ละแถว flex gap 16 wrap ช่องละ min 200px):
  1. `ข้อมูลส่วนตัว`: `first_name` (`ชื่อ`, 1–60), `last_name` (`นามสกุล`, 1–60), `nickname` (`ชื่อเล่น (ถ้ามี)`, ≤30), `birth_date` (`วันเกิด (ถ้ามี)`, type date, อายุ 15–80 ปี)
  2. `การจ้างงาน`: `employee_code` (`รหัสพนักงาน`, `^[A-Z][0-9]{4,9}$`, ไม่ซ้ำ), `department_id` (`แผนก`, select จากตาราง departments), `job_title` (`ตำแหน่ง`, 1–80), `hire_date` (`วันเริ่มงาน`, 1970-01-01 ถึง วันนี้+365 วัน), `contract_end` (`วันสิ้นสุดสัญญา (ถ้ามี)`, ไม่ก่อน `hire_date`)
  3. `ติดต่อ`: `email` (`อีเมล`, ≤120, ไม่ซ้ำ, เก็บเป็นตัวพิมพ์เล็ก), `phone` (`เบอร์โทร`, ≤20, ตัวเลข `+ -` และช่องว่าง)
  4. `เงินเดือน (เห็นเฉพาะ HR และผู้ดูแล)` พื้น `--surface-tint` ขอบ `--surface-tint-border`: `salary` (`เงินเดือน (บาท)`, >0, ≤9,999,999.99, ทศนิยม ≤2) ช่องกว้าง ≤320px ตัวอักษรเป็น text `inputmode=decimal` (ยอมรับ `28,000` แล้ว normalize ฝั่ง server ถ้าตัดสินใจให้รับ ไม่เช่นนั้นให้แจ้ง error ตามกติกา)
  - (ตัด `national_id` และ `address` — หัวข้อ 0 ข้อ 2)
- **แถบปุ่มล่าง** `position:sticky; bottom:0` พื้น `--bg` padding `16px 0`: primary `บันทึก` (สูง 48, padding 0 28) + secondary `ยกเลิก` (→ `/employees` หรือหน้ารายละเอียดตอนแก้)
- **422**: ฟอร์มเดิม + ค่าที่กรอกกลับ + `#flash-error` (4.3) + `.field-error[data-field=<name>]` ใต้ทุกช่องที่ผิด; โฟกัสไปที่ `#flash-error`; ข้อความตัวอย่างจากบอร์ด:
  - `employee_code`: ข้อความเสนอ `รหัสพนักงานต้องขึ้นต้นด้วยตัวอักษร A-Z แล้วตามด้วยตัวเลข 4–9 หลัก เช่น E0138` / ซ้ำ: `มีรหัสนี้อยู่แล้ว`
  - `email`: `รูปแบบอีเมลไม่ถูกต้อง เช่น name@company.co.th` / ซ้ำ: `มีอีเมลนี้อยู่แล้ว`
  - `hire_date`: `วันเริ่มงานต้องไม่เกินวันนี้ไป 365 วัน`
  - ข้อความที่ Spec ไม่ได้ระบุ ให้เขียนสั้น บอกวิธีแก้ ไม่ใช้ศัพท์เทคนิค
- **RBAC**: เฉพาะ admin/hr; ช่องเงินเดือนไม่ควรเห็นสำหรับบทบาทอื่น (ซึ่งเข้าฟอร์มนี้ไม่ได้อยู่แล้ว)

### 5.6 `Staffy-Emp-Detail` — `/employees/{id}` (admin, hr, เจ้าของ)
- **ลิงก์ย้อนกลับ** `← กลับไปรายการพนักงาน` (employee เจ้าของข้อมูลไม่เห็นลิงก์นี้ → ย้อนไปแดชบอร์ด)
- **หัวการ์ด** (padding 24, flex, gap 20): avatar 72px; `<h1>` ชื่อ-นามสกุล Prompt 26/600 + badge สถานะ (`ปฏิบัติงาน` success / `ลาออก` neutral); บรรทัดรอง 14px `<รหัส> · <ตำแหน่ง> · แผนก<ชื่อแผนก>`; (ถ้ามีชื่อเล่นแสดงต่อท้ายชื่อในวงเล็บ)
- **ปุ่มขวา** (flex-wrap, gap 8): primary `แก้ไข` (→ `/employees/{id}/edit`, admin/hr), secondary `พิมพ์บัตร PDF` (→ `/employees/{id}/card.pdf`, เปิดแท็บใหม่ `target="_blank" rel="noopener"`; admin/hr/เจ้าของ), secondary `ลาออก` (เปิด dialog 4.9, admin/hr, เฉพาะ `active`), danger-outline `ลบ` (**admin เท่านั้น**; ป้ายในบอร์ด `ลบ (admin)` เป็นหมายเหตุออกแบบ ให้แสดงเพียง `ลบ`) กดแล้วเปิด dialog ยืนยัน → POST `/employees/{id}/delete` → 302 `/employees?msg=deleted`
- **แท็บ** `role="tablist"` (`ข้อมูลทั่วไป`, `การจ้างงาน`, `ประวัติการลา`) ในบอร์ดเป็นลิงก์ anchor (`#general`…) ให้ implement แบบ **ไม่ใช้ JS**: แท็บคือ in-page link ที่เลื่อนไปยังแต่ละการ์ดซึ่งแสดงอยู่ทั้งหมด (จึง **ไม่ใส่** `role="tablist/tab"` ถ้าไม่ได้ซ่อน panel จริง ใช้ `<nav aria-label="หมวดข้อมูล">` + ลิงก์ธรรมดา) แท็บปัจจุบัน: 600 สี `--primary` ขีดล่าง 3px
- **การ์ด** (flex 2 คอลัมน์ gap 16):
  - ข้อมูลทั่วไป `<dl>` grid `140px 1fr` row-gap 14: `ชื่อ-นามสกุล`, `ชื่อเล่น` (ถ้ามี), `วันเกิด`, `อีเมล`, `เบอร์โทร` (ตัด `เลขบัตร ปชช.` และ `ที่อยู่` ตามหัวข้อ 0)
  - การจ้างงาน: `รหัส`, `แผนก`, `ตำแหน่ง`, `วันเริ่มงาน`, `สิ้นสุดสัญญา`, `เงินเดือน` (`28,000 บาท` — **แสดงเฉพาะ admin/hr/เจ้าของ**; บทบาทอื่นไม่ render แถวนี้เลย) และ `สร้างเมื่อ` / `แก้ไขล่าสุด` ในรูป `YYYY-MM-DD HH:MM` ตาม `APP_TZ` (Spec บังคับ)
  - ประวัติการลา: ตาราง `ประเภท | ช่วงวัน | สถานะ` badge `รออนุมัติ` warn / `อนุมัติแล้ว` success / `ปฏิเสธ` danger / (`ยกเลิก` neutral) ไม่มีข้อมูล → `ยังไม่มีประวัติการลา`
- **Dialog ลาออก** ตาม 4.9: หัวข้อ `บันทึกการลาออกของ<ชื่อเล่นหรือชื่อ>?` เนื้อหา `สถานะจะเปลี่ยนเป็น "ลาออก" ข้อมูลทั้งหมดยังอยู่` ปุ่ม `ยกเลิก` / `ยืนยันลาออก` (ไม่มีช่องวันที่)
- **PDF บัตร**: ลิงก์ชี้ไป route ที่ส่ง `application/pdf` inline; หน้านี้ไม่สร้าง PDF เอง (ดู 6)
- **RBAC เจ้าของ**: employee เปิดได้เฉพาะ id ของตัวเอง ที่เหลือ 403; เห็นเฉพาะปุ่ม `พิมพ์บัตร PDF`

### 5.7 `Staffy-Import-Upload` — `/employees/import` (GET) (admin, hr)
- **Header**: ลิงก์กลับ; `<h1>` `นำเข้าพนักงานจาก CSV`; `เพิ่มพนักงานหลายคนพร้อมกัน ระบบจะตรวจทีละแถวและสรุปผลให้ดู`
- **ฟอร์ม** `method="post" action="/employees/import" enctype="multipart/form-data"` + `csrf`; สองคอลัมน์ (ซ้าย flex 3 ฟอร์ม, ขวา flex 2 กติกา)
- **Dropzone** (ซ้าย): กล่องเส้นประ 2px `--border-dashed` radius 16 padding `40px 24px` กลาง พื้นขาว ไอคอนอัปโหลด 36px `--primary`; `ลากไฟล์มาวางที่นี่` 16/600; `รองรับ .csv แบบ UTF-8 ขนาดไม่เกิน 5 MB` 14px `--muted`; ปุ่ม primary `เลือกไฟล์` = `<label for="csvfile">` ของ `<input id="csvfile" name="file" type="file" accept=".csv,text/csv">` (ซ่อนด้วยเทคนิคที่ keyboard โฟกัสได้ ไม่ใช้ `display:none`; ให้ label แสดง focus ring เมื่อ input ได้โฟกัส)
- **แถวไฟล์ที่เลือก**: ชื่อไฟล์ 16/600 + `N แถว · X KB` (ต้องใช้ JS นับ — ถ้าไม่มี JS ให้แสดงเฉพาะชื่อไฟล์/ขนาดหรือไม่แสดงแถวนี้) ปุ่ม text `เอาออก` สี `--danger-ink` ส่วนนี้เป็นการปรับปรุงด้วย JS (progressive enhancement) ฟอร์มต้องส่งได้ถ้า JS ไม่ทำงาน
- **ปุ่ม**: primary `ตรวจและนำเข้า` (สูง 48) + secondary `ยกเลิก` (→ `/employees`) **ไม่มี** checkbox dry-run และลิงก์ template (หัวข้อ 0 ข้อ 8)
- **ข้อผิดพลาดก่อนประมวลผล** (แสดงหน้านี้ซ้ำ + `.field-error[data-field=file]` / `#flash-error`): ไฟล์ >5 MB → 413 (หน้า error ภาษาไทย: `ไฟล์ใหญ่เกิน 5 MB`); ไม่ใช่ UTF-8 → 422 `ไฟล์ต้องเป็น CSV แบบ UTF-8`; หัวตารางไม่ตรง 13 คอลัมน์ → 422 `หัวตารางไม่ตรงกับที่ระบบรู้จัก` (ลิสต์คอลัมน์ที่ขาด/เกิน); เกิน 5,000 แถว → 422 `มีข้อมูลเกิน 5,000 แถว`
- **การ์ดขวา `กติกาของไฟล์`** (16/600, รายการ 14px line-height 1.8): `บรรทัดแรกเป็นหัวตาราง` · `รหัสพนักงานห้ามซ้ำกับที่มีอยู่ (แถวซ้ำจะถูกข้าม)` · `วันที่ใช้รูปแบบ ปปปป-ดด-วว (ค.ศ.)` · `แถวที่ผิดจะไม่ทำให้แถวอื่นล้มเหลว` · `จำกัดไม่เกิน 5,000 แถวต่อครั้ง`
- **การ์ดขวา `คอลัมน์ที่ระบบรู้จัก`**: `หัวตารางต้องตรงตามนี้ (ภาษาอังกฤษ)` ตาราง 13 แถว (ชื่อ `--font-mono` สี `--nav` | คำอธิบายไทย | `จำเป็น` สี `--danger-ink` / `ไม่บังคับ` สี `--muted`): `employee_code`, `first_name`, `last_name`, `nickname`, `email`, `phone`, `department`, `job_title`, `hire_date`, `birth_date`, `contract_end`, `salary`, `status` (ลำดับสลับได้) ความจำเป็นของแต่ละคอลัมน์ให้ยึดกติกาตรวจฟอร์ม (หัวข้อ 4 ของ Spec): จำเป็น = `employee_code, first_name, last_name, department, job_title, hire_date, email`; ที่เหลือไม่บังคับ (`status` ว่าง = active) `department` คือ **ชื่อ** แผนกที่ต้องมีอยู่แล้ว (บอร์ดตกคอลัมน์ `job_title` และใช้ `position` ผิดชื่อ)

### 5.8 `Staffy-Import` — ผลของ POST `/employees/import` (200, ไม่ redirect)
- **Header**: ลิงก์ `← กลับไปรายการพนักงาน`; `<h1>` `ผลการนำเข้า CSV`; ชื่อไฟล์ · `N แถว`; ใหม่: `ใช้เวลา <n> มิลลิวินาที` 14px `--muted` (จาก `data-duration-ms`)
- **`<section id="import-summary" data-imported data-skipped data-duration-ms>`**: 3 การ์ดเท่ากัน (padding 20, radius 16, ตัวเลข Prompt 36/600, label 14/600):
  - `เพิ่มสำเร็จ` (success) = `data-imported`
  - `ข้าม (รหัสซ้ำ)` (warn) = จำนวนเหตุผล `duplicate`
  - `ข้อมูลไม่ถูกต้อง` (danger) = `invalid_field:*` + `unknown_department`
  - `data-skipped` = ผลรวมของสองการ์ดหลัง
- **ตาราง `แถวที่ต้องแก้`**: คอลัมน์ `แถวที่` (เลขบรรทัดในไฟล์), `รหัสพนักงาน` (ถ้ามี, `--font-mono`), `ปัญหา` (ข้อความไทย), `สถานะ` (badge `ข้าม` warn / `ต้องแก้` danger) แสดงสูงสุด **100 แถวแรก** ถ้าเกินมีข้อความ `แสดง 100 แถวแรกจากทั้งหมด N แถวที่ถูกข้าม`
- **แปลงรหัสเหตุผลเป็นข้อความ** (ฝั่ง server เก็บเป็นรหัสตาม Spec): `duplicate` → `รหัสพนักงานซ้ำกับที่มีอยู่หรือซ้ำในไฟล์`; `unknown_department` → `ไม่พบแผนกนี้ในระบบ`; `invalid_field:email` → `อีเมลไม่ถูกต้อง`; `invalid_field:hire_date` → `วันเริ่มงานไม่ถูกต้อง รูปแบบ ปปปป-ดด-วว` ฯลฯ (ชื่อฟิลด์ไทยเดียวกับ label ในฟอร์ม) ฟิลด์ที่ไม่มีคำแปลให้ใช้ `ข้อมูล <ชื่อฟิลด์> ไม่ถูกต้อง`
- **ปุ่ม**: primary `ดูรายการพนักงาน` (→ `/employees`) + secondary `นำเข้าไฟล์อื่น` (→ `/employees/import`) (ตัด `ดาวน์โหลดแถวที่มีปัญหา`)
- **ไม่มีแถวผิดเลย**: แสดงข้อความ success `นำเข้าครบทุกแถว` แทนตาราง; **ผิดทุกแถว**: ยังเป็น 200 ตามเดิม; ผ่านด่านไฟล์แต่ DB ล้มเหลว → rollback ทั้งหมดและหน้า 500 ภาษาไทย (ไม่ใช่หน้ารายงาน)
- ผล import ไม่ควร refresh แล้วส่งซ้ำได้ง่าย: อย่าเก็บไฟล์; ใส่ข้อความ `รีเฟรชหน้านี้จะส่งไฟล์ซ้ำ` ไม่จำเป็น (ทางเลือก: ปุ่ม "นำเข้าไฟล์อื่น" ให้ทางออกที่ชัดแทน)

---

## 6. Flow สำคัญ

1. **ล็อกอิน / ถูกล็อก**: GET `/login` ตั้ง cookie `sf_lt` → POST (`csrf` = `sf_lt`) → ผิด 401 `invalid` (ข้อความเดียวกัน ทั้งไม่พบผู้ใช้และรหัสผิด) → ผิดครบ 5 ครั้ง ครั้งที่ 6 ตอบ 401 `locked` โดยไม่ตรวจรหัสผ่าน → ถูกต้อง สร้าง session ใหม่ 302 `/dashboard` UI ต้องไม่บอกว่า username มีอยู่หรือไม่ ไม่ปิดการกรอกระหว่างล็อก (server เป็นผู้ตัดสิน)
2. **Setup ครั้งแรก**: DB ว่าง → `/` ไป `/login`; เปิด `/setup` กรอกฟอร์ม → 302 `/login?msg=setup_done` → ล็อกอิน; หลังมีผู้ใช้ `/setup` = 404
3. **เพิ่ม/แก้พนักงาน (422)**: POST ผิด → 422 render ฟอร์มเดิม + ค่าที่กรอก + `#flash-error` + `.field-error[data-field]` → แก้ → 302 `/employees/{id}?msg=created|updated` (+ `#flash-ok`)
4. **ค้นหา/กรอง/เรียง/แบ่งหน้า**: ทั้งหมดอยู่ใน query string ของ GET เดียวกัน; เปลี่ยนตัวกรองกลับไปหน้า 1; ปุ่มส่งออก CSV ใช้ตัวกรองเดียวกัน (ไม่ใช้ page/per_page) พารามิเตอร์ผิด → ใช้ค่าเริ่มต้น ไม่แสดง error
5. **ลาออก**: ปุ่ม `ลาออก` → dialog ยืนยัน → POST `/employees/{id}/resign` + `csrf` → 302 `/employees/{id}?msg=resigned` สถานะเป็น `ลาออก`, ปุ่มลาออกหาย; (ลบ) admin → dialog → POST `/employees/{id}/delete` → 302 `/employees?msg=deleted`
6. **บัตร PDF**: `พิมพ์บัตร PDF` เปิด `/employees/{id}/card.pdf` (inline, 85.6×54 มม., ชื่อบริษัท/ชื่อ/รหัส/แผนก/ตำแหน่ง/วันเริ่มงาน; ฟอนต์ Sarabun ฝังในไฟล์) ผู้ใช้เห็น PDF ในแท็บใหม่; เจ้าของข้อมูล employee ทำได้เฉพาะของตัวเอง
7. **นำเข้า CSV**: เลือกไฟล์ → `ตรวจและนำเข้า` → ด่านตรวจไฟล์ (ขนาด/UTF-8/หัวตาราง/จำนวนแถว) ผิด → กลับหน้าอัปโหลดพร้อม error; ผ่าน → ประมวลผลทุกแถว (แถวผิดข้ามเฉพาะแถวนั้น) → 200 หน้ารายงาน `#import-summary` → ไปดูรายการ
8. **ออกจากระบบ**: ปุ่มใน sidebar POST `/logout` → 302 `/login`

---

## 7. Implementation checklist (Claude Code)

**ไฟล์**
- `static/css/staffy.css` — tokens (หัวข้อ 2) + reset เบาๆ + utilities (`.sr-only`, `.skip-link`, `.table-scroll`) + ทุก component ใน 4.x คลาสแบบ BEM-lite (`.btn--primary`, `.banner--danger`, `.badge--warn`) ห้าม inline style ใน template
- `static/js/staffy.js` — ไม่เกิน ~100 บรรทัด: เปิด/ปิด dialog + focus trap, toggle เมนูมือถือ, แถบความแข็งแรงรหัสผ่าน, แสดงชื่อไฟล์ที่เลือก ทุกอย่างต้อง degrade ได้เมื่อไม่มี JS
- `static/fonts/` — woff2 ของ Prompt และ Noto Sans Thai (self-host)
- partial/ส่วนย่อยของ template (ชื่อตรงกันทุก stack): `layout` (head + skip link + sidebar + main), `sidebar` (เมนูตามบทบาท, badge), `page_header`, `flash` (`#flash-ok`, `#flash-error` + map `msg` → ข้อความ), `field` (label + input + `.field-error` + aria), `pagination` (`#pagination`), `badge`, `dialog`, `avatar`, `format_date_th` (helper วันที่ไทย)

**ลำดับทำงาน**
1. tokens + layout + sidebar + login/setup (ตรวจ cookie/CSRF flow ก่อน)
2. components (4.x) ในหน้า style guide ชั่วคราว หรือในหน้าจริงโดยตรง
3. dashboard (ตัวเลขก่อน แผงทีหลัง) → employees list (กรอง/เรียง/แบ่งหน้า) → form (422) → detail (+ dialog) → import (upload + report)
4. ตรวจกับ hooks จากสคริปต์ทดสอบ แล้วค่อยทำ responsive

**Hooks ที่ต้องมี (สคริปต์ทดสอบชุดเดียวใช้ได้ทุก stack)**: `#flash-ok`, `#flash-error`, `#login-error[data-reason=invalid|locked]`, `input[name=csrf]` ในทุกฟอร์ม POST, `.field-error[data-field]`, `#employees-table tbody tr[data-id]`, `#pagination[data-page][data-pages][data-total]`, `#dashboard[data-active][data-pending-leaves][data-expiring][data-birthdays]` (employee: เฉพาะ `data-pending-leaves`), `#import-summary[data-imported][data-skipped][data-duration-ms]`

**เกณฑ์ผ่าน (acceptance)**
- Contrast ข้อความ ≥ 4.5:1 ทุกคู่สีใน tokens (ตรวจ `--faint` ใช้เฉพาะ disabled, `--badge-alert` ตัวขาว 12px ถ้าไม่ผ่านให้ใช้ `#B3261E`)
- ปุ่ม/ลิงก์/แถวที่คลิกได้ ≥ 44×44px; input สูง 48px
- ใช้คีย์บอร์ดครบทุกหน้า: skip link, ลำดับ tab ตามภาพ, focus ring เห็นชัด, dialog จับโฟกัสและปิดด้วย `Esc`
- ฟอร์มทุกช่องมี `<label for>`; error ผูก `aria-describedby`; `#flash-error`/`#login-error` เป็น `role="alert"`; ตารางมี `<caption>` (ซ่อนด้วย `.sr-only`) และ `th scope="col"`
- ภาษาไทย: `lang="th"`, line-height ≥1.6 ในเนื้อหา, ตัดบรรทัดได้ในตาราง/การ์ด (`overflow-wrap:anywhere`), ชื่อยาวไม่ล้นการ์ด, ตรวจสระ/วรรณยุกต์แสดงถูกในฟอนต์ที่ self-host
- หน้าที่มีข้อมูลส่วนตัวส่ง `Cache-Control: no-store`; เงินเดือนไม่ปรากฏใน HTML ของรายการหรือของบทบาทที่ไม่มีสิทธิ์ (ตรวจ source ไม่ใช่แค่ซ่อน)
- ผลลัพธ์เหมือนกันทั้ง 4 stack (markup, ข้อความ, status code) — ความต่างมาจาก stack เท่านั้น
- ไม่ทำ print stylesheet (หน้าจอเหล่านี้ไม่ต้องพิมพ์; ที่พิมพ์ได้คือ `card.pdf`)
