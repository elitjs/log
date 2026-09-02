# @elitjs/log

logger ใช้แทน `console.log` — **TypeScript, ใช้ได้ทั้ง Node และ browser, มี DevTools extension ของตัวเอง**

เขียน debug log ทิ้งไว้ใน code ได้เลยโดยไม่ต้อง comment ทิ้งหรือลบออก
ควบคุมการแสดงผลด้วย env (Node) หรือ query/localStorage (browser)
และตอนปิดอยู่จะ**แทบไม่มีค่าใช้จ่าย** (เมธอดถูกแทนด้วย noop เปล่า ๆ ~3 ns/call)

```
src/core.ts      core แบบ isomorphic (level/ns filter, noop-swap, lazy args, formatter)
src/node.ts      entry Node      — env + stdout/stderr
src/browser.ts   entry browser   — ring buffer + console echo + window.__ELITJS_LOG__
src/extension/   source ของ DevTools extension (compile ลง extension/)
extension/       extension พร้อมโหลด (Load unpacked)
demo/            หน้าเว็บทดลอง + static server
```

## Node

```ts
import { createLogger } from './src/node.ts'; // หรือ '@elitjs/log' หลัง build (dist/node.js)

const log = createLogger('shop:http');
log.debug('GET /api/cart took %dms', 12);   // เห็นเฉพาะตอนเปิด debug
log.error('payment failed', err);           // Error แสดง stack ให้
```

| Env | ค่า | ค่าเริ่มต้น |
| --- | --- | --- |
| `LOG_LEVEL` | `trace` `debug` `info` `warn` `error` `silent` | `silent` เมื่อ `NODE_ENV=production/prod` (ปิด log เลย) / `warn` (`NODE_ENV=test`) / `debug` (dev) — ตั้ง `LOG_LEVEL` ชัด ๆ จะชนะ default เสมอ |
| `LOG_ENABLED` | `0` = master switch ปิด ดับหมดไม่สน `LOG_LEVEL` / `1` = ใช้ `LOG_LEVEL` ตามปกติ | ไม่ตั้ง (ใช้ตาม `LOG_LEVEL`) |
| `LOG_NS` | กรอง namespace เช่น `shop:*, -shop:db` | เปิดทุก namespace |
| `DEBUG` | alias ของ `LOG_NS` | — |
| `LOG_TIME` | `time` / `iso` / `ms` / `none` | `time` |
| `LOG_SRC` | `1` = แสดง `(ไฟล์:บรรทัด)` ของ call site ต่อท้ายบรรทัด log | ปิด |
| `NO_COLOR` | ตั้งค่าไว้ = ปิดสี | — |

```bash
node example.ts                              # ตัวอย่างการใช้งาน
LOG_NS='shop:*,-shop:db' node example.ts     # เห็นทุกอย่างของ shop ยกเว้น shop:db
```

## Browser + DevTools extension

หัวใจคือ **"console สะอาด แต่ log ไม่หาย"**:

- ทุก log (trace ขึ้นไป) ถูกเก็บใน **ring buffer ในหน้าเว็บ** แบบข้อมูลดิบ — ไม่ format ไม่ serialize
  จนกว่าจะมีคนเปิดดู (การทำงานหนักเกิดตอน view เท่านั้น)
- **console echo** แยกจาก buffer (default `warn` — error ยังปรากฏใน console เสมอ
  ส่วน debug เงียบไปอยู่ใน panel) เปิดเต็มได้ด้วย `?log=debug`
- DevTools extension ดึง log จาก `window.__ELITJS_LOG__` มาแสดงใน panel ของตัวเอง

### ติดตั้ง extension

1. build + รัน demo server:
   ```bash
   npm install
   npm run build          # ได้ dist/ และ extension/*.js
   npm run demo:browser   # http://localhost:4173/demo/
   ```
2. เปิด `chrome://extensions` → เปิด **Developer mode** → **Load unpacked** → เลือกโฟลเดอร์ `extension/`
3. เปิด http://localhost:4173/demo/ → เปิด DevTools (F12) → จะมี tab **Elit.JS Log**

