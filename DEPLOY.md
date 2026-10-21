# Mooban · คู่มือ deploy บน DirectAdmin

คู่มือนี้ตามสเปค §10 (การติดตั้ง), §11 (แผนทดสอบ) และ §12 (ตัวกั้นกับการปิดระบบ) ของ Mooban ส่วนผลที่วัดได้ลงใน [RESULTS.md](RESULTS.md) ส่วนภาพรวม repo ดู [README.md](README.md)

ทุก stack ใช้หน้าเว็บชุดเดียวกัน (`shared/public`) และ schema เดียวกัน (`shared/schema.sql`) แตกต่างกันที่ตัวแอปกับวิธีเสิร์ฟเท่านั้น

## 0. เตรียมก่อนลงมือ

1. สร้างโดเมนย่อย `apache`, `nginx`, `node`, `python` ใต้โดเมนทดสอบ ออก SSL ครบ และตรวจว่า http เปลี่ยนไป https (F10)
2. สร้าง MySQL database + user แยกต่อ stack: `mb_apache`, `mb_nginx`, `mb_node`, `mb_python` (DirectAdmin ใส่ prefix `<username>_` ให้เอง) แล้วรัน `shared/schema.sql` ในแต่ละ database
   - schema ใช้ `DATETIME(3)` ต้องเป็น MySQL 5.6.5+ หรือ MariaDB 5.3+ ให้จดเวอร์ชันที่ได้ลง RESULTS.md
3. ตรวจ extension ของ PHP 8.x บน `apache` และ `nginx`: GD (รองรับ WebP), exif, Imagick — ถ้าเปิดเองไม่ได้ ให้จดสิ่งที่มี
4. ตั้ง `TEST_TOKEN` เป็นค่าสุ่มอย่างน้อย 24 ตัวอักษร และห้ามใส่ลง repo
5. ถ้าเปิดสู่สาธารณะ ใครก็สมัครและอัปโหลดรูปได้ ให้เปิดเฉพาะช่วงทดสอบ หรือใส่ HTTP Basic Auth ระดับโดเมน (ถ้า SWH รองรับ) แล้วใส่ `-u` ให้ `curl` กับ `hey` — ถ้าใช้ Basic Auth ให้จดไว้ในผล เพราะอาจกระทบผลของ caching และ proxy
6. ถ้าทดสอบบนโฮสต์ของผู้ให้บริการอื่น ให้ตรวจนโยบาย fair-use ก่อนรัน load test

## 1. ค่า config ที่ทุก stack ต้องมี

PHP ใช้ `config.php` (สร้างจาก `php/config.sample.php`), Node ใช้ `node/.env`, Python ใช้ `python/.env` — ชื่อตัวแปรเหมือนกัน

| ชื่อ | ความหมาย | ค่าตั้งต้น / ตัวอย่าง |
|---|---|---|
| `DB_HOST` | โฮสต์ MySQL | `localhost` |
| `DB_NAME` | ชื่อ database | `<username>_mb_node` |
| `DB_USER` | ชื่อ user | `<username>_mb` |
| `DB_PASS` | รหัสผ่าน (ห้ามใส่ใน repo) | - |
| `APP_STACK` | ค่าที่ใส่ใน `X-Stack` | `apache` / `nginx` / `node` / `python` |
| `TEST_TOKEN` | token ของ endpoint ทดสอบ สุ่มอย่างน้อย 24 ตัวอักษร | - |
| `MEDIA_DIR` | โฟลเดอร์เก็บรูป (PHP: อยู่ใน document root, Node/Python: อยู่นอก) | `<docroot>/media` หรือ `/home/<username>/mb_node_media` |
| `CACHE_DIR` | โฟลเดอร์ cache ที่เขียนได้ นอก document root | `/home/<username>/mb_node_cache` |
| `PORT` | พอร์ตภายในของแอป (เฉพาะ Node/Python หลัง proxy) | ตามที่ SWH กำหนด |
| `MAX_UPLOAD_BYTES` | ขนาดไฟล์อัปโหลดสูงสุด | `10485760` |
| `MAX_PIXELS` | จำนวน pixel สูงสุดของรูป | `24000000` |
| `SSE_POLL_MS` | ช่วงอ่าน events | `1000` |
| `SSE_MAX_SECONDS` | อายุสูงสุดของ stream หนึ่งการเชื่อมต่อ | `60` |
| `MAX_STREAMS_PER_IP` | จำนวน stream พร้อมกันต่อ IP | `10` |

