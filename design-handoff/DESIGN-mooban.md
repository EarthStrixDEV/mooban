# DESIGN-mooban.md — สเปคการ implement UI ของ Mooban

เอกสารนี้แปลงบอร์ดออกแบบ (`reference-boards/Mooban-*.dc.html`, 11 บอร์ด) เป็นข้อกำหนดที่ Claude Code เขียนตามได้เลย
อ้างอิงควบคู่กับ **Spec: Mooban** (Claude Doc id `5c428edb-1459-4ac8-9a1d-f6b15ea5e977`) ซึ่งเป็นแหล่งความจริงของ API, SSE, WebSocket, ข้อมูล และข้อจำกัดของ SWH
ถ้าบอร์ดกับ spec ขัดกัน **spec ชนะ** และให้จดไว้ในหัวข้อ 9

ภาษา: คำอธิบายเป็นไทย, identifier/โค้ดเป็นอังกฤษ, ข้อความบนหน้าจอ (UI copy) เป็นไทยตามบอร์ดทุกตัวอักษร
ป้ายกำกับ **[บอร์ด]** = วาดไว้ในบอร์ดแล้ว · **[spec]** = spec กำหนดแต่บอร์ดไม่ได้วาด · **[เสนอ]** = ข้อเสนอของผู้เขียนสเปคนี้ ไม่ได้อยู่ใน spec หรือบอร์ด (ทำหรือไม่ทำก็ได้ แต่ถ้าทำให้ทำตามที่เขียน)
ข้อมูลตัวอย่างในบอร์ด (ชื่อ, โพสต์, ตัวเลข, รูปไล่สี) เป็น **placeholder** ห้ามฝังลงโค้ด

---

## 1. ภาพรวมและแผนที่ board → route

Mooban เป็น SPA เขียนด้วย vanilla JS (ES module) + CSS ล้วน **ไม่มี framework ไม่มี build step** ไฟล์หน้าเว็บชุดเดียวกัน byte ต่อ byte บน 4 stack (Apache+PHP, Nginx+PHP-FPM, Node/Express, Python/Flask)
Server ส่ง `index.html` ให้ทุก path ที่ไม่ใช่ไฟล์จริงและไม่ขึ้นต้นด้วย `/api`, `/media`, `/ws`, `/download`, `/upload`, `/cache` ดังนั้น router ฝั่ง client ใช้ **History API** (path จริง `/`, `/gallery`, `/u/{handle}`, `/test`) ไม่ใช้ hash

| Route | หน้า | บอร์ดมือถือ (390×844) | บอร์ดเดสก์ท็อป (fluid) |
|---|---|---|---|
| `/` | ฟีด | `Mooban-Feed`, `Mooban-Compose` | `Mooban-Desktop-Feed` |
| `/` (ครั้งแรก) | sheet ตั้ง handle ทับฟีด | `Mooban-Signup` | (ใช้ dialog กลางจอ ดู 4.12) |
| `/gallery` | แกลเลอรี | `Mooban-Gallery` | `Mooban-Desktop-Gallery` (มี lightbox เปิดอยู่) |
| overlay บน `/gallery` | lightbox | `Mooban-Lightbox` | อยู่ใน `Mooban-Desktop-Gallery` |
| `/u/{handle}` | โปรไฟล์ | `Mooban-Profile` | `Mooban-Desktop-Profile` |
| `/test` | เครื่องมือทดสอบ | `Mooban-Test` | `Mooban-Desktop-Test` |

ไฟล์ที่ส่งมอบ (ชื่อตาม spec หัวข้อ 9): `public/index.html`, `public/style.css`, `public/app.js` (entry, `<script type="module">`), `public/robots.txt` และโมดูลย่อย `public/js/*.js` ได้ (เป็นไฟล์จริง rewrite ไม่ชน)
บอร์ดทั้งหมดเป็นรูปแบบ Design Component ที่ใช้ inline style เป็น **ไฟล์อ้างอิงดูค่าและโครงเท่านั้น** ห้ามคัดลอก `{{...}}`/`<sc-for>`/`support.js` ไปใช้ ให้แปลงเป็น class ใน `style.css` โดยใช้ token หัวข้อ 2

---

## 2. Design tokens

### 2.1 ฟอนต์ — ข้อขัดกันระหว่างบอร์ดกับ spec (ต้องอ่าน)

| | บอร์ด | Spec (หัวข้อ 4 + 9) |
|---|---|---|
| ฟอนต์ | Google Fonts: **Prompt** (หัวข้อ/ตัวเลข), **Noto Sans Thai** (เนื้อหา) | **ฟอนต์ระบบเท่านั้น** ห้ามโหลดฟอนต์/สคริปต์ภายนอก เพื่อใส่ CSP `default-src 'self'; img-src 'self' data:` ได้ |

**ข้อสรุป:** Prompt และ Noto Sans Thai เป็น **design-only** ห้ามใส่ `<link>` Google Fonts และห้ามเพิ่ม `font-src`/`style-src` ภายนอกใน CSP ให้ใช้ system stack ต่อไปนี้ทั้งแอป
(ถ้าอยากได้หน้าตาใกล้บอร์ดขึ้น สามารถ self-host woff2 ไว้ใต้ `/fonts/` แล้วใช้ `@font-face` ที่ `'self'` ได้ แต่ spec บอกว่า "ฟอนต์ของระบบเท่านั้น" จึงไม่ทำใน v1 เว้นแต่พี่เอิร์ธอนุมัติ)

```css
--font-body:    system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans Thai", "Leelawadee UI", "Thonburi", "Sarabun", Tahoma, "Helvetica Neue", Arial, sans-serif;
--font-display: var(--font-body); /* แทน Prompt: ใช้ font-weight 600 เหมือนเดิม */
```

ข้อควรระวังภาษาไทย: ใช้ `line-height: 1.6` กับข้อความเนื้อหา (วรรณยุกต์/สระบนไม่ถูกตัด), ห้ามใส่ `letter-spacing` ติดลบ, ห้ามใช้ `text-transform`, หัวข้อ `line-height: 1.35`
ตัวเลขที่เด่น (สถิติ, ms) ใช้ `font-variant-numeric: tabular-nums`

### 2.2 `:root` ครบชุด (light + dark ผ่าน `prefers-color-scheme`)

ค่าจากบอร์ดทุกตัว ยกเว้นแถวที่มี `/* + */` ซึ่งเป็นตัวแปรที่เพิ่มเพื่อแก้ contrast (ดู 7.3)

```css
:root {
  color-scheme: light dark;

  /* สี — light */
  --bg:        #F3F6F1;   /* พื้นหลังหน้า */
  --card:      #FFFFFF;   /* การ์ด, nav, dialog */
  --ink:       #17261D;   /* ข้อความหลัก */
  --sub:       #55665B;   /* ข้อความรอง (meta, label) */
  --line:      #E1E8DF;   /* เส้นคั่น, ขอบการ์ด */
  --brand:     #1F7A4D;   /* ปุ่มหลัก, ลิงก์, สถานะ active */
  --brandsoft: #DDEFE4;   /* พื้นปุ่มไอคอน, avatar ตัวเอง, nav active (เดสก์ท็อป) */
  --chip:      #E9EFE7;   /* chip, skeleton, ปุ่มรอง, bubble คอมเมนต์ */
  --onbrand:   #FFFFFF;   /* ตัวอักษรบน --brand */
  --err:       #B3261E;
  --warn:      #9A5B00;   /* กราฟ p95 */
  --brand-strong: #17663F; /* + ข้อความสี brand บนพื้น --brandsoft (4.44:1 ไม่ผ่าน ใช้ตัวนี้แทน) */
  --field-border: #76867B; /* + ขอบ input/textarea (เส้น --line ได้ 1.25:1 ไม่ผ่าน 3:1) */
  --scrim:     rgba(8, 14, 10, 0.84);   /* ฉากหลัง lightbox เดสก์ท็อป */
  --scrim-sheet: rgba(0, 0, 0, 0.55);   /* ฉากหลัง sheet ตั้ง handle */
  --media-badge: rgba(0, 0, 0, 0.62);   /* ป้าย @handle บนรูป, ปุ่มบนรูป */

  /* shape */
  --r-card: 20px;  --r-tile: 16px;  --r-input: 14px;  --r-sm: 12px;
  --r-pill: 22px;  --r-btn-lg: 28px; --r-sheet: 28px;

  /* spacing (4px base) */
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 20px; --s-6: 24px; --s-8: 32px;

  /* shadow */
  --shadow-pill: 0 4px 14px rgba(0, 0, 0, 0.18);   /* live pill */

  /* z-index */
  --z-pill: 2; --z-nav: 10; --z-scrim: 40; --z-dialog: 50; --z-lightbox: 60; --z-toast: 70;

  /* target */
  --tap: 44px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0F1712;  --card: #18231C;  --ink: #EAF2EC;  --sub: #A6B8AB;
    --line: #263329; --brand: #5CC48D; --brandsoft: #1E3A2B; --chip: #202D24;
    --onbrand: #0F1712; --err: #FF8A80; --warn: #F2B24C;
    --brand-strong: #5CC48D;  /* dark: --brand ผ่านอยู่แล้ว 5.74:1 บน --brandsoft */
    --field-border: #667D6D;
  }
}
```

**หมายเหตุ dark mode ที่บอร์ดมี:**
- `Mooban-Lightbox` (มือถือ) เป็นโทนมืดตายตัวทั้งสองธีม: พื้น `#000`, แผงล่าง `#121A15`, เส้น `#263329`, ข้อความ `#EAF2EC`/`#A6B8AB`, ช่อง alt `#0B110D` ขอบ `#3A4A3F`, ปุ่มบันทึก `#5CC48D` ตัวอักษร `#0F1712`, ปุ่มลบ `#FF8A80` ให้ทำเป็น class `.lightbox--dark` ที่ไม่ผูกกับ `prefers-color-scheme`
- `Mooban-Desktop-Gallery` ปุ่ม "ลบรูป" ในบอร์ดใช้ `#B3261E` ตายตัว บน dark card ได้ 2.48:1 **ไม่ผ่าน** ให้ใช้ `var(--err)` แทน
- สี avatar เป็นคู่พาสเทลตายตัวทั้งสองธีม (พื้นอ่อน + ตัวอักษรเข้ม ผ่านอยู่แล้ว): เขียว `#DDEFE4/#14573A`, เหลืองส้ม `#FBE6C8/#7A4A07`, ม่วง `#E3E0F5/#3B2F82`, ชมพู `#F8DCE2/#8A2142` เลือกด้วย hash(handle) % 4 ส่วน avatar ของตัวเอง ("ฉ") ใช้ `--brandsoft` + `--brand-strong`

