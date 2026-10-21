# Mooban · สรุปผลทดสอบ

เอกสารนี้มี 3 ส่วน: (1) แบบฟอร์มสรุปผล SWH ตามสเปค §11 (เว้นว่างรอกรอกตอนรันบน Shared Web Hosting) (2) ผล baseline ที่วัดจริงใน Docker dev (3) หมายเหตุการ implement ต่อ stack — วิธีติดตั้งและทดสอบดู [DEPLOY.md](DEPLOY.md)

## 1. แบบฟอร์มสรุปผล (SWH)

กติกา: ทดสอบทั้ง 4 stack ช่วงเวลาเดียวกัน ใช้ client และเครือข่ายเดียวกัน ทดสอบซ้ำจากอย่างน้อย 2 ที่ตั้ง/ISP ทุกการวัดรัน 3 รอบ บันทึกค่ามัธยฐาน และจดวันที่ เวลา เวอร์ชัน runtime และโหมด web server

วันที่/เวลา/ที่ตั้งของการรัน: _ยังไม่ได้รันบน SWH_

| รายการ | Apache | Nginx | Node | Python |
|---|---|---|---|---|
| เวอร์ชัน runtime | | | | |
| โหมด web server ที่พบ | | | | |
| F1 ถึง F10 ผ่านครบหรือไม่ (F11 เฉพาะ Node และ Python) | | | | |
| ไลบรารีรูปที่ใช้ และ format ที่ได้ | | | | |
| I1 ถึง I6 ผ่านครบหรือไม่ | | | | |
| processing_ms ของ 12 MP (ms) | | | | |
| processing_ms ของ 24 MP (ms หรือสาเหตุที่ล้ม) | | | | |
| อัปโหลด 12 MP พร้อมกัน 3 ครั้ง (วินาที และล้มกี่ครั้ง) | | | | |
| ความเร็วเสิร์ฟ thumbnail (request ต่อวินาที, p95) | | | | |
| R1 ถึง R5, R7, R8 ผ่านครบหรือไม่ | | | | |
| event มาสดหรือมาเป็นก้อน (ถูก buffer หรือไม่) | | | | |
| Latency ของ event มัธยฐาน และ p95 (ms) | | | | |
| เปิด stream พร้อมกันได้สูงสุด (R6) และจุดที่เริ่มมีปัญหา | | | | |
| WebSocket: ได้ 101 หรือไม่, RTT มัธยฐาน, ถูกตัดที่กี่วินาที (R9) | | | | |
| P1: app time p95 ของการอ่านฟีด (ms) | | | | |
| P2 และ P3 ผ่านหรือไม่ | | | | |
| ผลชุดพื้นฐาน (B1) | | | | |
| ปัญหาที่พบ | | | | |

หมายเหตุที่ต้องจดตอนกรอกแถว "ผลชุดพื้นฐาน (B1)", "เปิด stream พร้อมกันได้สูงสุด (R6)" และ "ปัญหาที่พบ" ดูข้อ 3

## 2. Local dev baseline (Docker)

วัดจากเครื่อง dev (Windows 11, Docker Desktop) วันที่ 2026-10-21 ถึง 22 ทุก stack อยู่บนเครื่องเดียวกัน ยิงจาก host ผ่าน `localhost` — **เป็นค่าอ้างอิงว่าโค้ดทำงานถูก ไม่ใช่ตัวเลขเปรียบเทียบกับ SWH**

Runtime ใน container: Apache 2.4.68 + `php:8.3-apache` (PHP 8.3.35), Nginx 1.27.5 + `php:8.3-fpm`, Node v22.23.3, Python 3.12.15 + gunicorn (gthread, 1 worker x 32 thread), MySQL 8.0.46