ตัวแปรเพิ่มของ Node/Python: `PUBLIC_DIR` (โฟลเดอร์ที่มี `index.html` — ต้องอยู่คนละที่กับ `MEDIA_DIR`/`CACHE_DIR`), `TRUST_PROXY` (`1` = เชื่อ `X-Forwarded-For` ตัวขวาสุดตัวเดียว ใช้เฉพาะหลัง proxy ที่คุมเอง, ค่าตั้งต้น `0`) และ `DB_PORT`

## 2. สิทธิ์ไฟล์

| รายการ | สิทธิ์ |
|---|---|
| ไฟล์ทั่วไปใน document root | `644` |
| โฟลเดอร์ใน document root | `755` |
| `MEDIA_DIR` และ `CACHE_DIR` | เจ้าของเป็น user ของ account และเขียนได้เฉพาะ user นั้น (`755`) |
| โฟลเดอร์และไฟล์ที่แอปสร้างใน `MEDIA_DIR` | `755` และ `644` เพื่อให้ web server อ่านได้ |
| ไฟล์ config ที่มีรหัสผ่านและ `TEST_TOKEN` (`config.php`, `.env`) | `600` และอยู่นอก document root |

`MEDIA_DIR` ห้ามรันสคริปต์และห้ามแสดงรายการไฟล์ (PHP: `media/.htaccess` หรือ location `/media/` ใน nginx snippet จัดการให้แล้ว)

## 3. Apache + PHP (`apache.<domain>`)

ผังไฟล์ (ตัวอย่าง `/home/<username>/domains/apache.<domain>/`)

```
public_html/                  <- document root
  index.html app.js style.css robots.txt sample.jpg js/…   (จาก shared/public/*)
  api.php .htaccess                                          (จาก php/public/*)
  media/.htaccess                                            (จาก php/public/media/.htaccess)
src/                          <- จาก php/src  (นอก document root)
config.php                    <- จาก php/config.sample.php, chmod 600 (นอก document root)
seed-texts.json               <- จาก shared/seed-texts.json (วางข้าง config.php)
../mb_apache_cache/           <- CACHE_DIR
```

ขั้นตอน

1. อัปโหลด `shared/public/*` ลง `public_html/`
2. อัปโหลด `php/public/*` (รวม `.htaccess` และ `media/.htaccess`) ลง `public_html/` ทับได้
3. อัปโหลด `php/src` เป็น `src/` และ `shared/seed-texts.json` ข้าง `config.php` — ทั้งหมดนอก document root
4. สร้าง `config.php` จาก `php/config.sample.php` ใส่ค่า DB, `APP_STACK=apache`, `TEST_TOKEN`, `MEDIA_DIR=<docroot>/media`, `CACHE_DIR` แล้ว `chmod 600`
5. สร้าง `media/` และ `CACHE_DIR` ตั้งสิทธิ์ตามตารางข้อ 2
6. ต้องเปิด `mod_rewrite` และให้ `.htaccess` ทำงาน (`AllowOverride`)

ทางลัดในเครื่อง: `bash dev/assemble.sh` ประกอบโครงนี้ไว้ที่ `build/php/` (`public_html/`, `src/`, `config.php`, `seed-texts.json`) ใช้เป็นต้นแบบการอัปโหลดได้ (`config.php` ที่ได้เป็นค่า dev — ต้องแก้ก่อนใช้จริง)

## 4. Nginx + PHP-FPM (`nginx.<domain>`)

โค้ด PHP ชุดเดียวกับ Apache แต่ **ไม่อัปโหลด `.htaccess`** (nginx ไม่อ่าน) — ทุกอย่างที่ `.htaccess` ทำย้ายไปอยู่ใน `nginx/nginx-snippet.conf`