### 2.3 Type scale (ค่าจากบอร์ด)

| บทบาท | ขนาด/น้ำหนัก | ใช้ที่ |
|---|---|---|
| wordmark "Mooban" | 22/600 มือถือ, 26/600 เดสก์ท็อป, สี `--brand` | top bar, left nav |
| หัวหน้า (h1) | 20/600 (profile, test มือถือ), 22/600 (ฟีด/แกลเลอรี มือถือ+ฟีดเดสก์ท็อป), 24/600 (แกลเลอรี/โปรไฟล์เดสก์ท็อป), 28/600 (test เดสก์ท็อป) | |
| หัวข้อ section | 16/600 (การ์ดมือถือ, rail), 18/600 (การ์ดเดสก์ท็อป, dialog) | |
| เนื้อหา | 16/400 lh 1.6 | ข้อความโพสต์ |
| ข้อความในช่องเขียน | 18/400 lh 1.6 | textarea composer |
| meta / label / ปุ่มรอง | 14/400–600 | handle, เวลา, ตัวนับ |
| ป้ายเล็ก | 12/500 | label bottom nav, ป้าย @handle บนรูป |
| ตัวเลขเด่น | 20–22/600 | สถิติ profile, ms ในหน้า test |

### 2.4 Iconography
SVG inline (ห้ามไฟล์ภายนอก/icon font) ทำเป็น `<svg style="display:none"><symbol>` ชุดเดียวใน `index.html` แล้ว `<use href="#i-...">` ทุกไอคอน `viewBox="0 0 24 24"` `fill="none"` `stroke="currentColor"` `stroke-linecap/linejoin="round"` `aria-hidden="true"` stroke 1.8 (ปกติ) / 2 (active) / 2.2 (ปุ่มบนรูป)

| id | path (stroke) |
|---|---|
| `i-home` | `M4 11l8-6.5 8 6.5v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z` |
| `i-gallery` | `rect x=3.5 y=4.5 w=17 h=15 rx=3` + `circle cx=9 cy=10 r=1.6` + `M4 17l5-4.5 4 3.5 3-2.5 4 3.5` |
| `i-user` | `circle cx=12 cy=8.5 r=3.5` + `M5 20c.8-3.6 3.5-5.5 7-5.5s6.2 1.9 7 5.5` |
| `i-chart` (ทดสอบระบบ) | `M5 19V11 M12 19V5 M19 19v-6` |
| `i-heart` | `M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z` (ไลก์แล้ว: `fill=currentColor`) |
| `i-comment` | `M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-5 3.5V17H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z` |
| `i-back` / `i-prev` | `M15 5l-7 7 7 7` |
| `i-next` | `M9 5l7 7-7 7` |
| `i-close` | `M6 6l12 12 M18 6L6 18` |
| `i-check` | `M5 12.5l4.5 4.5L19 7.5` |

---

## 3. Layout

### 3.1 Breakpoints
บอร์ดวาดแค่ 2 ขนาด (390 และ ≥1280) ช่วงกลางเป็น **[เสนอ]**:

| ช่วง | โครง | ที่มา |
|---|---|---|
| `< 720px` มือถือ (ต่ำสุด **360px**) | คอลัมน์เดียว, top bar + bottom nav 72px, แกลเลอรี 2 คอลัมน์ | [บอร์ด] 390 |
| `720–1099px` | left nav 220 + เนื้อหา (ไม่มี right rail), แกลเลอรี 3 คอลัมน์ | [เสนอ] |
| `≥ 1100px` | 3 คอลัมน์: left nav 220, กลาง 600 (โปรไฟล์ 640), right rail 300, gap 32, padding ข้าง 32; แกลเลอรี 4 คอลัมน์ | [บอร์ด] 220+32+600+32+300 = 1184 + 64 |

ความกว้างกลางสูงสุด 600px (ฟีด) / 640px (โปรไฟล์) จัดกึ่งกลาง (`justify-content:center`) ที่จอกว้างกว่า 1280
ห้ามมี horizontal scroll ที่ 360px (ทดสอบ), รูป/การ์ด `max-width:100%`, ข้อความยาวต่อเนื่อง `overflow-wrap:anywhere`

### 3.2 มือถือ (390×844)
- Top bar: padding `16px 12px 8px 20px`, wordmark ซ้าย, ปุ่มไอคอน 44×44 ขวา (ฟีด: ลิงก์ไป `/gallery`) หน้าย่อย (โปรไฟล์, test) ใช้ปุ่ม back 44×44 + h1 20/600 แทน wordmark
- เนื้อหา: padding ข้าง **16px**, ด้านล่างเว้น `90px` ไม่ให้ bottom nav บัง (ใช้ `padding-bottom: calc(72px + env(safe-area-inset-bottom) + 18px)`)
- Bottom nav: `position:fixed; bottom:0; height:72px; padding-bottom:8px` (+ safe-area), พื้น `--card`, `border-top:1px solid var(--line)`, 3 ช่องเท่ากัน (ฟีด / แกลเลอรี / โปรไฟล์) ไอคอน 22 + label 12px, active สี `--brand` weight 600 stroke 2
- หน้า `/test` มือถือ: ไม่มี bottom nav (มี back เท่านั้น) [บอร์ด]
- การ์ด: `margin-top:12px; padding:16px; radius:20px; background:--card; border:1px solid --line`

### 3.3 เดสก์ท็อป
- Left nav กว้าง 220 (แกลเลอรีบอร์ดใช้ 252 รวม padding ซ้าย 32 — ใช้ 220 + padding เดียวกันทุกหน้า): wordmark 26/600, รายการ `min-height:48px; padding:0 14px (16 ในบอร์ดฟีด); radius:24px; gap:12px` ไอคอน 22 + ข้อความ 16, active = พื้น `--brandsoft` ตัวอักษร `--brand` (บอร์ดฟีด/แกลเลอรี) หรือ `--ink` (บอร์ดโปรไฟล์/test) **ให้ใช้ `--brand-strong` + weight 600 ทุกหน้า** + `aria-current="page"`
- เมนู 4 รายการ: ฟีด, แกลเลอรี, โปรไฟล์, ทดสอบระบบ · ปุ่ม "โพสต์" (หน้าฟีด) / "โพสต์ใหม่" (หน้าอื่น, เป็นลิงก์ไป `/`): สูง 48 radius 24 พื้น `--brand` เต็มความกว้างเมนู `margin-top:16px`
- หน้า test เดสก์ท็อป: ไม่มี right rail, left nav มี `border-right:1px solid --line`, main `padding:32px 40px`, grid 2 คอลัมน์ gap 20 (การ์ดอัปโหลดกิน 2 แถว)

---

## 4. Components

ทุก component: ปุ่ม/ลิงก์ทัชกว่า **44×44px**, มี `:focus-visible` ชัด (`outline:3px solid var(--brand); outline-offset:2px` — บนพื้น `--brand` ใช้ `outline-color: var(--ink)`), `prefers-reduced-motion` ปิด transition (หัวข้อ 7)

### 4.1 Top bar (มือถือ) / Left nav (เดสก์ท็อป)
```html
<header class="topbar">
  <h1 class="wordmark">Mooban</h1>
  <a class="icon-btn" href="/gallery" aria-label="แกลเลอรีรูป"><svg aria-hidden="true"><use href="#i-gallery"/></svg></a>
</header>
<nav class="sidenav" aria-label="เมนูหลัก"><a href="/" aria-current="page">…</a> …</nav>
```
สถานะ: default / hover (พื้น `--chip`) / active-press / `aria-current` / focus-visible. ลิงก์ภายในแอปดักคลิกแล้ว `history.pushState` (ปล่อย ctrl/cmd/middle-click ให้ browser)

### 4.2 Bottom nav (มือถือ)
```html
<nav class="bottomnav" aria-label="เมนูหลัก">
  <a href="/" aria-current="page"><svg …/><span>ฟีด</span></a>
  <a href="/gallery">…แกลเลอรี</a>
  <a href="/u/{me}">…โปรไฟล์</a>
</nav>
```
"โปรไฟล์" ชี้ `/u/{handle ของตัวเอง}`; ถ้ายังไม่มี token → เปิด sheet ตั้ง handle (4.12)

### 4.3 Composer
**แบบย่อ (มือถือ, หน้าฟีด)** [บอร์ด]: ลิงก์ขนาด `min-height:64px; padding:0 16px; radius:20px; card+border` มี avatar 40 + ข้อความ placeholder "วันนี้มีอะไรในหมู่บ้าน" สี `--sub` → ไปหน้าเต็ม (route `/compose` **[เสนอ]** หรือ overlay เต็มจอ ห้ามเปลี่ยน path ที่ spec ไม่ระบุถ้าเลี่ยงได้ → แนะนำ overlay เต็มจอแบบ dialog ที่ปิดด้วย "ยกเลิก")
**แบบเต็ม** [บอร์ด `Mooban-Compose`]: header `ยกเลิก` (ซ้าย, ข้อความ 16/500 `--sub`) + ปุ่ม `โพสต์` (ขวา, pill `min-height:44; padding:0 22; พื้น --brand`) · `<textarea maxlength="280" rows="4">` ขนาด 18px lh 1.6 ไม่มีขอบ `min-height:110px` มี `<label>` ซ่อนด้วยภาพ "ข้อความโพสต์" · แถบล่างมีปุ่มแนบรูป 44 วงกลม `--brandsoft` + ตัวนับ `{n} / 280`
**เดสก์ท็อป** [บอร์ด `Mooban-Desktop-Feed`]: ฟอร์มอยู่บนสุดของฟีด (การ์ด padding 16 flex gap 12, avatar 44, textarea 2 แถว, แถบล่างคั่น `border-top` มีปุ่มแนบรูป + ตัวนับ `0 / 280` + ปุ่ม `โพสต์`)