ความสามารถของ panel: filter ตาม level / namespace / ค้นหาข้อความ, pause, clear,
กดที่แถวเพื่อดู raw JSON ของ arguments, สั่งเปลี่ยน console echo ของหน้าเว็บได้จาก dropdown
(panel คุยกับหน้าเว็บผ่าน `chrome.devtools.inspectedWindow.eval` โดย poll เฉพาะ entry ใหม่ตาม seq)

หมายเหตุ: แถวของ entry ที่มี `Error` จะแสดงแค่บรรทัดแรก (`Error: message`) เพื่อให้กระชับ —
stack เต็มอยู่ใน raw JSON ตอนกดที่แถว

อยาก iterate หน้าตา panel โดยไม่ต้อง reload extension ใน chrome://extensions ทุกครั้ง:
เปิด `http://localhost:4173/demo/panel-preview.html` — หน้านี้ stub `chrome.devtools`
ให้ panel.js แล้วปั่น log ปลอมเข้ามาเรื่อย ๆ (แก้ `src/extension/panel.ts` → `npm run build` → refresh)

### ใช้ในเว็บของตัวเอง

```html
<script type="module">
  import { createLogger } from 'https://your-host/@elitjs/log/dist/browser.js';
  const log = createLogger('myapp');
  log.debug('hello %s', 'world');
</script>
```

### config การแสดงใน console (show / ไม่ show)

console echo คุมแยกจาก ring buffer — **ปิด console ยังไง log ก็ยังเข้า panel ครบเสมอ**

ค่าที่ใช้ได้: `false`/`'0'`/`'off'`/`'silent'` = ไม่แสดงเลย · `true`/`'1'`/`'on'` = แสดงทุกอย่าง (เท่ากับ debug) ·
หรือระบุ level ตรง ๆ `trace|debug|info|warn|error`

| ช่องทาง | ตัวอย่าง | priority |
| --- | --- | --- |
| เรียกตอน runtime | `installBrowser({ console: false })` / `__ELITJS_LOG__.setConsoleLevel(false)` | สูงสุด |
| ก่อน import | `<script>window.ELITJS_LOG_CONFIG = { console: false }</script>` | รองลงมา |
| URL query | `?console=0` / `?console=debug` (alias เดิม `?log=`) | รองลงมา |
| localStorage | `elitjs.log.console` (alias เดิม `elitjs.log.level`) | ต่ำสุด |
| default | `'warn'` — warn/error ยังขึ้น console เสมอ | — |

config อื่นผ่านช่องทางเดียวกันได้อีก: `ns` (กรอง namespace), `cap` (ขนาด buffer)
และ `src` (จับ call site — ดูหัวข้อถัดไป)

| Config | Query | localStorage | default |
| --- | --- | --- | --- |
| **master switch** | `?enabled=0` / `?enabled=1` | `elitjs.log.enabled` | เปิดใน dev / **ปิดใน production build** |
| console echo | `?console=` / `?log=` | `elitjs.log.console` / `elitjs.log.level` | `warn` (`silent` ใน production build) |
| กรอง namespace | `?ns=shop:*` | `elitjs.log.ns` | เปิดทั้งหมด |
| ขนาด buffer | `?cap=5000` | `elitjs.log.cap` | `1000` |
| จับไฟล์:บรรทัด | `?src=1` | `elitjs.log.src` | ปิด |
| ring buffer (panel) | `?buffer=0` | `elitjs.log.buffer` | เปิด (ปิดใน production build) |

### เปิด/ปิด log ทั้งหมด (master switch)

`enabled` คือปุ่มเดียวที่คุม log ของทั้งหน้า — **ปิดแล้วดับหมด**: console เงียบ, ring buffer ว่าง,
ทุก method เป็น noop และ **extension panel จะไม่เห็น log** (เห็นแค่สถานะ "⛔ logging ปิดอยู่")

- **default ตาม env**: เปิดใน dev — ปิดอัตโนมัติเมื่อ `NODE_ENV=production|prod`
  (Node: อ่านจาก env จริง / browser: ค่าที่ bundler แทนไว้ตอน build)