1. อัปโหลดไฟล์ตามผังข้อ 3 แต่ใช้ `APP_STACK=nginx`, DB `mb_nginx` และไม่ต้องมี `.htaccess`
   (`bash dev/assemble.sh nginx` ประกอบให้ที่ `build/php-nginx/`)
2. วางเนื้อหา `nginx/nginx-snippet.conf` ในช่อง custom config ของโดเมน (ต้องอยู่ระดับ `server {}`)
3. **แก้บรรทัดเดียว** ใน `location = /api.php`:

   ```
   fastcgi_pass unix:/run/php-fpm/mooban.sock;   # <-- EDIT: your PHP-FPM
   ```

   ให้ชี้ไป PHP-FPM ของ account (unix socket หรือ `host:port`) — `fastcgi_pass` สืบทอดไม่ได้ จึงต้องอยู่ใน location นี้
4. อย่าเปิด gzip ให้ `text/event-stream` (`gzip_types` ใน snippet ตัดไว้แล้ว) และให้ `fastcgi_buffering off` / `fastcgi_read_timeout 75s` คงอยู่ เพื่อให้ SSE สดและอยู่ได้ 60 วินาที
5. `client_max_body_size 12m` อยู่ใน snippet แล้ว

## 5. Node + Express (`node.<domain>`)

```
/home/<username>/mooban-node/         (นอก document root)
  app.js package.json package-lock.json src/
  .env                                <- จาก node/.env.sample, chmod 600
  seed-texts.json                     <- จาก shared/seed-texts.json (วางในโฟลเดอร์แม่ของ PUBLIC_DIR)
/home/<username>/mooban-node/public/  <- PUBLIC_DIR = สำเนาของ shared/public/*
/home/<username>/mb_node_media/       <- MEDIA_DIR
/home/<username>/mb_node_cache/       <- CACHE_DIR
```

1. อัปโหลด `node/` (ไม่ต้องอัปโหลด `node_modules`), `shared/public/*` ไปเป็น `PUBLIC_DIR` และ `shared/seed-texts.json` ไว้โฟลเดอร์แม่ของ `PUBLIC_DIR` (ใช้โดย seed)
2. `cp .env.sample .env` แล้วใส่ค่า (`DB_*`, `TEST_TOKEN`, `PORT` ที่ SWH กำหนด, `PUBLIC_DIR`, `MEDIA_DIR`, `CACHE_DIR`) แล้ว `chmod 600 .env` — แอปอ่านด้วย `process.loadEnvFile` ตัวแปรที่ตั้งใน environment จริงจะชนะไฟล์
3. ต้องใช้ Node 22 ขึ้นไป: `npm ci --omit=dev` (ต้องได้ binary ของ `sharp` ที่ตรงกับ OS/CPU ของ SWH — ถ้า `npm ci` ไม่ผ่านให้จดสาเหตุลง RESULTS.md)
4. เริ่ม: `npm start` (= `node app.js`) ผ่านตัวจัดการ Node app ของ SWH ถ้ามี (startup file = `app.js`) ถ้าไม่มีให้ใช้ process manager ของ account
5. Restart: สั่ง restart ผ่านตัวจัดการเดียวกัน แล้วตรวจว่า `/api/ping` ตอบ 200 ภายใน 60 วินาที (F11)
6. ถ้าอยู่หลัง reverse proxy ตัวเดียวที่คุมเอง ตั้ง `TRUST_PROXY=1` มิฉะนั้น IP ที่ใช้ทำ rate limit จะเป็นของ proxy
7. proxy ต้องส่ง `Upgrade` ต่อให้ `/ws` และไม่ buffer `/api/stream`

## 6. Python + Flask (`python.<domain>`)

```
/home/<username>/mooban-python/        (นอก document root)
  app.py mooban/ passenger_wsgi.py requirements.txt
  .env                                 <- จาก python/.env.sample, chmod 600
  seed-texts.json                      <- จาก shared/seed-texts.json (วางในโฟลเดอร์แม่ของ PUBLIC_DIR)
  venv/                                <- virtualenv
/home/<username>/mooban-python/public/ <- PUBLIC_DIR = สำเนาของ shared/public/*
/home/<username>/mb_python_media/      <- MEDIA_DIR
/home/<username>/mb_python_cache/      <- CACHE_DIR
```

