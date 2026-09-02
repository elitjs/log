/**
 * @elitjs/log DevTools panel
 *
 * ดึง log จากหน้าเว็บที่กำลัง inspect ผ่าน chrome.devtools.inspectedWindow.eval
 * โดยหน้าเว็บต้อง import @elitjs/log ฝั่ง browser (dist/browser.js) ซึ่งจะเปิด
 * global `window.__ELITJS_LOG__` ไว้ให้ — panel poll ด้วย seq จึงได้เฉพาะ entry ใหม่
 *
 * หมายเหตุ: โครงสร้าง payload ตรงกับ DumpResult ใน src/browser.ts (sync ด้วยมือ)
 */

interface DumpEntry {
  seq: number;
  t: number;
  level: string;
  ns: string;
  msg: string;
  /** "ไฟล์:บรรทัด" ของ call site — null ถ้าหน้าเว็บปิด source capture */
  src: string | null;
  raw: string | null;
}

interface DumpResult {
  lastSeq: number;
  entries: DumpEntry[];
  state: { consoleLevel: string; ns: string | null; cap: number; src?: boolean; buffer?: boolean; enabled?: boolean };
}

const POLL_MS = 750;
const MAX_MEMORY = 5000; // จำนวน entry สูงสุดที่ panel เก็บใน memory
const MAX_DOM_ROWS = 2000; // จำนวนแถวสูงสุดใน DOM (กันหน่วยกิน memory)
const LEVEL_ORDER = ['trace', 'debug', 'info', 'warn', 'error'];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const rowsEl = $('rows');
const statusDot = $('status-dot');
const statusText = $('status-text');
const levelSelect = $('level-filter') as HTMLSelectElement;
const nsInput = $('ns-filter') as HTMLInputElement;
const searchInput = $('search') as HTMLInputElement;
const pauseBtn = $('pause') as HTMLButtonElement;
const clearBtn = $('clear') as HTMLButtonElement;
const echoSelect = $('console-echo') as HTMLSelectElement;
const toggleBtn = $('toggle-log') as HTMLButtonElement;

let lastSeq = 0;
let pageEnabled = true;
let paused = false;
let all: DumpEntry[] = [];
let echoSyncing = false; // กัน event วนตอน sync ค่าจาก page

function evalPage(expression: string): Promise<{ result: unknown; isException: boolean }> {
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval(expression, (result: unknown, isException: boolean) => {
      resolve({ result, isException });
    });
  });
}