- **กำหนดเองได้ทุกช่องทาง**:
  - Node: `LOG_ENABLED=0` (ชนะ `LOG_LEVEL` ทุกกรณี) / `LOG_ENABLED=1` (ใช้ `LOG_LEVEL` ตามปกติ) / `setEnabled(false)` ตอน runtime
  - browser: `?enabled=0|1`, localStorage `elitjs.log.enabled`, `installBrowser({ enabled: false })`,
    `__ELITJS_LOG__.setEnabled(false)` หรือกดปุ่ม **⏻ Log: on/off** ใน panel ของ extension ตรง ๆ
- **เปิดคืนตอน debug ใน prod**: `?enabled=1` ท้าย URL แล้ว refresh หรือกดปุ่ม ⏻ ใน panel —
  จะได้ ring buffer กลับมา (และ console คืนเป็น `warn`) ให้ดู log ได้ทันที

API บน `window.__ELITJS_LOG__` (ที่ panel ใช้ — เรียกเองจาก console ก็ได้):
`dump(sinceSeq?)` `clear()` `setEnabled(v)` `setConsoleLevel(v)` `setFilter(pattern)` `setCap(n)` `getState()`

### แสดง "ไฟล์:บรรทัด" ที่เรียก log (source capture)

อยากรู้ว่า log บรรทัดไหนมาจากไฟล์ไหนบรรทัดไหน — เปิดได้ทั้งสองฝั่ง:

```bash
LOG_SRC=1 node app.ts          # Node: แสดง (ไฟล์:บรรทัด) ต่อท้ายทุกบรรทัด log
```

```html
<!-- browser: เปิดก่อน import แล้ว panel จะโชว์ chip 📄 app.js:60 ท้ายแถว
     (hover เห็น full path, กดที่แถวเห็น "source: ..." นำหน้า raw JSON) -->
<script>window.ELITJS_LOG_CONFIG = { src: true };</script>
```

หรือเปิดตอน runtime: `?src=1` / `installBrowser({ src: true })`

**ทำไมต้อง opt-in**: การจับ call site ต้องอ่าน `Error.stack` ตอน log ซึ่งแพงมาก (วัดได้ ~25µs/ครั้งใน Node)
จึงปิดไว้ default — พอปิด ต้นทุนของ log call ไม่เปลี่ยนเลย (ผ่าน bench แล้ว: ยัง ~3 ns/op)
หมายเหตุ: ฝั่ง browser แบบ dev server (Vite/ESM) จะได้ path ชัด ๆ ส่วน production bundle
ที่รวม lib กับ app เป็นไฟล์เดียวจะเดาจากโครงสร้าง stack แบบ best-effort

## API (ใช้เหมือนกันทั้ง Node และ browser)

```ts
const app  = createLogger('shop');
const http = app.child('http');           // -> 'shop:http' (กรองแบบ hierarchy ได้)

app.trace/debug/info/warn/error(...args)  // เหมือน console.log รองรับ %s %d %f %j %o %%
app.error('boom', err)                    // Error object โดน inspect แสดง stack

app.debug(() => ['cart: %j', bigObject])  // lazy: thunk ถูกเรียกเฉพาะตอนมี sink รับ
                                          // (browser: เรียกตอน panel ขอดูจริง ๆ เท่านั้น)
app.isEnabled('debug')                    // เช็คก่อนเข้า block ที่เตรียมข้อมูลแพง ๆ
app.enabled                              // namespace นี้ผ่านตัวกรอง ns หรือไม่

setLevel('debug')                         // Node: เปลี่ยน level ตอน runtime
setConsoleLevel('debug')                  // browser: เปลี่ยนเฉพาะ console echo
refresh()                                 // Node: อ่าน env ใหม่
```

## ทำไมถึงไม่เสีย performance

ปัญหาของ `console.log` คือ **จ่ายทุกครั้งเสมอ** แม้จะไม่มีใครอ่าน: ต่อ string, `JSON.stringify`,
format และเขียน I/O ทุก call

