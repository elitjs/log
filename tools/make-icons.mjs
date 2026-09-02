// สร้าง icon ของ extension (@elitjs/log DevTools) — Node ล้วน ไม่มี dependency
// เขียน PNG เอง (IHDR/IDAT/IEND + zlib ในตัว Node) แล้ววาดด้วย supersampling
//
// ลาย: พื้นที่มุมมนสีเข้ม + แถว log 3 แถว (จุดสี level + แท่งข้อความ) สื่อถึง panel ของ lib
// รัน: node tools/make-icons.mjs   (build script เรียกให้อยู่แล้ว — deterministic รันซ้ำได้)
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension', 'icons');

// ---------- PNG encoder ขั้นต่ำ (RGBA 8-bit) ----------

let CRC_TABLE;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- รูปทรง ----------

function insideRoundRect(u, v, x0, y0, x1, y1, r) {
  // SDF มาตรฐานของ rounded rect: clamp ส่วนลบเป็น 0 ก่อนระยะทาง
  const qx = Math.max(Math.abs(u - (x0 + x1) / 2) - (x1 - x0) / 2 + r, 0);
  const qy = Math.max(Math.abs(v - (y0 + y1) / 2) - (y1 - y0) / 2 + r, 0);
  return qx * qx + qy * qy <= r * r;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

// ---------- ฉากของ icon (พิกัด u,v ∈ [0,1]) ----------

const BG = [32, 37, 43, 255]; // #20252b
const BAR = [213, 219, 225, 255]; // #d5dbe1
const ROWS = [
  { v: 0.3, color: [77, 208, 225, 255], barEnd: 0.8 }, // cyan — debug
  { v: 0.5, color: [129, 199, 132, 255], barEnd: 0.69 }, // green — info
  { v: 0.7, color: [255, 183, 77, 255], barEnd: 0.57 }, // amber — warn
];

function sceneAt(dotR, barH) {
  const barStart = 0.42;
  return (u, v) => {
    if (!insideRoundRect(u, v, 0.03, 0.03, 0.97, 0.97, 0.21)) return [0, 0, 0, 0];
    for (const row of ROWS) {
      if (Math.hypot(u - 0.29, v - row.v) <= dotR) return row.color;
      if (distToSegment(u, v, barStart, row.v, row.barEnd, row.v) <= barH) return BAR;
    }
    return BG;
  };
}

function render(size) {
  // ขนาดเล็กมาก (16px) วาดหนาขึ้น ไม่งั้นจุดเล็กกว่า pixel จะจมหาย
  const chunky = size <= 16;
  const scene = sceneAt(chunky ? 0.08 : 0.055, chunky ? 0.055 : 0.042);
  const SS = 4; // 4x4 supersampling ต่อ pixel → ขอบเรียบ
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = scene((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
          r += c[0];
          g += c[1];
          b += c[2];
          a += c[3];
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      out[i] = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
      out[i + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, out);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const png = render(size);
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, png);
  console.log(`${file} (${png.length} bytes)`);
}