พฤติกรรม:
- ตัวนับนับ **code point** หลัง trim (spec: Unicode code point) ใช้ `[...text.trim()].length`; ตั้ง `maxlength` ไว้ด้วยแต่ยังนับเอง; > 260 ตัวนับเป็น `--warn`, = 280 เป็น `--err` **[เสนอ]**
- ปุ่ม "โพสต์" `disabled` เมื่อไม่มีทั้งข้อความและรูป (spec 4: ต้องมีอย่างใดอย่างหนึ่ง) หรือกำลังอัปโหลด/ส่ง; disabled = พื้น `--chip` ตัวอักษร `--sub` `cursor:not-allowed` (ตามปุ่ม disabled ของ signup)
- แนบรูป: `<input type="file" accept="image/jpeg,image/png,image/webp">` ซ่อน (ใช้ `<label>` เป็นปุ่ม) → ทันทีที่เลือก เรียก `POST /api/images` (multipart `file`) ได้ `image_id` เก็บไว้ แล้ว `POST /api/posts {body, image_id}` ตอนกดโพสต์ (spec: ทำสองขั้น)
- พรีวิวรูป [บอร์ด]: กรอบ radius 16 ขอบ `--line` พื้น `--chip` สูง 200 `object-fit:cover` ใช้ `thumb_url` จาก response, ปุ่มเอาออก 44 วงกลม `rgba(0,0,0,.6)` มุมขวาบน `aria-label="เอารูปออก"`, บรรทัดล่าง `{ชื่อไฟล์} · {ขนาด} จะถูกย่อให้อัตโนมัติ` 14px `--sub` ระหว่างอัปโหลดแสดง progress/สถานะ "กำลังอัปโหลด…" และปุ่มโพสต์ disabled
- เอารูปออก: `DELETE /api/images/{id}` (รูปที่อัปโหลดแล้วไม่ใช้ยังกินโควตา — spec) **[เสนอ]** ลบทิ้งเมื่อกดเอาออก/ยกเลิก
- Error: 413 "ไฟล์ใหญ่เกิน 10 MB", 415 "รองรับเฉพาะ JPEG, PNG และ WebP", 422 `image_too_many_pixels`/`image_invalid`/`quota_reached` และ 422 `validation_failed` (แสดง `fields.body`) เป็นข้อความใต้พรีวิว/ช่อง `role="alert"` สี `--err` **[เสนอ copy]**

### 4.4 Post card
```html
<article class="post" data-id="101" aria-labelledby="p101-name">
  <header class="post__head">
    <span class="avatar" aria-hidden="true">ป</span>
    <div><p id="p101-name" class="post__name">ป้าหน่อย</p>
         <p class="meta">@pa_noi · <time datetime="…">18 นาที</time></p></div>
    <button class="icon-btn post__menu" aria-haspopup="menu" aria-label="ตัวเลือกโพสต์">…</button> <!-- เฉพาะโพสต์ของตัวเอง -->
  </header>
  <p class="post__body">…</p>            <!-- textContent เท่านั้น ห้าม innerHTML -->
  <figure class="post__img">…</figure>   <!-- ถ้า image != null -->
  <div class="post__actions"> <button like/> <button comments/> </div>
  <section class="thread" hidden>…</section>
</article>
```
- มือถือ: padding 16, avatar 40; เดสก์ท็อป: padding 20, avatar 44; ชื่อ 16/600, meta 14 `--sub`; เนื้อหา 16/1.6 `margin-top:12px`; `white-space:pre-wrap` **[เสนอ]** (รักษาบรรทัดใหม่)
- แถว actions: `display:flex; gap:4px; margin:8px 0 0 -12px` (ให้ไอคอนชิดขอบซ้ายข้อความ), ปุ่ม `min-height:44; padding:0 12px; radius:22; พื้นโปร่ง; 14/600; gap:6` ไอคอน 20
- **รูปในโพสต์** [spec: ไม่ได้วาดในบอร์ดฟีด] `<img>` ใส่ `width`/`height` จาก `image.width/height` + `style="aspect-ratio:w/h"`, `loading="lazy" decoding="async"`, `alt = image.alt || "รูปจาก @handle"`, `src = display_url`, กว้าง 100%, radius 16, `margin-top:12px`, `max-height:520px; object-fit:cover` [เสนอ], คลิกเปิด lightbox ของรูปนั้น (ใช้ลำดับเดียวกับแกลเลอรี)
- เมนูโพสต์ของตัวเอง **[spec: แก้/ลบโพสต์ได้เฉพาะของตัวเอง; บอร์ดไม่ได้วาด]** ปุ่ม ⋯ 44×44 มุมขวา เปิด `role="menu"` สองรายการ "แก้ไขโพสต์" (แก้เฉพาะข้อความ — สลับเนื้อหาเป็น textarea inline + `บันทึก`/`ยกเลิก`, `PUT /api/posts/{id}`) และ "ลบโพสต์" (สี `--err`; ยืนยันก่อน: dialog "ลบโพสต์นี้และรูปของมัน?" ปุ่ม `ลบ` / `ยกเลิก`, `DELETE /api/posts/{id}`) — ทำ **[เสนอ]** ด้วยสไตล์เดียวกับ pill/dialog ที่มีอยู่

### 4.5 ปุ่มไลก์ (optimistic)
```html
<button class="act act--like" aria-pressed="false" aria-label="ถูกใจ 12" data-testid="like-btn">
  <svg aria-hidden="true"><use href="#i-heart"/></svg><span class="count">12</span>
</button>
```
- ไลก์แล้ว: `aria-pressed="true"`, สี `--brand`, ไอคอน `fill:currentColor`; ยังไม่ไลก์: `--sub`, ไอคอน `fill:none`
- `aria-label` = `ถูกใจ {n}` (ตามบอร์ด) อัปเดตทุกครั้งที่ตัวเลขเปลี่ยน
- คลิก: อัปเดตหน้าจอทันที (สลับ pressed, ±1) → `PUT /api/posts/{id}/like` (ไลก์) / `DELETE …/like` (เลิก) (idempotent) · ถ้า error (ไม่ใช่ 2xx) **ย้อนกลับ** สถานะ+ตัวเลข และแสดง toast · กัน double-click ด้วยคิวต่อโพสต์ (ส่งค่าปลายทางสุดท้าย)
- ถ้าไม่มี token → เปิด sheet ตั้ง handle แทน (เขียนข้อมูลต้องมี token)
- SSE `like.changed {post_id, like_count}` อัปเดตเฉพาะตัวเลข **ไม่แตะ** `aria-pressed` (สถานะไลก์เป็นของแต่ละ client)

### 4.6 คอมเมนต์ (expand/collapse)
- ปุ่มคอมเมนต์: `aria-expanded`, `aria-controls="thread-{id}"`, `aria-label="ความคิดเห็น {n}"` (ตามบอร์ดเดสก์ท็อป) เปิดแล้ว → โหลด `GET /api/posts/{id}/comments?limit=20` เรียงเก่าสุดก่อน, ปุ่ม "ดูความคิดเห็นก่อนหน้า/เพิ่ม" ถ้า `next_after != null` **[เสนอ copy]**
- Thread [บอร์ด]: `margin-top:8px; padding-top:12px; border-top:1px solid --line` แต่ละคอมเมนต์ = avatar 32 (พื้น `--chip`, ตัวอักษร `--ink`) + bubble (`padding:8px 14px; radius:16; พื้น --chip`) บรรทัดแรก `ชื่อ` 14/600 + ` · เวลา` 14 `--sub`, ข้อความ 14 lh 1.5
- ช่องเขียน: `<input type="text" maxlength="280">` สูง 44 radius 22 ขอบ `--field-border` placeholder/label "เขียนความคิดเห็น" + ปุ่ม `ส่ง` (pill `--brand`) `POST /api/posts/{id}/comments {body}` 1–280 ตัว
- ลบคอมเมนต์ของตัวเอง **[spec ให้ลบได้; บอร์ดไม่ได้วาด]** ปุ่มข้อความ "ลบ" 14/600 `--err` สูง 44 ท้าย bubble เฉพาะของตัวเอง `DELETE /api/comments/{id}`
- SSE: `comment.created` อัปเดต `comment_count` ทันทีทุกโพสต์ที่แสดงอยู่ และถ้า thread เปิดอยู่ให้ต่อท้ายคอมเมนต์ (กันซ้ำด้วย `comment.id`) `comment.deleted` ลบจาก thread + ลดตัวเลข

### 4.7 Live pill "มีโพสต์ใหม่ N รายการ"
- โครง [บอร์ด]: wrapper `aria-live="polite"` ครอบเสมอ (แม้ยังไม่มีปุ่ม) เพื่อให้ screen reader ประกาศตอนปุ่มโผล่
- ตำแหน่ง **ต้องไม่ดันเนื้อหา**: มือถือ `position:absolute; top:64px` กึ่งกลาง (ใต้ top bar), เดสก์ท็อป wrapper `position:sticky; top:12px; z-index:2; height:0` กึ่งกลางคอลัมน์ฟีด ปุ่มลอยทับ ไม่มี margin/height ที่ทำให้เลย์เอาต์ขยับ (CLS = 0)
- สไตล์: `min-height:44; padding:0 18–20px; radius:22; พื้น --brand; ตัวอักษร --onbrand 14/600; box-shadow: var(--shadow-pill)`; `pointer-events:none` ที่ wrapper, `auto` ที่ปุ่ม
- ลอจิก: SSE `post.created` → ใส่ใน `pending[]` (ข้ามโพสต์ที่ id อยู่ในฟีดแล้วและโพสต์ของตัวเองที่เพิ่งส่ง) แสดงข้อความ `มีโพสต์ใหม่ {pending.length} รายการ` · คลิก → แทรกทั้งหมดบนสุด (ใหม่สุดก่อน), เลื่อนขึ้นบนสุด, ล้าง pending, ซ่อนปุ่ม
- ถ้าผู้ใช้อยู่บนสุดของฟีดอยู่แล้ว ก็ยังแสดงปุ่ม (spec: ไม่ดันรายการที่กำลังอ่าน) **[เสนอ]** ไม่แทรกอัตโนมัติ

### 4.8 Skeleton card
โครงเหมือน post card: avatar วงกลม 40–44 `--chip`, แท่งชื่อ 140×14 และ meta 90×12, แท่งข้อความ 100% และ 70% สูง 14 (radius 7) ทุกแท่ง `background:var(--chip)` · มี `role="status" aria-label="กำลังโหลดโพสต์เพิ่ม"` · แสดง 3 ใบตอนโหลดแรก, 1 ใบท้ายรายการตอนโหลดหน้าต่อ · shimmer (gradient เลื่อน) เฉพาะเมื่อไม่ได้ตั้ง reduced-motion **[เสนอ]** (บอร์ดวาดนิ่ง)

