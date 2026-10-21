# Mooban · หมู่บ้าน

**โซเชียลมีเดียขนาดหย่อม** สำหรับทดสอบ Shared Web Hosting (SWH): โพสต์ข้อความและรูป ไลก์ คอมเมนต์ แกลเลอรี และเห็นโพสต์ใหม่แบบสดโดยไม่ต้องรีเฟรช — เขียนซ้ำ **4 เวอร์ชัน** ให้พฤติกรรมเหมือนกันทุกประการ เพื่อให้ความต่างของผลทดสอบมาจาก stack ไม่ใช่จากโค้ด

| Stack | Runtime | เสิร์ฟ `/media` | Realtime |
|---|---|---|---|
| **Apache + PHP** | PHP 8.3 + PDO + GD | Apache (ไฟล์ตรง) | SSE (1 stream = 1 PHP worker) |
| **Nginx + PHP-FPM** | โค้ด PHP ชุดเดียวกัน | Nginx (ไฟล์ตรง) | SSE |
| **Node + Express** | Node 22 + mysql2 + sharp | แอปเสิร์ฟเอง | SSE (poll loop เดียวกระจายทุก client) + WebSocket |
| **Python + Flask** | Python 3.12 + PyMySQL + Pillow | แอปเสิร์ฟเอง | SSE (1 stream = 1 thread) + WebSocket* |