| รายการ | Apache | Nginx | Node | Python |
|---|---|---|---|---|
| Contract suite (`npm run test:contract`) | 71 pass / 0 fail / 11 skip | 70 pass / 0 fail / 12 skip | 77 pass / 0 fail / 5 skip | 77 pass / 0 fail / 5 skip |
| `SLOW=1` stream (R3 idle 40 s, R4 ปิดที่ 60 s) | R3 และ R4 ผ่าน (10 pass / 1 skip) | R3 และ R4 ผ่าน (10 pass / 1 skip) | ผ่าน (11 pass / 0 skip) | ผ่าน (11 pass / 0 skip) |
| ไลบรารีรูป / format | GD (`imagewebp`) / WebP | GD (`imagewebp`) / WebP | sharp / WebP | Pillow / WebP |
| processing_ms ของ `test-12mp.jpg` (3 รอบ, มัธยฐาน) | 712 (712, 472, 794) | 705 (705, 621, 895) | 227 (215, 269, 227) | 442 (442, 369, 630) |
| processing_ms ของ `test-24mp.jpg` (3 รอบ, มัธยฐาน) | 887 (991, 866, 887) | 844 (833, 953, 844) | 213 (224, 213, 209) | 1161 (738, 1807, 1161) |
| SSE `retry:` บรรทัดแรก p50 / p95 (ms) — 5 stream | 145.6 / 217.6 | 65.5 / 139.1 | 39.7 / 116.1 | 52.5 / 125.4 |
| SSE emit ถึง `test.ping` p50 / p95 (ms) — 5 stream | 957.5 / 991.8 | 986.8 / 987.0 | 971.4 / 971.6 | 978.3 / 990.8 |
| WebSocket | skip (ไม่มี `/ws`) | skip (ไม่มี `/ws`) | 101, RTT มัธยฐาน 0.48 ms (ping 20 ครั้ง) | 101, RTT มัธยฐาน 1.09 ms (ping 20 ครั้ง) |

Unit และเครื่องมือ: `npm run test:unit` 32 pass / 0 fail; `npm run test:tools` 3 pass / 0 fail

E2E (Playwright): เต็มชุดบน Apache `:8081` = 378 pass / 0 fail / 24 skip; smoke (`shell`, `feed`, `test-page`) บน Nginx / Node / Python = 71 pass / 0 fail / 7 skip ต่อ stack

Byte-identical: ไฟล์ทั้ง 40 ไฟล์ใน `shared/public` ตรงกันทุกไฟล์กับที่ Apache, Nginx, Node, Python เสิร์ฟผ่าน HTTP และกับ `build/php/public_html`, `build/php-nginx/public_html` (0 mismatch)

### อ่านตัวเลขอย่างไร

- emit ถึง ping ใกล้ 1,000 ms ทุก stack เพราะแต่ละ stack อ่าน events ทุก `SSE_POLL_MS` = 1000 ms — เป็นพฤติกรรมตามสเปค ไม่ใช่ความช้า
- ค่า skip ที่คาดไว้: `I3b` (บังคับ JPEG fallback) รันเฉพาะ Apache; `R7b` (slot หลุดเร็ว) รันเฉพาะ Node/Python (ดู R13a); `R3`/`R4` รันเมื่อตั้ง `SLOW=1`; สองเทสต์ upload-abort รันเฉพาะ Node แบบ host ที่ตั้ง `NODE_TMPDIR_HOST` (ไม่ได้รันในรอบ container นี้); `ws:*` รันเฉพาะ Node/Python
- ครั้งแรกที่ตรวจ byte-identical พบ `build/php-nginx/public_html` ค้างของเก่า (ไม่มี `app.js`, `js/`, `style.css` และ `index.html` ล้าสมัย) ทำให้ Nginx dev เสิร์ฟหน้าเว็บเก่า — เป็นผลของ build ที่ไม่ได้ประกอบใหม่ ไม่ใช่ข้อผิดพลาดของแอป แก้ด้วย `bash dev/assemble.sh nginx` แล้วตรวจซ้ำได้ 0 mismatch (`build/` อยู่ใน `.gitignore`) ให้รัน `assemble.sh` ทั้งสองแบบทุกครั้งก่อนทดสอบ
- ยังไม่ได้วัดใน dev: I8, I10, R2, R6 เต็มระดับ (5/10/20/50), R9 ค้าง 5 นาที, P1, B1 — ต้องวัดบน SWH ตาม [DEPLOY.md](DEPLOY.md)