### 4.9 แกลเลอรี masonry
- หัว: h1 "แกลเลอรี" + `รูปจากทุกคนในหมู่บ้าน {total} รูป` (14 `--sub`) · `role="group" aria-label="เรียงรูป"` ปุ่ม chip `aria-pressed`: **ล่าสุด** (active = พื้น `--brand` ตัวอักษร `--onbrand` 600) / **ถูกใจมากสุด** / **ของฉัน** (inactive = พื้น `--chip` ตัวอักษร `--ink` 500) สูง 44 padding `0 18–20px` radius 22
- ตาราง: มือถือ 2 คอลัมน์ gap 8, เดสก์ท็อป 4 คอลัมน์ gap 12 · แต่ละคอลัมน์เป็น `<ul>` flex-column gap เดียวกัน · แต่ละรูป `<li>` `position:relative; border-radius:16px; overflow:hidden; aspect-ratio: {w} / {h}; background: var(--chip)` ← **จองพื้นที่ล่วงหน้าจาก width/height ของ API** (บอร์ดใช้ 4/5, 1/1, 3/4, 4/3)
- ภายใน: `<button class="tile__open" aria-label="เปิดรูป {alt}">` ทับเต็มพื้นที่ (`position:absolute; inset:0`), `<img src=thumb_url width height alt loading="lazy" decoding="async">` ป้าย `@handle` มุมซ้ายล่าง (`left/bottom 8px (มือถือ) 10px (เดสก์ท็อป); padding 2px 10px; radius 12; พื้น --media-badge; ตัวอักษร #fff 12/500; pointer-events:none`)
- การกระจายคอลัมน์: JS เติมรูปที่โหลดมาตามลำดับลง **คอลัมน์ที่สูงสุดน้อยสุด** (คำนวณจาก `h/w`) ห้ามใช้ CSS `columns` เพราะโหลดต่อแล้วรูปเดิมย้ายคอลัมน์ (กระโดด)
- โหลดต่อ: `GET /api/images?limit=40&before=` (cursor `next_before`) ด้วย IntersectionObserver
- "ของฉัน" = `GET /api/images?user={myHandle}`; "ถูกใจมากสุด" **ไม่มี API รองรับใน spec** (ดู 9)

### 4.10 Lightbox
**มือถือ** [บอร์ด `Mooban-Lightbox`] เต็มจอ พื้น `#000`: header (ปิด 44 วงกลม ซ้าย / `{pos} / {total}` 14/500 กลาง) · ภาพ `object-fit:contain` เต็มพื้นที่กลาง · ปุ่ม prev/next 44 วงกลม `--media-badge` กลางด้านซ้าย/ขวา (`aria-label="รูปก่อนหน้า"`, `"รูปถัดไป"`) · hint `บีบนิ้วเพื่อซูม · ปัดซ้าย-ขวาเพื่อเปลี่ยนรูป` (pill `rgba(0,0,0,.68)` ขาว 14 ลบเองหลัง 3 วิ/ครั้งแรกเท่านั้น **[เสนอ]**) · แผงล่าง radius `24 24 0 0` พื้น `#121A15` padding `16 20 24`: alt 16/1.6, `โดย @{handle} · {เวลา}` 14, เครื่องมือเจ้าของรูป (หัวข้อ "เครื่องมือเจ้าของรูป" 14/600, ช่อง `คำอธิบายรูป (alt text)` สูง 48 radius 12 + คำอธิบายช่วย "ช่วยให้คนที่ใช้โปรแกรมอ่านหน้าจอเข้าใจว่าในรูปมีอะไร", ปุ่ม `บันทึกคำอธิบาย` (pill สูง 48 `#5CC48D`) + `ลบรูป` (ขอบ/ตัวอักษร `#FF8A80`)) **แสดงเครื่องมือเจ้าของเฉพาะรูปของตัวเอง**
**เดสก์ท็อป** [บอร์ด `Mooban-Desktop-Gallery`]: scrim `--scrim` ทั้งหน้า, dialog กลางจอ `max-width:980px; height:640px; radius:24; overflow:hidden; พื้น --card` แบ่งซ้าย = รูป (`flex:1`), ขวา = แผง 320px padding 24 (หัวข้อ `h2#lb-title` 18/600 ใช้ alt เป็นชื่อ, `@handle · เวลา`, ปุ่มปิด 44, ขนาด `{w} × {h} · {format} · {KB} KB`, `<textarea rows=3>` "คำอธิบายรูป (alt)" + `บันทึกคำอธิบาย`, ท้ายแผง `border-top` "รูปของคุณ" + `ลบรูป`) · ปุ่ม prev/next 52 วงกลม `rgba(255,255,255,.16)` ข้าง dialog
- **a11y:** `role="dialog" aria-modal="true" aria-labelledby`; ตอนเปิด ย้าย focus ไปปุ่มปิด, **focus trap** (Tab/Shift+Tab วนใน dialog), `Esc` ปิดและคืน focus ให้ `.tile__open` ที่กดมา, `←`/`→` เปลี่ยนรูป, `inert`/`aria-hidden` ที่เนื้อหาหลัง, ล็อก scroll ของ body, รูปมี `alt` (ถ้าว่างใช้ "รูปจาก @handle")
- เปลี่ยนรูปแล้วโหลด `display_url` ถัดไป/ก่อนหน้าไว้ล่วงหน้า (`new Image().src`) **[เสนอ]**
- แก้ alt: `PATCH /api/images/{id} {"alt": "…"}` (≤200 ตัว, ว่าง → NULL), สำเร็จแสดง toast "บันทึกคำอธิบายแล้ว" **[เสนอ copy]**
- ลบรูป: `DELETE /api/images/{id}` → ปิด/ไปรูปถัดไป, ถอดแผ่นออกจากกริด; ยืนยันสองขั้น (ปุ่มเปลี่ยนเป็น "ยืนยันลบ" 4 วิ) **[เสนอ]** เพราะลบแล้วย้อนไม่ได้ และโพสต์ที่ใช้รูปนี้จะเหลือแต่ข้อความ
- URL: **[เสนอ]** `history.pushState({lb: id}, "")` เมื่อเปิด เพื่อให้ปุ่ม Back ของเบราว์เซอร์/ท่าทาง Android ปิด lightbox แทนออกจากหน้า (path ไม่เปลี่ยน)
- มือถือ: ปัดซ้าย-ขวาเปลี่ยนรูป (pointer events, ระยะ > 50px), pinch zoom ใช้ `touch-action: pinch-zoom` ของ browser (ไม่ต้องเขียน gesture เอง)

### 4.11 Profile header + tablist
- มือถือ [บอร์ด]: avatar 72 (`--brandsoft`, ตัวอักษร `--brand-strong` 30/600) + ชื่อ 20/600 + `เข้าหมู่บ้านเมื่อ {เดือนย่อ} {พ.ศ.}` 14 `--sub`; แถวสถิติ `<dl>` 3 ช่องเท่ากัน (`padding:10px 8px; radius:16; card+border; ตัวอักษรกึ่งกลาง; dt 14 --sub; dd 20/600`); ปุ่ม `แก้โปรไฟล์` ขอบ `--brand` เต็มกว้าง
- เดสก์ท็อป [บอร์ด]: แบนเนอร์ไล่สี `linear-gradient(120deg,#7FB77E,#1F7A4D)` สูง 140 (`aria-hidden`) · avatar 88 ขอบ 4px สี `--bg` ซ้อนขึ้นไป -44px · ปุ่ม `แก้โปรไฟล์` มุมขวา · h1 24/600 · `@handle · เข้าหมู่บ้านเมื่อ …` · สถิติแบบ inline (ตัวเลข 16/600 + label 14 `--sub`) ห่าง 24
- Tablist: `role="tablist" aria-label="เนื้อหาโปรไฟล์"` แท็บ `โพสต์` / `รูป` (เดสก์ท็อปแสดง `รูป {n}`) `role="tab" aria-selected aria-controls`, สูง 48 (มือถือ) / 52 (เดสก์ท็อป) แท่งล่าง 3px `--brand` เมื่อเลือก (ตัวอักษร `--ink` 600) · ไม่เลือก = โปร่ง `--sub` 500 · panel `role="tabpanel" aria-labelledby` · คีย์บอร์ด: ←/→ เลื่อนแท็บ, Home/End, roving `tabindex`
- โพสต์บนโปรไฟล์ [บอร์ด] เป็นการ์ดแบบย่อ: เวลา (14 `--sub`) → ข้อความ → แถว `ถูกใจ {n} · ความคิดเห็น {n}` 14/600 `--sub` (มือถือ) หรือปุ่มไลก์/คอมเมนต์เต็ม (เดสก์ท็อป) ใช้ API `GET /api/posts?user={handle}`
- แท็บรูป: กริดสี่เหลี่ยมจัตุรัส `repeat(4,1fr)` gap 8 radius 12 (เดสก์ท็อปบอร์ดแสดง "รูปล่าสุด" + `ดูทั้งหมด` ไป `/gallery`), มือถือ 3 คอลัมน์ **[เสนอ]** ใช้ `GET /api/images?user={handle}`
- ข้อมูลโปรไฟล์: `GET /api/users/{handle}` (ชื่อ, จำนวนโพสต์/รูป) 404 → หน้า "ไม่พบผู้ใช้นี้" **[เสนอ copy]** พร้อมลิงก์กลับฟีด

