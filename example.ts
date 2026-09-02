/**
 * ตัวอย่างการใช้งาน @elitjs/log ฝั่ง Node — ลองเล่นกับ env ดู:
 *
 *   Git Bash / macOS / Linux          PowerShell
 *   --------------------------        ---------------------------------
 *   node example.ts                   node example.ts
 *   LOG_LEVEL=warn node example.ts    $env:LOG_LEVEL='warn'; node example.ts
 *   LOG_NS='shop:*,-shop:db' ...      $env:LOG_NS='shop:*,-shop:db'; node ...
 *   LOG_TIME=iso node example.ts      $env:LOG_TIME='iso'; node example.ts
 *   NO_COLOR=1 node example.ts        $env:LOG_NO_COLOR... (NO_COLOR=1)
 */
import { createLogger } from './src/node.ts';

const app = createLogger('shop');
const httpLog = createLogger('shop:http');
const dbLog = createLogger('shop:db');
const payLog = app.child('payment');

app.info('service started on port %d', 3000);
app.warn('cache miss rate %f%%', 42.5);
httpLog.debug('GET /api/cart took %dms', 12);
dbLog.trace('query: %s', 'SELECT * FROM users');
payLog.error('payment failed', new Error('gateway timeout'));

const bigObject = {
  cart: Array.from({ length: 3 }, (_, i) => ({ id: i, name: `item-${i}` })),
};

// lazy argument: ฟังก์ชันนี้จะถูกเรียก "เฉพาะตอนที่ debug เปิดอยู่" เท่านั้น
// ตอนปิดอยู่ JSON.stringify / การต่อ string ทั้งหมดไม่เกิดขึ้นเลย
httpLog.debug(() => ['cart snapshot: %j', bigObject]);

// เขียนเท่า console.log ตอน debug เสร็จแล้วไม่ต้องลบทิ้ง ปิดด้วย env ได้เลย
console.log('--- บรรทัดนี้คือ console.log ปกติ (ควบคุมไม่ได้) ---');