## 3. Implementation notes per stack

### ทุก stack

- **/upload ถูกจำกัดที่ประมาณ 12 MiB (R30)** — สเปค §9 ตั้ง body limit ระดับ server ราว 11-12 MB บนทุก stack และ contract test บังคับว่า 14 MB ต้องได้ 413 ดังนั้นแถว B1 ที่ทดสอบ 100 MB ให้จด "ขนาดที่ใหญ่ที่สุดที่ผ่าน" แทนผ่าน/ไม่ผ่าน
- **R6 ต้องตั้ง `MAX_STREAMS_PER_IP` เป็น 100 ชั่วคราว** ตลอดการรัน `tools/sse-load.js` (5+10+20+50 = 85) แล้วคืนเป็น 10 ก่อน R7 (ขั้นตอนใน [DEPLOY.md](DEPLOY.md) ข้อ 9)
- ตัวเลข emit ถึง ping ถูกจำกัดด้วย `SSE_POLL_MS` (1000 ms) ทุก stack

### Apache และ Nginx (PHP)

- **1 stream = 1 PHP worker** และ slot ต่อ IP ของ stream ที่ client ตัดไปแล้วจะถูกคืนเมื่อ **การเขียน ping ครั้งถัดไปล้มเหลวเท่านั้น** ประมาณ 60-70 วินาที (R13/R13a) — ไม่มีการเขียน byte ว่างถี่ๆ เพื่อตรวจการหลุด เพราะจะทำให้ connection ที่เงียบดูเหมือนยังมีกิจกรรม แล้วบังผล idle-timeout ของ proxy บน SWH ที่สเปคต้องการวัด (ping มีทุก 15 วินาทีตามสเปค §7)
- ผลคือ: เทสต์ R7 รอเปิด stream ใหม่ได้ถึง 75 วินาที; `R7b` (slot หลุดภายใน 5 วินาที) ไม่รันบน PHP; การรัน `sse-load.js` หลายระดับต่อกันบน PHP จะเจอ slot ค้างจากระดับก่อน — เว้นระยะหรือรันทีละระดับ

### Node + Express

- **poll loop เดียวกระจายให้ SSE ทุก client (R31)** — แอปอ่านตาราง events รอบเดียวทุก `SSE_POLL_MS` แล้วเขียนให้ทุก stream ที่เปิดอยู่ ต่างจาก PHP ที่แต่ละ stream อ่าน DB เอง ดังนั้นภาระ DB ไม่โตตามจำนวน stream แต่โตตามจำนวนรอบ poll
- WebSocket `/ws` อยู่ใน process เดียวกัน เพดาน 20 connection ต่อ process, ข้อความไม่เกิน 1 KB (เกินแล้วปิด 1009)

### Python + Flask

- **1 stream = 1 thread (R36)** — dev รัน gunicorn `gthread` 1 worker x 32 thread จึงรับ stream ได้สูงสุดราว 32 ต่อ container (ที่เหลือรอคิว) ต่างจาก Node ที่ stream ไม่ผูก thread
- **การตรวจว่า client หลุดใช้ `MSG_PEEK` บน socket และไม่ส่งอะไรออกไปทาง wire** (ไม่มี byte ว่าง) จึงไม่รบกวนการวัด idle-timeout ของ proxy — slot คืนเร็วกว่า PHP (ทดสอบด้วย `R7b`)
- **PyMySQL ใช้ client-side parameter binding (R34)** — PyMySQL ไม่มี server-side PREPARE จริง ยอมรับว่าเป็นไปตามเจตนาของสเปค "prepared statement ทุกจุด" คือกัน SQL injection ด้วย parameterisation
- **เพดาน WebSocket 20 ต่อ process (R38)** — บน SWH ถ้า Passenger/gunicorn รันหลาย worker เพดานรวมเป็น 20 x จำนวน worker; ใน dev (1 worker x 32 thread) เท่ากับ 20 รวม
- WebSocket `/ws` ได้ 101 และ RTT มัธยฐานระดับ ~1 ms ใน dev (ดูตารางข้อ 2)