\* WebSocket ของ Python กำลังพัฒนา (ดู [สถานะ](#สถานะ))

หน้าเว็บเป็น **SPA vanilla JS + CSS ล้วน** ไม่มี framework ไม่มี build step ไฟล์ชุดเดียวกัน byte ต่อ byte บนทุก stack, ภาษาไทยทั้งหมด, รองรับ dark mode ตามระบบ, ใช้ได้ตั้งแต่จอกว้าง 360px และผ่าน CSP `default-src 'self'; img-src 'self' data:`

---

## สิ่งที่ Mooban ใช้ทดสอบบน SWH

- **อัปโหลดและประมวลผลรูป** — เพดาน upload, CPU/RAM ตอนแปลงรูป (ถึง 24 MP), WebP vs JPEG fallback, โควตาดิสก์
- **ไฟล์ static จำนวนมาก** — `Cache-Control: immutable`, ETag/304, ความเร็วเมื่อ web server เสิร์ฟเทียบกับแอปเสิร์ฟ
- **Connection ค้างนาน (SSE)** — proxy buffer หรือไม่, กิน worker กี่ตัว, ตัด connection ที่กี่วินาที
- **WebSocket** — proxy ส่งต่อ `Upgrade` ได้ไหม และตัด connection ที่เงียบตอนไหน
- **Rewrite rule ของ SPA**, ล็อกอินด้วย token, rate limit ต่อผู้ใช้/ต่อ IP
- ชุดเดิมจาก Tabby: Bandwidth (download/upload ดิบ), Caching, API Request + Load test

ทุกอย่างวัดได้จากหน้า **`/test`** ในแอป

## โครงสร้าง repo

```
mooban/
├── shared/
│   ├── public/          SPA ชุดเดียว (index.html, app.js, style.css, js/…, sample.jpg)
│   ├── schema.sql       8 ตาราง InnoDB utf8mb4 — ใช้ร่วมทุก stack
│   └── seed-texts.json  ข้อความตัวอย่างสำหรับ seed
├── php/                 โค้ด PHP ชุดเดียว (Apache และ Nginx)
│   ├── public/          api.php, .htaccess, media/.htaccess
│   └── src/             Router, Http, Db, Images, Routes/…
├── nginx/               nginx-snippet.conf (วางในช่องตั้งค่าโดเมนของ SWH)
├── node/                Express app (app.js, src/, .env.sample)
├── python/              Flask app (app.py, passenger_wsgi.py, mooban/, .env.sample)
├── dev/                 Docker Compose สำหรับรันทั้ง 4 stack ในเครื่อง
├── tests/
│   ├── contract/        HTTP contract suite ชุดเดียว — รันกับทุก stack
│   ├── e2e/             Playwright (มือถือ, desktop, dark, 360px)
│   └── unit/            ฟังก์ชันบริสุทธิ์ฝั่งหน้าเว็บ
├── tools/               make-test-images.py (สร้างรูปทดสอบ 9 แบบ)
├── design-handoff/      สเปค UI, design tokens, บอร์ดอ้างอิง
└── docs/                แผนการ implement
```

## เริ่มรันในเครื่อง

ต้องมี **Docker Desktop**, **Node.js ≥ 22** และ **Python 3** (สำหรับสคริปต์สร้างรูปทดสอบ)

```bash
npm install
npx playwright install chromium
bash dev/assemble.sh          # ประกอบ docroot ของ Apache
bash dev/assemble.sh nginx    # ประกอบ docroot ของ Nginx
docker compose -f dev/docker-compose.yml up -d --build
```

| Stack | URL | Database |
|---|---|---|
| Apache + PHP | http://localhost:8081 | `mb_apache` |
| Nginx + PHP-FPM | http://localhost:8082 | `mb_nginx` |
| Node + Express | http://localhost:8083 | `mb_node` |
| Python + Flask | http://localhost:8084 | `mb_python` |
| MySQL 8 | `127.0.0.1:3307` (user `mb` / `mb`) | — |

Test token สำหรับ dev: `dev-test-token-0123456789abcd` (ใส่ในช่อง Test token ของหน้า `/test`)

## การทดสอบ

**Contract suite** ชุดเดียวเป็นนิยามของคำว่า "เหมือนกัน" — stack ไหนผ่านครบแปลว่าพฤติกรรมตรงกัน

```bash
# ตัวอย่าง: Node
BASE_URL=http://localhost:8083 STACK=node DB_NAME=mb_node SERVICE=node \
MEDIA_DIR_IN_CONTAINER=/data/media MSYS_NO_PATHCONV=1 npm run test:contract

# เทสต์ SSE ที่ต้องรอนาน (40–60 วินาที)
SLOW=1 BASE_URL=http://localhost:8083 STACK=node DB_NAME=mb_node node --test tests/contract/stream.test.mjs
```

```bash
npm run test:unit                 # unit tests ของหน้าเว็บ
npx playwright test               # e2e (ค่าเริ่มต้นยิงที่ Apache :8081)
E2E_BASE=http://localhost:8083 E2E_DB=mb_node E2E_STACK=node npx playwright test tests/e2e/test-page.spec.mjs
```

e2e ครอบคลุมเกณฑ์รับงาน: ปุ่มกดได้ ≥ 44×44px, contrast ≥ 4.5:1 ทั้งสองธีม, ไม่มี horizontal scroll ที่ 360px, CLS < 0.02, ไม่มี CSP violation และเคารพ reduced motion

## Deploy บน DirectAdmin (สรุป)

1. สร้างโดเมนย่อย `apache`, `nginx`, `node`, `python` พร้อม SSL
2. สร้าง MySQL database แยกต่อ stack แล้วรัน `shared/schema.sql`
3. คัดลอก `shared/public/*` ไปไว้ใน document root ของแต่ละ stack
4. **PHP:** อัปโหลด `php/public/*` + `php/src` และสร้าง `config.php` จาก `config.sample.php` (นอก document root, สิทธิ์ 600)
5. **Nginx:** วาง `nginx/nginx-snippet.conf` ในช่อง custom config ของโดเมน (แก้บรรทัด `fastcgi_pass` ให้ตรงเครื่อง)
6. **Node / Python:** ตั้งค่าจาก `.env.sample`, ติดตั้ง dependency แล้วเริ่มแอปตามวิธีที่ SWH รองรับ (Python ใช้ `passenger_wsgi.py`)
7. Smoke test: `GET /api/ping` ได้ 200 + `X-Stack` ถูก, เปิด `/u/test` ตรงๆ แล้วได้หน้าเว็บ

## สถานะ

| ส่วน | สถานะ |
|---|---|
| Schema, รูปทดสอบ, contract harness | ✅ |
| PHP (Apache + Nginx) | ✅ ผ่าน contract suite ครบ |
| หน้าเว็บ (ฟีด, composer, ไลก์/คอมเมนต์, SSE, แกลเลอรี, lightbox, โปรไฟล์, `/test`) | ✅ ผ่าน e2e + acceptance ครบ |
| Node + Express (รวม WebSocket) | ✅ ผ่าน contract suite ครบใน container |
| Python + Flask (CRUD, รูป, SSE, เครื่องมือ, seed) | ✅ |
| Python WebSocket | 🔄 กำลังพัฒนา |
| `tools/sse-load.js`, `RESULTS.md`, คู่มือ deploy ฉบับเต็ม | ⏳ |

## หลักการที่ทุก stack ยึดเหมือนกัน

- ความยาวข้อความนับเป็น **Unicode code point** หลังตัดช่องว่างหัวท้ายด้วยชุดอักขระเดียวกับ `String.prototype.trim` ของ JS
- Token เก็บเฉพาะ **SHA-256** ใน DB, ไม่ log token หรือ header `Authorization`
- ทุกการเขียนที่มี event ทำใน transaction เดียว โดย INSERT ของ event เป็นคำสั่งสุดท้ายก่อน COMMIT
- รูปตรวจชนิดจาก magic bytes, ตรวจจำนวน pixel จาก header ก่อนถอดรหัส, ถอดรหัสแล้วเข้ารหัสใหม่ทุกครั้ง (ลบ EXIF/GPS) และเขียนไฟล์แบบ atomic
- Error 500 ตอบ `{"error":"server_error"}` เท่านั้น ไม่มี stack trace

---

ข้อมูลทั้งหมดในระบบเป็นข้อมูลจำลอง · ใช้สำหรับทดสอบ hosting เท่านั้น (`robots.txt` = `Disallow: /`)
