# @elitjs/log — Benchmark vs console.log

ผลวัดจริงจากเครื่องที่พัฒนา (Windows 11 x64) — วันที่ 2026-09-01, เวอร์ชัน 0.6.0
รันซ้ำเองได้: ฝั่ง Node `npm run bench` (แนะนำ redirect output ทิ้ง) / ฝั่ง browser เปิด
`http://localhost:4173/demo/bench.html` (ต้อง `npm run demo:browser` + `npm run build` ก่อน)

## Node (Node.js 24.12, output ถูก redirect ทิ้ง — วัดแต่ตัว lib)

```
จำนวน 66,666 calls/รอบ × 3 รอบ (ค่าที่ดีที่สุด)

console.log("hello")                             818.6 ns/op     1,221,620 ops/s
console.log + ต่อ string + JSON.stringify       1,359.1 ns/op       735,759 ops/s
@elitjs/log ปิด: log.debug("user %s %j",...)        3.0 ns/op   332,333,001 ops/s
@elitjs/log ปิด: log.debug(() => [...]) lazy        3.0 ns/op   332,333,001 ops/s
@elitjs/log เปิด: log.info("hello")              1,052.0 ns/op       950,598 ops/s
```

| สรุป | ตัวเลข |
| --- | --- |
| ปิดอยู่ (default ใน production) | **~3 ns/call — เร็วกว่า console.log ~270 เท่า** |
| เปิดเขียนจริง (stdout) | ~1.05 µs ≈ เทียบเท่า console.log (819 ns) ทั้งที่เพิ่ม timestamp+level+ns |

## Browser (Chromium 146 / Electron 41 — วัดใน engine จริงผ่านหน้า demo/bench.html)

| case | ns/op | ops/s | เทียบ console.log |
| --- | ---: | ---: | ---: |
| `console.log("hello")` | 4,620 | 216,450 | 1x |
| `console.log` + ต่อ string + `JSON.stringify` | 9,900 | 101,009 | 0.47x |
| **@elitjs/log ปิดสนิท** (`enabled=false` → noop) | **6.4** | 156,250,001 | **~720x เร็วกว่า** |
| ปิดสนิท + lazy thunk | 7.2 | 138,888,890 | ~640x |
| **browser default** (buffer เก็บครบทุก level) | **120** | 8,333,333 | **~38x เร็วกว่า** |
| browser default + lazy thunk | 164 | 6,097,561 | ~28x |
| เปิด echo ลง console (`log.info` + %c สี) | 39,849 | 25,094 | ~0.12x (ช้ากว่า เพราะ styling) |
| + source capture (`?src=1` จับ stack) | 78,145 | 12,797 | แพงสุด — ทำให้เป็น opt-in |

## อ่านตัวเลขอย่างไร

- **เส้นทางที่ใช้จริงใน production แทบไม่มีค่าใช้จ่าย**: default ใน prod คือ `enabled=false`
  → ทุก call เป็น noop ~3-6 ns — ทิ้ง debug log ไว้ใน code ได้สบาย
- **browser ตอน dev** (console สะอาด ดูผ่าน DevTools panel): จ่ายแค่ ~120 ns/call
  (สร้าง entry ดิบ + push array — ไม่ format ไม่ serialize จนกว่าจะเปิด panel ดู)
  ถูกกว่า `console.log` ~38 เท่า แม้จะบันทึกครบทุก level
- **console.log ใน browser แพงกว่า Node ~5 เท่า** (4.6µs vs 0.8µs) — ยิ่งเห็นว่าทำไม
  การปล่อย debug log แบบ console.log เต็มหน้าเว็บแพงจริง
- **ของที่แพงเป็น opt-in ทั้งคู่โดยดีไซน์**:
  - console echo ของ lib (~40µs) แพงเพราะ `%c` styling — default `warn` เท่านั้น
    (จะเงียบสนิทก็ได้ `?console=0`) และปกติดู log ผ่าน panel ซึ่งไม่ผ่านเส้นทางนี้
  - source capture (~25-78µs) ต้องสร้าง+parse `Error.stack` — ปิด default เปิดเฉพาะตอนไล่บั๊ก

## วิธีวัด (methodology)

- ทั้งสองฝั่ง: warmup ก่อน แล้ววัด 3 รอบ **เอาค่าที่ดีที่สุด** (ลด noise จาก GC/ลำดับการรัน)
- Node: `process.hrtime.bigint()` และ redirect stdout ทิ้ง (`node bench.ts > /dev/null`)
  เพื่อวัดแต่ตัว lib ไม่รวมค่า render เทอร์มินัล
- Browser: `performance.now()` รอบลูปใหญ่ (ความละเอียดของ timer จำกัด ~µs
  ค่า ns/op ของ path ถูก ๆ จึงเป็นค่าประมาณจากลูปหลายแสนรอบ) — รันใน Chromium จริง
  ผ่านหน้า `demo/bench.html` (auto-run ตอนโหลด กด ↻ รันซ้ำได้)
- ตัวเลขขึ้นกับเครื่อง/เวอร์ชัน engine — ใช้เปรียบเทียบ**สัดส่วน**ระหว่างกันมากกว่าค่าเท่าๆ กัน