### 4.12 Sheet / dialog ตั้ง handle (สมัครครั้งแรก)
[บอร์ด `Mooban-Signup`] ฟีดเบลอ/จางอยู่ด้านหลัง (skeleton 3 ใบ `aria-hidden`) + scrim `--scrim-sheet` + bottom sheet `role="dialog" aria-modal="true" aria-labelledby="su-title"` radius `28 28 0 0` พื้น `--card` padding `12 20 28` · แถบจับ 40×4 `--line` · `h2` "เข้าหมู่บ้านครั้งแรก" 24/600 · คำอธิบาย "ตั้งชื่อเล่นสำหรับให้คนอื่นเรียก ไม่ต้องสมัครด้วยอีเมลหรือรหัสผ่าน" 16/1.6 `--sub`
- ช่อง: label "ชื่อเล่น (handle)" 14/600 · กล่อง `height:52; radius:16; border 2px; พื้น --bg` มี `@` นำหน้า (`aria-hidden`) + `<input id="handle" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="handle-msg handle-rules">`
- สถานะช่อง (ขอบ + ข้อความใต้ช่อง `id=handle-msg`): `idle` ขอบ `--field-border` · `checking` "กำลังตรวจสอบ…" `--sub` · `available` ขอบ `--brand` + ✓ "ชื่อนี้ใช้ได้" `--brand-strong` · `taken` ขอบ `--err` `aria-invalid="true"` `role="alert"` "ชื่อนี้มีคนใช้แล้ว ลองชื่อด้านล่างแทนได้เลย" + chip แนะนำ `@somchai_2` `@somchai99` `@somchai_th` (chip สูง 44 พื้น `--brandsoft` 14/500; คลิกเติมลงช่อง) · `invalid` (ผิดรูปแบบ) ข้อความอธิบายกติกา
- รายการกติกา (`ul#handle-rules`, 14 `--sub`, ✓ สี `--brand`): "ยาว 3–20 ตัวอักษร", "ใช้ได้เฉพาะ a-z, 0-9 และ _" ติ๊ก ✓ เมื่อผ่าน, ✗ สี `--err` เมื่อไม่ผ่าน (ไม่พึ่งสีอย่างเดียว: ใช้ไอคอนต่าง)
- ตรวจ availability: แปลงเป็นตัวพิมพ์เล็กระหว่างพิมพ์, debounce 400ms แล้ว `GET /api/users/{handle}` (200 = มีแล้ว, 404 = ว่าง) ก่อนกดสมัคร; ผลสุดท้ายยืนยันด้วย `POST /api/users` (409 `handle_taken`, 422 `validation_failed`, 429 `rate_limited`)
- **ช่อง "ชื่อที่แสดง" (display_name 1–50 ตัว) ที่ spec บังคับ บอร์ดไม่ได้วาด** → เพิ่มใต้ช่อง handle ด้วยสไตล์เดียวกัน (label "ชื่อที่แสดง", `maxlength=50`, error จาก `fields.display_name`) ดู 9
- ปุ่ม `เข้าหมู่บ้าน` `type=submit` สูง 56 radius 28 เต็มกว้าง: disabled (พื้น `--chip`, ตัวอักษร `--sub`) จนกว่า handle ผ่านกติกา+ว่าง และ display_name ไม่ว่าง; พร้อมใช้ = พื้น `--brand` ตัวอักษร `--onbrand`
- ท้าย sheet: "ระบบจะเก็บโทเคนไว้ในเครื่องนี้เท่านั้น ถ้าล้างข้อมูลเบราว์เซอร์หรือเปลี่ยนเครื่อง ต้องตั้งชื่อใหม่" 14/1.6 `--sub`
- สำเร็จ: `localStorage.setItem("mb_token", token)` (try/catch — บางโหมดส่วนตัวใช้ไม่ได้), เก็บ `user` ในหน่วยความจำ, ปิด sheet, โฟกัสกลับที่ช่องเขียนโพสต์ · ปิดไม่ได้ด้วย Esc/คลิกฉากหลังถ้ายังไม่เคยมีบัญชีและผู้ใช้พยายามเขียน (อ่านฟีดได้โดยไม่ต้องมี token: **[เสนอ]** เปิด sheet เฉพาะตอนลองเขียน/ไลก์/คอมเมนต์ หรือเปิดครั้งแรกที่เข้าตาม spec แล้วให้ปิดเพื่อ "ดูเฉยๆ" ได้) — spec 4 บอกให้แสดงครั้งแรกที่เข้า จึงให้เปิดอัตโนมัติ และมีปุ่มปิด/ข้ามเป็นลิงก์ข้อความ "ดูเฉยๆ ก่อน" **[เสนอ]** เพื่อไม่ขวางการอ่าน
- เดสก์ท็อป: ไม่มีบอร์ด → ใช้ dialog กลางจอ `max-width:440px; radius:24` เนื้อหาเดียวกัน **[เสนอ]**

### 4.13 การ์ดหน้า /test
การ์ด: `padding:14–16 (มือถือ) / 20–24 (เดสก์ท็อป); radius:20; card+border; h2 16–18/600` เลขนำหน้าหัวข้อ "1. …", "2. …", "3. …"
1. **อัปโหลดรูป** [บอร์ด] ปุ่ม "เลือกรูป" (label pill `--brand`) + ชื่อไฟล์/ขนาด · เดสก์ท็อปมี dropzone ขอบ `2px dashed var(--line)` radius 16 "หรือลากรูปมาวางที่นี่" · ผลลัพธ์: มือถือ `<dl>` แถวละ `dt` (`--sub`) / `dd` (600) คั่นเส้น: `ประมวลผล (processing_ms)`, `รูปแบบที่ได้ (format)`, `ต้นฉบับ`, `Thumbnail JPEG → WebP`, `ประหยัดจาก WebP` (ค่านี้ `--brand`); เดสก์ท็อป: 3 ไทล์ (`processing_ms`, `format`, `ประหยัดจาก WebP`, ตัวเลข 22/600) + แท่งเทียบขนาด 3 แถว (ต้นฉบับ JPEG / Thumbnail JPEG / Thumbnail WebP แถบ `--brand` บนราง `--chip` สูง 14) + ตาราง "ประวัติการทดสอบ" (ไฟล์, ต้นฉบับ, WebP, ประหยัด, เวลา; `<th scope="col">`)
   - ข้อมูล: จาก response `POST /api/images` → `processing_ms`, `format`, `bytes_display`, `bytes_thumb`, `width`, `height` (spec 6). ค่า "ต้นฉบับ" = `file.size` ฝั่ง client · **"Thumbnail JPEG → WebP / ประหยัดจาก WebP" ในบอร์ดต้องมีตัวเทียบ JPEG ซึ่ง API ไม่ส่งมา** → คำนวณฝั่ง client เองด้วย canvas `toBlob("image/jpeg", .75)` ที่ 320px เพื่อเทียบ **[เสนอ]** ถ้าไม่ทำ ให้ซ่อนแถวนี้ ห้ามแสดงตัวเลขสมมติ; กรณีเซิร์ฟเวอร์ถอยไป JPEG (`format:"jpeg"`) แสดง "รูปแบบที่ได้: image/jpeg" และซ่อนแถวประหยัด
   - รูปที่อัปโหลดจากหน้านี้ถูกสร้างจริง → ปุ่ม "ลบรูปทดสอบ" (`DELETE /api/images/{id}`) **[เสนอ]**
2. **ความหน่วง Realtime (SSE)** [บอร์ด]: ปุ่ม "เริ่มทดสอบ" (มือถือ) / "เริ่มทดสอบ 30 วินาที" (เดสก์ท็อป — **spec คือ "วัด latency 10 ครั้ง"** ใช้ตามปุ่ม spec: `POST /api/test/emit` 10 ครั้งทีละครั้ง รอ `test.ping` ที่ nonce ตรงสูงสุด 5 วิ/ครั้ง; ตัวนับ 30 วินาทีในบอร์ดให้ถือเป็นข้อความตัวอย่าง ปรับป้ายเป็น "วัด latency 10 ครั้ง" ตาม spec) · ไทล์ผล: มือถือ เฉลี่ย / p50 / p95 (หน่วย ms), เดสก์ท็อปเพิ่ม `ตกหล่น` (% event ที่ไม่มาถึง) · กราฟเส้น SVG `role="img" aria-label="กราฟความหน่วงของ 30 ข้อความล่าสุด…"` เส้น `--brand` 2–2.2px, เส้นประ p95 `--warn`, p50 `--sub`; **spec ให้ผลเป็น มัธยฐาน, p95, จำนวนที่ไม่มาถึง** → "p50" = มัธยฐาน · เพิ่ม log event ของ stream และสถานะ stream (log รายการละบรรทัด `time · event · id`) ตาม spec 8
   - ต้องมีตารางข้อความ/สรุปแบบตัวอักษรคู่กับกราฟ (กราฟไม่ใช่ช่องทางเดียวของข้อมูล): `<details>` "ดูค่าดิบ" หรือ `.sr-only` list
3. **WebSocket RTT** (เฉพาะ Node/Python): pill สถานะ `role="status"` (จุด 8px + ข้อความ) สถานะ: `ยังไม่เชื่อมต่อ` (จุด `--sub`) / `กำลังเชื่อมต่อ…` / `เชื่อมต่อแล้ว` (จุด `--brand`, พื้น `--brandsoft`) / `หลุด` (จุด `--err`) · ปุ่ม `ส่ง ping` (pill `--brand`) + `ตัดการเชื่อมต่อ` (pill ขอบ 1.5px `--brand`) · ข้อความ "RTT ล่าสุด **31 ms** · เฉลี่ย 36 ms จาก 20 ครั้ง" · เดสก์ท็อปมีกราฟแท่ง 20 แท่ง (ล่าสุดทึบ 100%, ก่อนหน้า 55%, `role="img"` + ตัวเลขข้อความ) · ping 20 ครั้ง ตาม spec: ส่ง `{"type":"ping","t":<ms>}` รับ `{"type":"pong","t":…}` คำนวณ RTT=`Date.now()-t`
   - บน stack PHP (Apache/Nginx) **ไม่มี WebSocket**: ตรวจจาก `X-Stack` หรือลอง `GET /ws` แล้วถ้าไม่ได้ 101 แสดงการ์ดเป็นสถานะ "stack นี้ไม่รองรับ WebSocket" แทนปุ่ม (ไม่ใช่ error) **[เสนอ]**
4. ส่วน Bandwidth / Caching / API Request / seed (spec 8 ให้ใช้ต่อจาก Tabby) **ไม่มีในบอร์ด** → ใช้ชุด component เดียวกับการ์ดข้างบน (การ์ด + ปุ่ม pill + ไทล์สถิติ + ตาราง) ดู 9

### 4.14 Toast
บอร์ดไม่ได้วาด **[เสนอ]**: `role="status" aria-live="polite"` (error ใช้ `role="alert"`) ลอยกึ่งกลางล่าง เหนือ bottom nav (`bottom: calc(72px + 12px)`), เดสก์ท็อปมุมซ้ายล่างของคอลัมน์กลาง, `min-height:48; padding:0 16px; radius:16; พื้น --ink ตัวอักษร --bg; 14px`, หายเองใน 4 วิ (error 6 วิ, ไม่หายเองถ้า hover/focus), มีปุ่ม "ปิด" 44 ใช้กับ: ไลก์ไม่สำเร็จ, 429 ("ทำรายการเร็วเกินไป ลองใหม่ในอีก {retry_after} วินาที"), 401 ("เซสชันหมดอายุ กรุณาตั้งชื่อใหม่" → เปิด sheet), 5xx ("มีบางอย่างผิดพลาด ลองอีกครั้ง"), อัปโหลดสำเร็จ/ลบสำเร็จ

