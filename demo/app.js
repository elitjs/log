// demo ฝั่ง browser — import @elitjs/log จาก dist (รัน npm run build ก่อน)
import { createLogger } from '../dist/browser.js';

const shop = createLogger('shop');
const http = shop.child('http');
const db = createLogger('shop:db');
const ui = createLogger('ui');

const live = document.getElementById('live');
let running = false;
let timer = null;
let req = 0;

const paths = ['/api/cart', '/api/user/42', '/api/products?page=2', '/api/checkout'];
const queries = ['SELECT * FROM users WHERE id = ?', 'UPDATE cart SET qty = qty + 1', 'COMMIT'];

function activity() {
  req++;
  const path = paths[req % paths.length];
  const ms = 5 + Math.round(Math.random() * 120);
  http.debug('GET %s -> %dms', path, ms);
  if (ms > 100) http.warn('slow request %s took %dms', path, ms);
  if (req % 3 === 0) db.trace('query: %s', queries[req % queries.length]);
  if (req % 5 === 0) ui.info('rendered view %d', req);
  if (req % 10 === 0) db.error('deadlock detected on tx-%d', req, new Error('lock timeout'));
  live.textContent = `requests: ${req} — ดู log ทั้งหมดใน tab @elitjs/log ของ DevTools`;
}

function start() {
  if (running) return;
  running = true;
  timer = setInterval(activity, 1200);
  activity();
}

function stop() {
  running = false;
  clearInterval(timer);
  live.textContent = `หยุดแล้ว (requests: ${req})`;
}

shop.info('app booted (@elitjs/log browser demo)');
ui.debug('feature flag %j', { newCheckout: true, experiments: ['a', 'b'] });

for (const btn of document.querySelectorAll('button[data-lv]')) {
  btn.addEventListener('click', () => {
    const lv = btn.dataset.lv;
    (shop[lv] ?? ui[lv])(`manual ${lv} from button click`);
    if (!running) live.textContent = `ส่ง ${lv} แล้ว — เปิด tab @elitjs/log ใน DevTools เพื่อดู`;
  });
}

document.getElementById('lazy').addEventListener('click', () => {
  // lazy: ถูก evaluate ตอน panel ขอดูเท่านั้น
  http.debug(() => ['cart snapshot: %j', { user: 42, items: Array.from({ length: 20 }, (_, i) => ({ id: i, qty: (i % 3) + 1 })) }]);
  live.textContent = 'ส่ง lazy snapshot แล้ว — กดที่แถวใน panel เพื่อเปิด raw JSON';
});

document.getElementById('boom').addEventListener('click', () => {
  const err = new Error('simulated checkout failure');
  shop.child('payment').error('payment failed for order %d', 1001, err);
  live.textContent = 'ส่ง error พร้อม stack แล้ว — ลองกดที่แถวเพื่อดู detail';
});

document.getElementById('stop').addEventListener('click', () => (running ? stop() : start()));