@elitjs/log แก้ด้วย:

1. **noop swap** — ตอนไม่มี sink ไหนรับ level นั้น `log.debug` ถูกแทนด้วยฟังก์ชันเปล่าจริง ๆ
   V8 inline ได้หมด เหลือแค่ค่า function call
2. **entry เก็บข้อมูลดิบ** — ไม่ format ไม่ serialize จนกว่า sink จะขอ
   (Node: ตอนเขียน / browser: ตอนเปิด panel ดู — lazy thunk ก็ถูกเรียกตอนนั้น)
3. **timestamp เป็น epoch ms** — `Date.now()` ราคาถูกมาก, การ format เป็น string
   เกิดตอนแสดงผล (Node แคชส่วน "วินาที" ของ `toISOString()` เพราะแพง ~800ns)
4. **เขียน I/O ครั้งเดียวต่อบรรทัด** (Node) / **push array ธรรมดา + compact เป็นระยะ** (browser buffer)

### ตัวเลขจากเครื่องนี้

ผลวัดล่าสุดทั้งฝั่ง Node และ browser (รวมวิธีวัดและการตีความ) อยู่ที่ **[BENCHMARK.md](BENCHMARK.md)**

สรุปสั้น:

- **Node — ปิดอยู่: ~3 ns/call (เร็วกว่า console.log ~270 เท่า)** / เปิดเขียนจริง: ~1 µs ≈ เทียบเท่า console.log
- **Browser — ปิดสนิท (prod default): ~6 ns/call (~720 เท่า)** / default dev (buffer เก็บครบให้ panel): ~120 ns (~38 เท่า)

## พัฒนาต่อ

```bash
npm run typecheck   # tsc ทั้งโปรเจกต์
npm test            # 44 tests (node:test — รัน .ts ตรง ๆ ด้วย type stripping)
npm run build       # dist/ + extension/*.js
npm run bench       # benchmark ฝั่ง Node (ฝั่ง browser: เปิด /demo/bench.html)
```

- โครงสร้าง: `tsconfig.json` (typecheck), `tsconfig.build.json` (→ `dist/`),
  `tsconfig.extension.json` (→ `extension/`) — source ทุกไฟล์ import กันด้วยนามสกุล `.ts`
  แล้วให้ `rewriteRelativeImportExtensions` แปลงเป็น `.js` ตอน emit
  ทำให้รันด้วย `node xxx.ts` ได้เลยโดยไม่ต้อง build (Node >= 22.6)
- ข้อควรรู้: lazy argument ใน browser จะถูก evaluate **ตอน dump ให้ panel**
  ค่าที่ได้จึงเป็น state ณ ตอนดู ไม่ใช่ตอนเรียก log (Node ปกติ — evaluate ตอนเขียน)

## Publish ขึ้น npm

ทำอัตโนมัติด้วย GitHub workflow ([.github/workflows/publish.yml](.github/workflows/publish.yml))
เมื่อ push tag `v*` — ขั้นตอนมี install → typecheck → test → build → ตรวจว่า tag ตรงกับ
version ใน package.json → `npm publish --access public --provenance`

1. **เตรียมครั้งเดียว**: สร้าง token แบบ *Automation* ที่ npmjs.com (Access Tokens)
   แล้วใส่เป็น secret ชื่อ `NPM_TOKEN` ใน repo (Settings → Secrets and variables → Actions)
   — ถ้า `@elitjs` เป็น org บน npm ต้องมีสิทธิ์ publish ใน scope นั้นด้วย
2. **ปล่อยเวอร์ชัน**:
   ```bash
   npm version patch    # หรือ minor / major — อัปเดต package.json + สร้าง tag ให้
   git push --follow-tags
   ```
3. ดูผลที่ tab Actions ของ repo

แพ็กเกจที่ publish มีแค่ `dist/` + README + LICENSE (กำหนดด้วย `files` ใน package.json —
ตรวจล่วงหน้าได้ด้วย `npm pack --dry-run`)
