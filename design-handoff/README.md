# Design Handoff: Tabby, Mooban, Staffy

ชุดส่งมอบสำหรับให้ Claude Code สร้าง UI ของ 3 แอพทดสอบ shared hosting
(4 stack ต่อแอพ: Apache+PHP, Nginx+PHP-FPM, Node/Express, Python/Flask)

ดีไซน์ต้นฉบับ (ดูได้ในแคนวาส): https://claude.ai/artifact/4PM9qjn4VUzAE1cXzAHeT3

## ในชุดนี้มีอะไร

```
handoff/
├─ README.md                 ← ไฟล์นี้: ภาพรวม, การตัดสินใจที่ต้องรู้, ลำดับงาน, prompt เริ่มงาน
├─ CLAUDE.md.snippet         ← วางต่อท้าย CLAUDE.md ของ repo
├─ DESIGN-tabby.md           ← สเปค design Tabby (8 หน้า)
├─ DESIGN-mooban.md          ← สเปค design Mooban (11 หน้า)
├─ DESIGN-staffy-1.md        ← Staffy ส่วนที่ 1: token, app shell, component ร่วม, 8 หน้าแรก
├─ DESIGN-staffy-2.md        ← Staffy ส่วนที่ 2: ลา, บัญชี, แอดมิน, 403/404, แผนก, บริษัท + schema ที่เสนอเพิ่ม
├─ tokens/
│  ├─ tabby.css  mooban.css  staffy.css   ← CSS variables พร้อมใช้ (ชื่อตัวแปรตรงกับ §2 ของ DESIGN แต่ละไฟล์)
└─ reference-boards/         ← ไฟล์ออกแบบต้นฉบับ 37 หน้า (.dc.html) + canvas.json
```

สเปคฝั่ง backend/API/ข้อมูลอยู่ใน Claude Docs 3 ฉบับที่ทำไว้ก่อนหน้า
(Spec: Tabby / Spec: Mooban / Spec: Staffy) — ชุดนี้คือฝั่ง UI เท่านั้น

## ลำดับการอ่าน

1. README นี้ (โดยเฉพาะหัวข้อ "ต้องรู้ก่อนเริ่ม")
2. `DESIGN-<app>.md` ของแอพที่กำลังทำ: §2 token → §4 component → §5 ทีละหน้า → §8 checklist
3. เปิด `reference-boards/<ชื่อหน้า>.dc.html` เทียบเมื่อไม่แน่ใจค่าจริง

## ต้องรู้ก่อนเริ่ม (การตัดสินใจและข้อควรระวัง)

1. **ไฟล์ใน `reference-boards/` เป็นแค่ต้นแบบอ้างอิง ไม่ใช่โค้ดที่จะเอาไปใช้ตรงๆ**
   ใช้ฟอร์แมต Design Component (`<x-dc>`, `{{ }}`, `<sc-for>`) และเขียน style เป็น inline
   ให้ดึงค่า (สี ระยะ ข้อความ โครงสร้าง) ไปเขียนเป็น HTML ธรรมดา + CSS class + token
   ห้ามคัดลอก `support.js` / tag `x-dc` เข้าแอพ

2. **ฟอนต์:** ต้นแบบใช้ Google Fonts (Prompt, Noto Sans Thai) แต่ Spec ของ Mooban บังคับ CSP `'self'` และฟอนต์ระบบเท่านั้น
   - Mooban: ใช้ system font stack ใน `tokens/mooban.css` (ไม่โหลดฟอนต์ภายนอก) — Prompt/Noto เป็นแค่ฟอนต์ตอนออกแบบ
   - Tabby / Staffy: ถ้าต้องการให้หน้าตาตรงต้นแบบ ให้ self-host ไฟล์ woff2 ใน `/static/fonts/` (ไม่ใช้ CDN จะได้ไม่พึ่งภายนอกและวัด bandwidth ของ hosting ได้ตรง) ถ้าไม่ self-host ก็ใช้ fallback stack ใน token ได้เลย

3. **Dark mode มีเฉพาะ Mooban** (`prefers-color-scheme`) — Tabby และ Staffy เป็นธีมสว่างอย่างเดียว

4. **Staffy ออกแบบเป็นเดสก์ท็อปเท่านั้น (กว้าง 1280)** ใน `DESIGN-staffy-1.md` §3 มีข้อเสนอให้ sidebar ยุบได้ต่ำกว่า 1024px — เป็นคำแนะนำของ implementer ไม่ใช่ดีไซน์ที่เซ็นแล้ว

5. **หน้า "แผนก" และ "ข้อมูลบริษัท" ของ Staffy เพิ่มหลังเขียน Spec Doc**
   ยังไม่มี table/route ใน Claude Doc ของ Staffy — `DESIGN-staffy-2.md` §3 เสนอ schema และ route ขั้นต่ำไว้ให้ ต้องเพิ่มลง Spec Doc ด้วยก่อน/ระหว่าง implement