### 4.15 Empty / error / end states
บอร์ดไม่ได้วาด (spec 4: ต้องมี skeleton ระหว่างโหลด และ empty state เมื่อไม่มีข้อมูล) **[เสนอ copy]**: ตรงกลางการ์ดเดียว padding 32 ข้อความ 16 `--sub` + (ถ้ามี) ปุ่มทำต่อ
| สถานที่ | ข้อความ |
|---|---|
| ฟีดว่าง | "ยังไม่มีโพสต์ในหมู่บ้าน เป็นคนแรกที่โพสต์เลย" |
| แกลเลอรีว่าง | "ยังไม่มีรูปในหมู่บ้าน" (+ "แนบรูปกับโพสต์เพื่อเริ่มต้น") |
| "ของฉัน" ว่าง | "คุณยังไม่ได้อัปโหลดรูป" |
| โปรไฟล์ — โพสต์/รูปว่าง | "ยังไม่มีโพสต์" / "ยังไม่มีรูป" |
| ฟีดโหลดล้มเหลว | "โหลดโพสต์ไม่สำเร็จ" + ปุ่ม "ลองอีกครั้ง" |
| ท้ายรายการ | "ดูครบทุกโพสต์แล้ว" 14 `--sub` กึ่งกลาง |
| 404 path ที่ SPA ไม่รู้จัก | "ไม่พบหน้านี้" + ลิงก์ "กลับไปฟีด" |

---

## 5. Screen by screen

คอลัมน์ "ข้อมูล" ใช้ชื่อฟิลด์ตาม spec หัวข้อ 5. Test hook = `data-testid` ที่เสนอ **[เสนอ]** (spec ไม่ได้กำหนด selector ของ UI)

### 5.1 Feed (`/`) — `Mooban-Feed` · `Mooban-Compose` · `Mooban-Desktop-Feed`
- **เป้าหมาย:** อ่านโพสต์ล่าสุด, โพสต์ข้อความ/รูป, ไลก์, คอมเมนต์, เห็นโพสต์ใหม่สด
- **ส่วน (มือถือ บนลงล่าง):** top bar → live pill (ลอย) → composer ย่อ → รายการ post card → skeleton ท้ายรายการ → bottom nav
- **ส่วน (เดสก์ท็อป):** left nav | คอลัมน์กลาง: h1 "ฟีด" 22/600 (margin-bottom 16), live pill sticky, composer เต็ม, post cards (`margin-top:12`), skeleton | right rail (5.1.1)
- **ข้อมูล:** `GET /api/posts?limit=20[&before]` → `data[]` (`id, body, author{handle,display_name}, image{id,thumb_url,display_url,width,height,alt}|null, like_count, comment_count, liked_by_me, created_at, updated_at`), `next_before`; ส่ง `Authorization: Bearer` ถ้ามี token เพื่อได้ `liked_by_me`
- **Interaction:** composer → 4.3; like → 4.5; คอมเมนต์ → 4.6; SSE → 4.7; เลื่อนต่อ → 6.4; เมนูโพสต์ตัวเอง → 4.4
- **สถานะ:** โหลดแรก = skeleton 3 ใบ · ว่าง/ผิดพลาด/ท้ายรายการ ดู 4.15 · ออฟไลน์/SSE หลุด: EventSource ต่อใหม่เอง (spec) แสดงสถานะ "เชื่อมต่อใหม่…" ใน rail เดสก์ท็อป
- **Copy สำคัญ:** placeholder "วันนี้มีอะไรในหมู่บ้าน" · ปุ่ม "โพสต์" · ตัวนับ `0 / 280` · "มีโพสต์ใหม่ {N} รายการ" · "เขียนความคิดเห็น" · "ส่ง"
- **Test hooks:** `feed`, `composer-input`, `composer-submit`, `composer-count`, `post-card[data-id]`, `like-btn`, `comment-toggle`, `live-pill`, `skeleton`

#### 5.1.1 Right rail เดสก์ท็อป (`Mooban-Desktop-Feed`, 300px)
- การ์ด **"ออนไลน์ตอนนี้ (N)"** — รายชื่อ avatar 36 + `@handle` + จุดเขียว 10px: **spec ไม่มี API presence** → ซ่อนใน v1 หรือแทนด้วย "ผู้ใช้ล่าสุด" **[เสนอ]** อย่าปลอมตัวเลข "ออนไลน์"
- การ์ด **"ภาพล่าสุด"** + ลิงก์ `ดูทั้งหมด` → `/gallery` · กริด 3×2 สี่เหลี่ยมจัตุรัส gap 6 radius 10 ใช้ `GET /api/images?limit=6` (`thumb_url`) แต่ละช่องเป็นลิงก์ `aria-label="เปิดรูป {alt}"`

### 5.2 Compose (มือถือ) — `Mooban-Compose`
รายละเอียดใน 4.3 · ฉาก: เปิดจากแถบ composer ย่อ; `ยกเลิก` กลับฟีด (ถ้ามีข้อความ/รูปค้าง ถามยืนยัน "ทิ้งโพสต์นี้?" **[เสนอ]**); `โพสต์` สำเร็จ → กลับฟีด โพสต์ใหม่อยู่บนสุด (แทรกทันที ไม่ผ่าน pill เพราะเป็นของตัวเอง)
Test hooks: `composer-input`, `composer-attach`, `composer-preview`, `composer-remove-image`, `composer-submit`

### 5.3 Gallery (`/gallery`) — `Mooban-Gallery` · `Mooban-Desktop-Gallery`
- **ข้อมูล:** `GET /api/images?limit=40&before=…[&user=handle]` ใช้ `thumb_url`, `width`, `height`, `alt`, + เจ้าของรูป (ดู 9: spec ตัวอย่าง image ยังไม่มี `author`) · `total` (จาก `GET /api/stats.images`)
- **Interaction:** chip เรียง (4.9) · คลิกรูปเปิด lightbox (4.10) · เลื่อนโหลดต่อ
- **สถานะ:** โหลดแรก = ช่อง `--chip` ตามจำนวนคอลัมน์ (aspect-ratio 1/1 ชั่วคราว 6–8 ช่อง) · ว่าง 4.15
- **Test hooks:** `gallery-grid`, `gallery-tile[data-id]`, `gallery-sort-latest|top|mine`, `lightbox`, `lightbox-prev`, `lightbox-next`, `lightbox-close`, `lightbox-alt-input`, `lightbox-alt-save`, `lightbox-delete`

### 5.4 Lightbox — `Mooban-Lightbox` (มือถือ) / ภายใน `Mooban-Desktop-Gallery`
รายละเอียด 4.10 · ข้อมูล: รายการรูปที่โหลดอยู่แล้วในกริด (`display_url`, `width`, `height`, `format`, `bytes_display`, `alt`, `created_at`) · `{pos} / {total}` = ตำแหน่งในรายการที่โหลด / จำนวนรวม

### 5.5 Profile (`/u/{handle}`) — `Mooban-Profile` · `Mooban-Desktop-Profile`
- **ข้อมูล:** `GET /api/users/{handle}` (display_name, created_at, จำนวนโพสต์/รูป), `GET /api/posts?user={handle}`, `GET /api/images?user={handle}`
- **Right rail เดสก์ท็อป:** การ์ด "คนในหมู่บ้าน" (3 คน avatar 40 + ชื่อ + `@handle` + ลิงก์ `ดู` → โปรไฟล์) **ไม่มี API ผู้ใช้ทั้งหมด** → สร้างจาก author ในฟีดที่โหลดอยู่ **[เสนอ]** หรือซ่อน · การ์ด "สถานะฟีดสด": จุดเขียว + `เชื่อมต่อแล้ว · ความหน่วง {n} ms` + ลิงก์ `ไปหน้าทดสอบระบบ` → `/test` (ความหน่วงมาจากผลวัดล่าสุดในหน้า test เท่านั้น ถ้ายังไม่เคยวัดแสดงแค่ `เชื่อมต่อแล้ว`)
- **ปุ่ม "แก้โปรไฟล์"** และฟิลด์ bio/ยอด "ถูกใจ" ในบอร์ด **ไม่อยู่ใน spec** (ดู 9) → ซ่อนใน v1
- **ปุ่มของตัวเอง:** ในโปรไฟล์ตัวเองแสดงเมนูโพสต์ (4.4); โปรไฟล์คนอื่นไม่แสดง
- **Test hooks:** `profile-header`, `profile-tab-posts`, `profile-tab-photos`, `profile-panel`, `profile-counts`

### 5.6 Signup sheet — `Mooban-Signup`
รายละเอียด 4.12 · Test hooks: `signup-dialog`, `signup-handle`, `signup-display-name`, `signup-msg`, `signup-suggest`, `signup-submit`

### 5.7 Test (`/test`) — `Mooban-Test` · `Mooban-Desktop-Test`
- h1 "ทดสอบระบบ" · คำอธิบาย (เดสก์ท็อป) "ตรวจการประมวลผลรูป การอัปเดตสด และ WebSocket บนโฮสต์นี้"
- ส่วน 1–3 ตาม 4.13; ส่วนชุดทดสอบจาก Tabby (bandwidth/caching/API/seed) ต่อท้ายด้วยการ์ดชุดเดียวกัน (ดู 9)
- **Test hooks:** `test-upload-file`, `test-upload-result`, `test-sse-start`, `test-sse-stats`, `test-ws-status`, `test-ws-ping`, `test-ws-disconnect`

---

## 6. Key flows

### 6.1 First-run signup
เปิดแอป → อ่าน `localStorage.mb_token` (try/catch) → มี: `GET /api/me` (401 → ลบ token, ไป 6.1 ใหม่) → ไม่มี: เปิด sheet 4.12 → ผู้ใช้กรอก → `POST /api/users {handle, display_name}` → 201 `{user, token}` → เก็บ `mb_token` (token แสดงครั้งเดียว) → ปิด sheet · ห้ามใส่ token ใน URL/log · ส่ง `Authorization: Bearer <token>` ทุก request ที่เขียน และทุก `GET /api/posts` เพื่อให้ได้ `liked_by_me`