function setStatus(ok: boolean, text: string): void {
  statusDot.className = ok ? 'dot ok' : 'dot bad';
  statusText.textContent = text;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0');

function fmtTime(t: number): string {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function passFilter(e: DumpEntry): boolean {
  const minIdx = LEVEL_ORDER.indexOf(levelSelect.value);
  if (minIdx >= 0 && LEVEL_ORDER.indexOf(e.level) < minIdx) return false;
  const ns = nsInput.value.trim();
  if (ns && !e.ns.toLowerCase().includes(ns.toLowerCase())) return false;
  const q = searchInput.value.trim().toLowerCase();
  if (q && !e.msg.toLowerCase().includes(q) && !e.ns.toLowerCase().includes(q)) return false;
  return true;
}

/** ย่อ "http://x/y/app.js:60" เหลือ "app.js:60" (เก็บ full path ไว้ใน title) */
function shortSrc(src: string): string {
  const parts = src.split('/');
  return parts[parts.length - 1] || src;
}

function appendRow(e: DumpEntry): void {
  const row = document.createElement('div');
  row.className = 'row lv-' + e.level;

  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = fmtTime(e.t);

  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = e.level.toUpperCase().padEnd(5);

  const ns = document.createElement('span');
  ns.className = 'ns';
  ns.textContent = e.ns || '—';

  const msg = document.createElement('span');
  msg.className = 'msg';
  msg.textContent = e.msg;

  row.append(time, badge, ns, msg);

  if (e.src) {
    const src = document.createElement('span');
    src.className = 'src';
    src.textContent = '📄 ' + shortSrc(e.src);
    src.title = 'เรียกจาก: ' + e.src;
    row.appendChild(src);
  }

  if (e.raw) {
    row.classList.add('has-raw');
    row.addEventListener('click', () => {
      const detail = row.nextElementSibling;
      if (detail && detail.classList.contains('detail')) {
        detail.remove();
        return;
      }
      const d = document.createElement('pre');
      d.className = 'detail';
      const srcLine = e.src ? `source: ${e.src}\n\n` : '';
      d.textContent = srcLine + (e.raw ?? '');
      row.after(d);
    });
  }

  rowsEl.appendChild(row);
  while (rowsEl.children.length > MAX_DOM_ROWS) rowsEl.firstElementChild?.remove();
}

function renderAll(): void {
  rowsEl.textContent = '';
  for (const e of all) if (passFilter(e)) appendRow(e);
  scrollBottom();
}

function scrollBottom(): void {
  rowsEl.scrollTop = rowsEl.scrollHeight;
}

function nearBottom(): boolean {
  return rowsEl.scrollTop + rowsEl.clientHeight >= rowsEl.scrollHeight - 60;
}

async function poll(): Promise<void> {
  const { result, isException } = await evalPage(
    `(typeof __ELITJS_LOG__ === 'undefined') ? null : __ELITJS_LOG__.dump(${lastSeq})`,
  );
  if (isException || !result) {
    setStatus(false, 'ไม่พบ @elitjs/log ในหน้านี้ — หน้าเว็บต้อง import dist/browser.js ก่อน');
    return;
  }
  const dump = result as DumpResult;
  lastSeq = dump.lastSeq;

  // sync ค่า console echo จากหน้าเว็บมาแสดง (เว้นตอนที่ผู้ใช้กำลังเลือกอยู่)
  if (!echoSyncing && echoSelect.value !== dump.state.consoleLevel) {
    echoSyncing = true;
    echoSelect.value = dump.state.consoleLevel;
    echoSyncing = false;
  }

  pageEnabled = dump.state.enabled !== false;
  toggleBtn.textContent = pageEnabled ? '⏻ Log: on' : '⏻ Log: off';
  toggleBtn.classList.toggle('off', !pageEnabled);

  if (dump.entries.length > 0) {
    all.push(...dump.entries);
    if (all.length > MAX_MEMORY) all.splice(0, all.length - MAX_MEMORY);
    const stick = nearBottom();
    for (const e of dump.entries) if (passFilter(e)) appendRow(e);
    if (stick) scrollBottom();
  }

  if (!pageEnabled) {
    setStatus(false, '⛔ logging ปิดอยู่ (prod default หรือถูกสั่งปิด) — เปิดด้วยปุ่ม ⏻ หรือ ?enabled=1');
    return;
  }
  const nsText = dump.state.ns ? ` ns=${dump.state.ns}` : '';
  const srcText = dump.state.src ? ' · src on' : ' · src off';
  const bufText = dump.state.buffer === false ? ' · ⚠ buffer off' : '';
  setStatus(true, `● ${dump.lastSeq} entries · cap ${dump.state.cap}${srcText}${bufText}${nsText}`);
}

setInterval(() => {
  if (!paused && document.visibilityState !== 'hidden') void poll();
}, POLL_MS);
void poll();

// ---- toolbar ----

levelSelect.addEventListener('change', renderAll);
nsInput.addEventListener('input', renderAll);
searchInput.addEventListener('input', renderAll);

pauseBtn.addEventListener('click', () => {
  paused = !paused;
  pauseBtn.textContent = paused ? '▶ Resume' : '⏸ Pause';
  pauseBtn.classList.toggle('active', paused);
  setStatus(true, paused ? 'หยุดชั่วคราว' : 'กำลังฟัง...');
});

clearBtn.addEventListener('click', async () => {
  all = [];
  renderAll();
  await evalPage(`(typeof __ELITJS_LOG__ === 'undefined') ? null : __ELITJS_LOG__.clear()`);
  setStatus(true, 'ล้างแล้ว');
});

echoSelect.addEventListener('change', () => {
  if (echoSyncing) return;
  const lv = echoSelect.value;
  void evalPage(`(typeof __ELITJS_LOG__ === 'undefined') ? null : __ELITJS_LOG__.setConsoleLevel('${lv}')`).then(() => poll());
});

toggleBtn.addEventListener('click', () => {
  void evalPage(`(typeof __ELITJS_LOG__ === 'undefined') ? null : __ELITJS_LOG__.setEnabled(${!pageEnabled})`).then(() => poll());
});

// reload หน้าเว็บ = buffer หายทั้งหมด ต้องรีเซ็ต cursor และ view
chrome.devtools.network.onNavigated.addListener(() => {
  lastSeq = 0;
  all = [];
  renderAll();
  setStatus(true, 'หน้าเว็บโหลดใหม่ — รอ @elitjs/log...');
});