1. อัปโหลด `python/`, `shared/public/*` (เป็น `PUBLIC_DIR`) และ `shared/seed-texts.json` ไว้โฟลเดอร์แม่ของ `PUBLIC_DIR` (ใช้โดย seed)
2. `python3 -m venv venv && venv/bin/pip install -r requirements.txt` (Python 3.12; ต้องมี `Pillow` ที่เข้ารหัส WebP ได้ — ตรวจด้วยข้อ I9)
3. `cp .env.sample .env` ใส่ค่าแล้ว `chmod 600 .env` (path แบบ relative อ้างอิงโฟลเดอร์ `python/`)
4. Passenger (Python app ของ DirectAdmin): ชี้ application root ไปที่โฟลเดอร์นี้ startup file = `passenger_wsgi.py` (มี `from app import application`) และให้ใช้ interpreter ใน `venv/`
5. ถ้า SWH ไม่มี Passenger: รันเอง `venv/bin/gunicorn --worker-class gthread --workers 1 --threads 32 --bind 127.0.0.1:$PORT app:application` แล้ว proxy เข้า
6. Restart ตามวิธีของ Passenger (เช่น แตะ `tmp/restart.txt`) แล้วตรวจ `/api/ping` ภายใน 60 วินาที (F11)
7. WebSocket: เพดานของแอปคือ 20 connection **ต่อ process** — ถ้า SWH รันหลาย worker เพดานรวมเป็น 20 x จำนวน worker; ใน dev (1 worker x 32 thread) คือ 20 รวม (R38 ใน RESULTS.md)

## 7. Smoke test (ทุก stack)

เปลี่ยน `H` เป็นโดเมนของ stack นั้น

```bash
H=https://node.<domain>

# 1) ping: 200 และ X-Stack ถูก
curl -i $H/api/ping

# 2) สมัครผู้ใช้ได้ (201) แล้วเก็บ token จาก response
curl -i -X POST $H/api/users -H 'Content-Type: application/json' -d '{"handle":"smoke1","display_name":"Smoke"}'

# 3) อัปโหลด tests/fixtures/test-1mp.jpg ได้ 201 แล้วเปิด thumb_url ได้ 200
curl -i -H "Authorization: Bearer $TOKEN" -F file=@tests/fixtures/test-1mp.jpg $H/api/images
curl -I $H<thumb_url>

# 4) เปิด / เห็นหน้าเว็บ และเปิด /u/test ตรงๆ ได้หน้าเดียวกัน (แปลว่ากฎ rewrite ทำงาน)
curl -s $H/ | head -5 ; curl -s $H/u/test | head -5
```

ต้องผ่านครบจึงเริ่มแผนทดสอบ §11 (เกณฑ์ผ่านอยู่ในสเปค; ตารางผลอยู่ใน [RESULTS.md](RESULTS.md))

## 8. กติกาตอนทดสอบ (§11)

- ทดสอบทั้ง 4 stack ช่วงเวลาเดียวกัน ห่างจากช่วงที่ SWH สำรองข้อมูล ใช้ client และเครือข่ายเดียวกัน ทดสอบซ้ำจากอย่างน้อย 2 ที่ตั้ง/ISP
- ทุกการวัดรัน 3 รอบ บันทึกค่ามัธยฐาน จดวันที่ เวลา เวอร์ชัน runtime และโหมด web server
- ก่อนวัด P1 เรียก `POST /api/test/seed?users=50&posts=5000&images=100&reset=1` จด `duration_ms` และเรียก `DELETE /api/test/seed` เมื่อเสร็จ
- endpoint ที่มีตัวกั้น (`/api/test/*`, `/download`, `/upload`, `/api/slow`, `DELETE /api/cache`) ต้องส่ง `X-Test-Token` ทุกครั้ง
- การทดสอบที่นับเป็นนาที (rate limit: P3) ให้เริ่มไม่เกินวินาทีที่ 10 ของนาที
- `/upload` ถูกจำกัดที่ประมาณ 12 MiB บนทุก stack (R30): ผล B1 ของ 100 MB ให้จดเป็น "ขนาดที่ใหญ่ที่สุดที่ผ่าน"