### 6.2 โพสต์พร้อมรูป
เลือกไฟล์ → (client ตรวจชนิด/ขนาดเบื้องต้น ≤10 MB แต่ **server ตัดสินจริง**) → `POST /api/images` (multipart `file`, `alt` ถ้ามี) → แสดงพรีวิว `thumb_url` + `processing_ms` (ถ้าอยู่ใน /test) → กดโพสต์ → `POST /api/posts {body, image_id}` → 201 โพสต์ → แทรกบนสุดทันที, ล้างฟอร์ม, จำ `id` เพื่อกัน event `post.created` ซ้ำ · ขณะส่งปุ่ม disabled (กันกดซ้ำ) · error → ข้อความใต้ฟอร์ม 4.3 ไม่ล้างข้อมูลที่พิมพ์

### 6.3 Optimistic like + rollback
4.5 · ลำดับ: `before = {liked, count}` → ปรับ UI → request → `ok` ไม่ทำอะไรเพิ่ม (ถ้า response มี `like_count` ให้ sync) / `error` → คืนค่า `before` + toast · 401 → เปิด sheet

### 6.4 Infinite scroll (cursor)
Sentinel `<div>` ท้ายรายการ + `IntersectionObserver({rootMargin:"600px 0px"})` → ถ้า `next_before != null` และไม่ได้กำลังโหลด: แสดง skeleton 1 ใบ → `GET /api/posts?limit=20&before={next_before}` → ต่อท้าย (กันซ้ำด้วย id) → `next_before == null` แสดงข้อความท้ายรายการ · error: หยุด observer + ปุ่ม "ลองอีกครั้ง" · แกลเลอรีใช้วิธีเดียวกัน (`limit=40`)

### 6.5 Live: pill → merge
ต่อ `new EventSource("/api/stream")` ครั้งเดียวต่อแท็บ (เปิดที่หน้าฟีด/แกลเลอรี, ปิดเมื่อ `document.hidden` นาน **[เสนอ]**) ตัวจัดการ event: `post.created` → 4.7 · `post.updated` → แทนข้อความ/รูปที่การ์ดเดิมในที่ (ถ้ามีในฟีด) · `post.deleted` → เอาการ์ดออก (เสนอ: ถ้าการ์ดอยู่เหนือจุดที่กำลังอ่านให้คงความสูงเดิมด้วยช่องว่าง/แทนด้วยบรรทัด "โพสต์นี้ถูกลบแล้ว" เพื่อไม่ให้เนื้อหากระโดด) · `like.changed`/`comment.*` → ตัวเลขทันที (4.5, 4.6) · `resync` → โหลดฟีดหน้าแรกใหม่ล้าง pending · บนเว็บ 429 ที่ `/api/stream` (เกิน 10 stream/IP) → สถานะ "เชื่อมต่อสดไม่ได้ (มีการเชื่อมต่อมากเกินไป)" และไม่ retry รัว (ใช้ backoff) · ห้ามยุ่ง `retry:`/Last-Event-ID (browser จัดการเอง)

### 6.6 Gallery → lightbox
คลิก tile → เปิด lightbox ที่ index นั้น → เปลี่ยนรูปด้วยปุ่ม/ลูกศร/ปัด → เจ้าของแก้ alt (`PATCH`) หรือลบ (`DELETE`, อัปเดตกริด+total) → ปิดคืน focus 4.10

### 6.7 แก้/ลบโพสต์ของตัวเอง
เมนู ⋯ (เฉพาะ `author.handle === me.handle`) → แก้: inline textarea (≤280 code point; ต้องไม่ว่างถ้าไม่มีรูป) → `PUT /api/posts/{id} {body}` → 200 อัปเดตการ์ด · ลบ: dialog ยืนยัน → `DELETE /api/posts/{id}` → 204 เอาการ์ดออก (รูปของโพสต์ถูกลบด้วยฝั่ง server) · ผู้อื่นลอง → 403 `not_owner` (ไม่ควรเกิดเพราะ UI ไม่แสดงปุ่ม)

### 6.8 /test
- **อัปโหลดรูป:** เลือกไฟล์ → `POST /api/images` → แสดงผล `processing_ms/format/bytes` + เวลาทั้งหมด (วัดฝั่ง client: `performance.now()` ก่อน/หลัง) → เพิ่มแถวในประวัติ (เก็บในหน่วยความจำเท่านั้น หายเมื่อรีเฟรช — ใช้ `sessionStorage` ได้ **[เสนอ]**)
- **Realtime:** ต้องเชื่อม stream อยู่ → 10 รอบ `POST /api/test/emit` (header `X-Test-Token` ต้องมี: ให้กรอก token ในช่อง "Test token" ของหน้านี้ **[เสนอ]** เก็บเฉพาะใน `sessionStorage`) → จับเวลาจนเห็น `test.ping` nonce ตรง (timeout 5 วิ) → ผล มัธยฐาน/p95/ตกหล่น + เส้นกราฟ
- **WebSocket:** เชื่อม `/ws` (ต้อง 101) → 20 ping → ค่าเฉลี่ย/ล่าสุด · idle ไม่ส่งอะไร (spec: ไม่ปิดเอง ไม่ ping เอง) เพื่อเห็นว่า proxy ตัดตอนไหน แสดง "หลุดหลังเชื่อมต่อ {n} วินาที"

---

## 7. Responsive, dark mode, motion, a11y

### 7.1 Responsive
ตามหัวข้อ 3.1 · ทดสอบที่ 360, 390, 720, 1100, 1280, 1440 · ฟอร์ม/ปุ่มห้ามเล็กกว่า 44px ที่ทุกขนาด · `viewport` meta `width=device-width, initial-scale=1` (ห้ามปิดซูม) · `env(safe-area-inset-*)` สำหรับ bottom nav/sheet

### 7.2 Dark mode
ใช้ตัวแปร CSS เท่านั้น (2.2) ห้ามเขียนสี hex ใน component ยกเว้นกลุ่มที่ตั้งใจตายตัว (avatar พาสเทล, lightbox มือถือ, ป้ายบนรูป) · `color-scheme: light dark` ให้ control ของเบราว์เซอร์ (scrollbar, file input) ตามธีม · รูปจากผู้ใช้ไม่ปรับสี (อาจใช้ `filter:brightness(.92)` เบาๆ ใน dark **[เสนอ]**) · ไม่มีปุ่มสลับธีมใน v1 (spec: ตามระบบ)

### 7.3 Contrast (คำนวณแล้ว WCAG 2.x, ข้อความปกติ ≥4.5:1, ส่วนประกอบ UI ≥3:1)
| คู่สี | Light | Dark |
|---|---|---|
| `--ink` บน `--bg` / `--card` | 14.47 / 15.77 | 15.99 / 14.21 |
| `--sub` บน `--card` / `--bg` / `--chip` | 6.11 / 5.60 / 5.23 | 7.77 / 8.74 / 6.88 |
| `--onbrand` บน `--brand` (ปุ่มหลัก) | 5.32 | 8.45 |
| `--brand` บน `--card` / `--bg` (ลิงก์, ไลก์) | 5.32 / 4.88 | 7.51 / 8.45 |
| `--err` บน `--card` | 6.54 | 7.10 |
| `--warn` บน `--card` | 5.43 | 8.68 |
| **`--brand` บน `--brandsoft`** | **4.44 ✗** → ใช้ `--brand-strong` (5.83 ✓) | 5.74 ✓ |
| `--field-border` บน `--card` | 3.64 ✓ (ขอบ `--line` เดิม 1.25 ✗) | `#667D6D` บน `#18231C` 3.64 ✓ |
- ข้อความ/ไอคอนสถานะห้ามสื่อด้วยสีอย่างเดียว (ไลก์ = `aria-pressed` + ไอคอนเติมสี, error = ข้อความ + ไอคอน, สถานะ WS = ข้อความ + จุด)
- ปุ่ม disabled (พื้น `--chip`, ตัวอักษร `--sub`) เป็นข้อยกเว้นของ WCAG แต่ยังอ่านได้ 5.23:1

### 7.4 Motion
ทรานซิชันสั้น ≤150ms (`background-color, color, transform`) ใช้กับ hover/press; pill/sheet/lightbox เฟด/สไลด์ ≤200ms · `@media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation-duration:.01ms !important; transition-duration:.01ms !important; scroll-behavior:auto !important } }` และไม่ทำ shimmer/สไลด์ · ห้ามมีอนิเมชันที่ขยับเลย์เอาต์ของรายการ (กัน CLS)

### 7.5 Semantics / a11y รวม
- `lang="th"`; landmark: `<header>`, `<nav aria-label="เมนูหลัก">`, `<main id="main">`, `<aside aria-label="ข้างเคียง">`; ลิงก์ข้ามไปเนื้อหา "ข้ามไปที่เนื้อหา" (ซ่อนจนกว่าโฟกัส) **[เสนอ]**
- เปลี่ยน route: อัปเดต `document.title` ("ฟีด · Mooban", "แกลเลอรี · Mooban", "@{handle} · Mooban", "ทดสอบระบบ · Mooban"), ย้าย focus ไป `<h1 tabindex="-1">` และประกาศใน live region
- ทุก input มี `<label>`; ปุ่มไอคอนมี `aria-label`; รูปมี `alt` (alt ของรูป หรือ "รูปจาก @handle"); ข้อความผู้ใช้ใส่ด้วย `textContent`/escape เสมอ (spec: escape ทุกช่อง) ห้าม `innerHTML` กับข้อมูลผู้ใช้
- ทุกอย่างใช้ keyboard ได้ (Tab ลำดับตามภาพ, Enter/Space บนปุ่ม, Esc ปิด overlay, ลูกศรใน tablist/lightbox)

---

## 8. Checklist สำหรับ Claude Code