6. **ข้อมูลตัวอย่างในต้นแบบเป็น placeholder** (ชื่อคน, ยอดเงิน, วันที่) ห้าม hard-code ลงแอพ ให้ผูกกับ API/DB ตาม Spec

7. **ชื่อ Staffy ยังเป็นชื่อชั่วคราว** — เก็บชื่อแอพไว้ที่เดียว (config/constant) เปลี่ยนภายหลังง่าย

8. **UI ภาษาไทยล้วน** — ข้อความทุกจุดอยู่ในเอกสารสเปคแล้ว ให้ใช้ตามนั้น ห้ามแปลงเป็นอังกฤษ

## โครงสร้าง repo ที่แนะนำ (ใช้ซ้ำข้าม 4 stack)

แต่ละแอพมี UI ชุดเดียว แล้วให้ทุก stack ใช้ร่วมกัน เพื่อให้เทียบผลทดสอบ hosting ได้แฟร์

```
<app>/
├─ ui/static/            ← css/js/fonts/img ชุดเดียว (copy หรือ symlink เข้าแต่ละ stack)
│   ├─ css/<app>.css     ← import token จาก tokens/<app>.css
│   └─ js/               ← vanilla JS ไม่มี build step
├─ apache-php/  nginx-phpfpm/  node-express/  python-flask/
│   └─ templates หรือ views ที่ render markup ตาม DESIGN-<app>.md §4–5
```

Tabby และ Mooban เป็น markup ที่ JS วาดจาก API เป็นหลัก ใช้ HTML shell ไฟล์เดียวร่วมกันได้
Staffy เป็น server-rendered ต้องมี template ต่อ stack — ให้เขียน partial (layout, sidebar, flash, field, pagination) ก่อน แล้วค่อยทำทีละหน้า

## ลำดับงานที่แนะนำ

1. **Tabby** (ง่ายสุด): tokens → components → รายการ + ฟอร์ม → ยืนยันลบ/ว่าง → `/test`
2. **Mooban**: tokens (light/dark) → shell + nav → ฟีด/composer → like/comment → gallery + lightbox → โปรไฟล์ → signup → `/test`
3. **Staffy**: tokens → shell/sidebar → login/setup → พนักงาน (list/form/detail) → import → ลา → แอดมิน → แผนก/บริษัท → 403/404

ทำทีละหน้า เปิดต้นแบบเทียบ แล้วเช็ก acceptance ท้ายเอกสารแต่ละแอพก่อนไปหน้าต่อไป

## เกณฑ์ผ่านรวมทุกแอพ

- ตัวอักษรเทียบพื้น ≥ 4.5:1 (Mooban ทั้งสองธีม)
- ปุ่ม/ลิงก์ที่กดได้สูงอย่างน้อย 44px
- ใช้ `<button>`, `<a>`, `<label for>` จริง ไม่ใช้ `div` แทน; โฟกัสเห็นชัด; ใช้คีย์บอร์ดครบ
- ไม่มี emoji เป็นไอคอน (ใช้ SVG inline ตามต้นแบบ)
- ไม่มี layout shift (จองสัดส่วนรูป, live pill ไม่ดันเนื้อหา)
- ใช้ได้ที่ความกว้าง ≥ 360px (Tabby/Mooban) และ ≥ 1024px (Staffy)
- hook สำหรับเทสต์ตาม Spec (id/data attribute ที่ระบุ) ต้องมีครบ

## Prompt เริ่มงานให้ Claude Code

**ครั้งแรกใน repo:**

> อ่าน `design-handoff/README.md` ทั้งหมดก่อน แล้วอ่าน `design-handoff/DESIGN-tabby.md` กับไฟล์ token `design-handoff/tokens/tabby.css`
> ยังไม่ต้องเขียนโค้ด: สรุปแผนสั้นๆ ว่าจะวางไฟล์ตรงไหน และมีข้อไหนในสเปคที่คลุมเครือ แล้วรอผม OK

**ทำทีละหน้า:**

> ทำหน้า `<ชื่อหน้า>` ตาม `DESIGN-<app>.md` §5 เปิด `reference-boards/<ไฟล์>.dc.html` เทียบค่าจริง
> ใช้ class + token ห้าม inline style ห้ามคัดลอกฟอร์แมต x-dc
> เสร็จแล้วรันเช็กตาม §8 แล้วรายงานข้อที่ไม่ผ่าน

**ตอนตรวจงาน:**

> เทียบหน้า `<ชื่อหน้า>` ที่ทำแล้วกับต้นแบบ: สี ระยะ ข้อความไทย state (ว่าง/error/โหลด) และ a11y แล้วบอกส่วนที่ต่าง