## 9. ขั้นตอน R6 (เปิด stream พร้อมกันหลายระดับ)

R6 วัดว่าเปิด SSE พร้อมกันได้สูงสุดกี่ connection ด้วย `tools/sse-load.js` (Node 22+, ไม่มี dependency)

1. **ตั้ง `MAX_STREAMS_PER_IP` เป็น 100 ชั่วคราว** ในไฟล์ config ของ stack นั้น (ไม่งั้นระดับ 20 และ 50 จะโดน 429 ตั้งแต่ต้น) แล้ว restart แอป — ระดับ 5+10+20+50 = 85 พอดีกับ 100
2. รัน

   ```bash
   node tools/sse-load.js --base https://node.<domain> --token $TEST_TOKEN --levels 5,10,20,50 --hold 120 --json
   ```

   ต่อระดับ: เปิด N stream พร้อมกัน จับเวลาบรรทัดแรก (`retry:`), ยิง `POST /api/test/emit` หนึ่งครั้งแล้วจับเวลา `test.ping`, ค้าง stream ไว้จนครบ `--hold` วินาที แล้วนับ stream ที่ปิดก่อนเวลาและสถานะ (429/502/503/504)
3. จดจำนวนสูงสุดที่ทุก connection ได้ event ภายใน 3 วินาที และจุดที่เริ่มได้ 429, 502, 503, 504 หรือ request อื่นช้าลงเกิน 2 เท่า
4. **คืน `MAX_STREAMS_PER_IP` เป็น 10** แล้ว restart (R7 ต้องการค่า 10)

ข้อควรรู้ของ PHP (Apache/Nginx): 1 stream กิน PHP worker 1 ตัว และ slot ของ stream ที่ client ตัดไปแล้วจะถูกคืนเมื่อการเขียน ping ครั้งถัดไปล้มเหลวเท่านั้น (ประมาณ 60-70 วินาที, R13/R13a) ดังนั้นการรันระดับต่อกันแบบ back-to-back บน PHP จะเจอ slot ค้างจากระดับก่อน — เว้นระยะระหว่างระดับหรือรัน `--levels` ทีละระดับ

## 10. ปิดระบบเมื่อทดสอบเสร็จ (§12)

- [ ] `DELETE /api/test/seed` (ส่ง `X-Test-Token`) ลบข้อมูล seed
- [ ] ลบไฟล์ทั้งหมดใน `MEDIA_DIR` และ `CACHE_DIR`
- [ ] ลบ database ทั้ง 4 (`mb_apache`, `mb_nginx`, `mb_node`, `mb_python`)
- [ ] ปิดหรือลบโดเมนย่อย
- [ ] หยุด process ของ Node และ Python
- [ ] ไม่ปล่อย endpoint ที่หนักหรือ stream เปิดทิ้งไว้
- [ ] เอา `config.php` / `.env` ที่มีรหัสผ่านและ `TEST_TOKEN` ออกจากเซิร์ฟเวอร์

## 11. Log และการเฝ้าดู

- error log ของโดเมน: ดูจากแผงควบคุมของ SWH
- log ของแอป Node และ Python: ในโฟลเดอร์ `logs/` — บันทึกเฉพาะตอนเริ่มทำงาน, error และการประมวลผลรูปที่ล้มเหลว ห้ามมี token หรือ header `Authorization`
- ดูการใช้ดิสก์จาก `media_bytes` ใน `GET /api/stats` เทียบกับหน้าโควตาของ DirectAdmin

## ภาคผนวก: รีเซ็ต DB ใน Docker dev

`bash dev/reset-db.sh <apache|nginx|node|python>` — drop และสร้าง database ของ stack นั้นใหม่จาก `shared/schema.sql` แล้วล้างโฟลเดอร์ media ในคอนเทนเนอร์ที่ถูกต้อง (apache/nginx: docroot `media` เก็บ `.htaccess` ไว้; node/python: `/data/media`) ใช้ได้เฉพาะ dev ในเครื่อง ไม่ใช่บน SWH