### 8.1 ไฟล์
```
public/
  index.html        # skeleton, <svg> sprite, <meta viewport>, <script type=module src=/app.js>, CSP ส่งจาก server (ไม่ใช้ inline script/style)
  style.css         # tokens (2.2) + base + components (4) + layout (3) + utilities (.sr-only)
  app.js            # entry: router, state, boot
  js/api.js         # fetch wrapper: base, Authorization, error mapping (401/403/422/429/5xx)
  js/router.js      # History API, route table, link interception
  js/store.js       # me, token (mb_token), posts, pending, sse state
  js/sse.js         # EventSource + dispatch
  js/ui/*.js        # post-card, composer, comments, gallery, lightbox, signup, toast, test-cards
  js/util.js        # timeAgo(), codePointLength(), escape, avatarColor(handle), formatBytes()
  robots.txt
```
ข้อจำกัด: **ไม่มี inline `<script>`/`<style>`/handler attribute** (CSP `default-src 'self'` บล็อก) · ไม่มี CDN/ฟอนต์ภายนอก · `img-src 'self' data:` เท่านั้น · ไม่มี `eval`/`new Function` · `style="aspect-ratio:…"` แบบ inline attribute โดนบล็อกโดย CSP `style-src` เริ่มต้น → ตั้งผ่าน JS (`el.style.aspectRatio = …`) หรือ `setAttribute` ไม่ได้ผลกับ CSP ให้ใช้ CSSOM (`el.style.…`) ซึ่งไม่โดนบล็อก (ถ้า server ใส่ `style-src 'self' 'unsafe-inline'` ก็ผ่านแต่หลีกเลี่ยง)
ฟังก์ชันเวลา `timeAgo(iso, {long})`: <1 นาที "เมื่อครู่" · `{n} นาที` · `{n} ชม.` · "เมื่อวาน" · `{n} วัน` (บอร์ดฟีดใช้รูปสั้นไม่มี "ที่แล้ว"; โปรไฟล์/lightbox ใช้รูปยาว `…ที่แล้ว`) ห่อด้วย `<time datetime="{ISO UTC}">` · "เข้าหมู่บ้านเมื่อ {เดือนย่อ ไทย} {พ.ศ.}" ด้วย `Intl.DateTimeFormat("th-TH-u-ca-buddhist",{month:"short",year:"numeric"})` · เวลาแสดงตามเขตเวลาเครื่อง (spec)
Avatar อักษร: grapheme แรกของ `display_name` (`Intl.Segmenter` ถ้ามี ไม่งั้นตัวแรก)

### 8.2 ลำดับงาน
1. `index.html` + sprite ไอคอน + `style.css` ส่วน tokens/base/layout (3 breakpoint) + shell (nav ทั้งสองแบบ) — เปิดดูทุกขนาด/สองธีม
2. `api.js` + `router.js` + `store.js`; หน้าเปล่า 4 route + 404; ทดสอบ rewrite (เปิด `/gallery`, `/u/x` ตรงๆ แล้วรีเฟรชต้องได้แอป)
3. Signup sheet (4.12) + `mb_token` + `GET /api/me`
4. ฟีดอ่านอย่างเดียว: post card, skeleton, infinite scroll, empty/error
5. Composer + อัปโหลดรูป + พรีวิว; แล้ว like (optimistic), comments, แก้/ลบโพสต์
6. SSE: `sse.js` + live pill + อัปเดตตัวเลขสด + resync
7. แกลเลอรี masonry + lightbox (focus trap)
8. โปรไฟล์ + tablist
9. `/test`: อัปโหลด, realtime, WebSocket (+ ชุด Tabby ใน 9)
10. Toast, empty states, dark mode QA, a11y/perf pass

### 8.3 Acceptance checks (ต้องผ่านทั้งก่อนปิดงาน)
- [ ] **Contrast ≥ 4.5:1** (ข้อความ) และ ≥ 3:1 (ขอบ/ไอคอนสำคัญ) ทั้ง light และ dark — วัดซ้ำตามตาราง 7.3 รวมสถานะ hover/disabled/focus
- [ ] **เป้าสัมผัส ≥ 44×44** ทุกปุ่ม/ลิงก์/chip/แท็บ (ตรวจด้วย script วนวัด `getBoundingClientRect` ของ `a,button,input,select,textarea,[role=tab]`)
- [ ] **CLS ≈ 0**: รูปในฟีด/แกลเลอรีมี width/height/aspect-ratio ก่อนโหลด; live pill ไม่ขยับเนื้อหา; skeleton สูงใกล้การ์ดจริง; วัดด้วย Lighthouse/PerformanceObserver `layout-shift` ขณะเลื่อนและตอน SSE เข้า
- [ ] **Keyboard ครบ:** Tab ทั่วทั้งหน้า, โฟกัสเห็นชัด, Esc ปิด lightbox/dialog/เมนู, focus trap + คืนโฟกัส, tablist ด้วยลูกศร, ปุ่มไลก์ Space/Enter
- [ ] **≥ 360px**: ไม่มี horizontal scroll, ไม่มีข้อความตัด/ทับ, bottom nav ไม่บังเนื้อหาท้ายหน้า
- [ ] **Screen reader:** live pill ประกาศแบบ polite, `aria-pressed`/`aria-expanded`/`aria-current`/`aria-modal` ถูกต้อง, รูปมี alt, กราฟมี `role=img` + ข้อมูลข้อความคู่
- [ ] **CSP จริง:** ส่ง `Content-Security-Policy: default-src 'self'; img-src 'self' data:` แล้วคอนโซลไม่มี violation (ไม่มี inline script/style/ฟอนต์ภายนอก)
- [ ] **ข้อมูล:** ไม่ใช้ `innerHTML` กับข้อมูลผู้ใช้; นับ 280 ตัวเป็น code point (ทดสอบข้อความไทยยาว 281 → ถูกปฏิเสธฝั่ง server 422 และ UI แสดง `fields.body`)
- [ ] **Behavior ตาม spec:** optimistic like ย้อนกลับเมื่อ error · pill ไม่แทรกเอง · ตัวนับไลก์/คอมเมนต์ขยับสดโดยไม่ต้องกด · SSE ต่อใหม่เองและ `resync` ล้างฟีด · `localStorage` ล้มไม่ทำให้แอปพัง
- [ ] **ทดสอบกับ 4 stack** ด้วยไฟล์หน้าเว็บชุดเดียวกัน (byte-identical) — ต่างกันแค่ `X-Stack`; บน PHP การ์ด WebSocket แสดงสถานะ "ไม่รองรับ" ไม่ใช่ error
- [ ] **Reduced motion** ปิด shimmer/สไลด์เมื่อผู้ใช้ตั้งค่า

---

## 9. ข้อต่างระหว่างบอร์ดกับ spec และช่องว่างที่ต้องตัดสินใจ

| # | เรื่อง | บอร์ด | Spec | ข้อเสนอ |
|---|---|---|---|---|
| 1 | ฟอนต์ | Prompt/Noto (Google Fonts) | ฟอนต์ระบบ + CSP `'self'` | ใช้ system stack (2.1) |
| 2 | ช่อง "ชื่อที่แสดง" ตอนสมัคร | ไม่มี (มีแค่ handle) | `display_name` 1–50 ตัว บังคับ | เพิ่มช่องในสไตล์เดียวกัน |
| 3 | bio, ปุ่ม "แก้โปรไฟล์", ยอด "ถูกใจ" ในโปรไฟล์ | มี | ไม่มีใน users (มี handle, display_name, created_at) และไม่มี endpoint แก้โปรไฟล์ | ซ่อนใน v1; สถิติแสดงเฉพาะ โพสต์/รูป (ถ้าจะมี "ถูกใจ" ต้องเพิ่มใน API) |
| 4 | "ออนไลน์ตอนนี้", "คนในหมู่บ้าน" ใน right rail | มี | ไม่มี presence/รายชื่อผู้ใช้ | ซ่อน หรือสร้างจาก author ที่โหลดอยู่ |
| 5 | เรียงแกลเลอรี "ถูกใจมากสุด" | มี | `GET /api/images` เรียงใหม่สุดก่อนเท่านั้น และรูปไม่มี like | ซ่อนใน v1 (หรือขยาย API) |
| 6 | เจ้าของรูป (`@handle` บนไทล์ / lightbox) | มี | ตัวอย่าง image object ไม่มี `author` | ขอเพิ่ม `author{handle}` ให้ image ใน `GET /api/images` และใน lightbox (non-breaking); ถ้าไม่เพิ่ม รูปในแกลเลอรีไม่ทราบเจ้าของ จึงตัดสิทธิ์แก้ alt/ลบรูปไม่ได้ (ใช้ `GET /api/images?user={me}` ระบุว่าเป็นของตัวเอง) |
| 7 | ปุ่ม "เริ่มทดสอบ 30 วินาที" | มี (เดสก์ท็อป) | "วัด latency 10 ครั้ง" | ใช้ตาม spec |
| 8 | เปรียบเทียบ "Thumbnail JPEG → WebP" | มี | API ไม่ส่งขนาด JPEG | คำนวณฝั่ง client หรือซ่อน |
| 9 | มือถือ: composer แบบเต็มหน้า | หน้า `Mooban-Compose` | ไม่ระบุ route | ทำเป็น overlay เต็มจอ ไม่เพิ่ม path |
| 10 | ชุดทดสอบ Bandwidth / Caching / API Request / seed บน `/test` | ไม่มี | ต้องมี (spec 8, ใช้ต่อจาก Tabby) | สร้างการ์ดตาม component ของ 4.13 ให้ตรงกับ UI ของ `DESIGN-tabby.md` (ถ้ามี) — Mooban ต้องใช้ endpoint ชุดเดิม + `X-Test-Token` |
| 11 | เมนูโพสต์ (แก้/ลบ), ลบคอมเมนต์, ยืนยันลบ, toast, empty/error state | ไม่มี | แก้/ลบโพสต์/คอมเมนต์ได้ (spec 4–5); skeleton + empty state ต้องมี | ทำตาม 4.4, 4.6, 4.14, 4.15 (ป้าย [เสนอ]) |
| 12 | ปุ่ม delete ของ lightbox เดสก์ท็อป ใช้ `#B3261E` ตายตัว | | | ใช้ `var(--err)` (dark ผ่าน contrast) |
| 13 | สีข้อความ brand บน `--brandsoft` (avatar, nav active) | 4.44:1 | | ใช้ `--brand-strong` |
| 14 | ขอบ input `--line` | 1.25:1 | | ใช้ `--field-border` |

คำถามที่ต้องให้พี่เอิร์ธตัดสิน: (ก) ข้อ 3/4/5 จะ "ซ่อน" หรือ "ขยาย API" · (ข) ข้อ 6 อนุมัติให้เพิ่ม `author` ใน image API หรือไม่ · (ค) ข้อ 1 ต้องการ self-host ฟอนต์ให้ใกล้บอร์ดหรือคง system fonts ตาม spec ทุกตัวอักษร
