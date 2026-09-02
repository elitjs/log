// test ของ browser entry — รันใน Node โดย shim global ที่ browser ต้องใช้ก่อน import
// (node --test รันแต่ละไฟล์ใน process แยกกัน จึงไม่ปนกับ test อื่น)
import test from 'node:test';
import assert from 'node:assert/strict';

// ---- shim ก่อน import ตัว lib ----
delete process.env.NODE_ENV; // กัน env ของเครื่องทำให้ detectProd คิดว่าเป็น production
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string): string | null => store.get(k) ?? null,
  setItem: (k: string, v: string): void => {
    store.set(k, v);
  },
};
(globalThis as Record<string, unknown>).location = { search: '' };

const { createLogger, installBrowser } = await import('../src/browser.ts');
const { __ELITJS_LOG__ } = globalThis as unknown as { __ELITJS_LOG__: NonNullable<Awaited<ReturnType<typeof installBrowser>>> };

test('installBrowser ติดตั้งอัตโนมัติเมื่อมี window และ idempotent', () => {
  assert.ok(__ELITJS_LOG__);
  assert.equal(installBrowser(), __ELITJS_LOG__);
  assert.ok(__ELITJS_LOG__.version);
  // default config: console echo = warn, ไม่กรอง ns, cap = 1000
  assert.equal(__ELITJS_LOG__.getState().consoleLevel, 'warn');
  assert.equal(__ELITJS_LOG__.getState().ns, null);
  assert.equal(__ELITJS_LOG__.getState().cap, 1000);
});

test('ring buffer เก็บทุก level (แม้ console echo = warn) และ dump คืน entries พร้อม seq', () => {
  __ELITJS_LOG__.clear();
  const log = createLogger('shop:http');
  const before = __ELITJS_LOG__.dump().lastSeq;
  log.trace('t-msg');
  log.debug('d-%s', 'msg');
  log.error('e-msg');
  const dump = __ELITJS_LOG__.dump();
  assert.equal(dump.entries.length, 3);
  assert.equal(dump.lastSeq, before + 3);
  assert.deepEqual(dump.entries.map((e) => e.level), ['trace', 'debug', 'error']);
  assert.match(dump.entries[1].msg, /d-msg/);
  assert.ok(dump.entries[2].raw);
});

test('dump(sinceSeq) คืนเฉพาะ entry ใหม่ — สำหรับ panel ที่ poll', () => {
  __ELITJS_LOG__.clear();
  const log = createLogger('poll');
  log.info('one');
  const first = __ELITJS_LOG__.dump();
  assert.equal(first.entries.length, 1);
  log.info('two');
  log.info('three');
  const second = __ELITJS_LOG__.dump(first.lastSeq);
  assert.deepEqual(second.entries.map((e) => e.msg), ['two', 'three']);
});

test('lazy thunk ถูก resolve ตอน dump ไม่ใช่ตอน log', () => {
  __ELITJS_LOG__.clear();
  const log = createLogger('lazy');
  let calls = 0;
  log.debug(() => {
    calls++;
    return ['snap=%j', { a: 1 }];
  });
  assert.equal(calls, 0, 'ยังไม่มีใครดู → thunk ต้องไม่ถูกเรียก');
  const dump = __ELITJS_LOG__.dump();
  assert.equal(calls, 1);
  assert.match(dump.entries[0].msg, /snap=\{"a":1\}/);
});

test('console echo: default warn → info ไม่พิมพ์, setConsoleLevel(info) → พิมพ์ผ่าน console.info', () => {
  __ELITJS_LOG__.clear();
  assert.equal(__ELITJS_LOG__.getState().consoleLevel, 'warn');
  const log = createLogger('echo');
  const origInfo = console.info;
  const origLog = console.log;
  let infoCalls = 0;
  let logCalls = 0;
  console.info = (): void => {
    infoCalls++;
  };
  console.log = (): void => {
    logCalls++;
  };
  try {
    log.info('quiet'); // warn level → ไม่ echo
    assert.equal(infoCalls, 0);
    __ELITJS_LOG__.setConsoleLevel('info');
    log.info('loud');
    assert.equal(infoCalls, 1);
    assert.equal(logCalls, 0);
    assert.equal(__ELITJS_LOG__.getState().consoleLevel, 'info');
  } finally {
    console.info = origInfo;
    console.log = origLog;
    __ELITJS_LOG__.setConsoleLevel('warn');
  }
});

test('setFilter จาก panel มีผลทันที และ getState สะท้อนค่าล่าสุด', () => {
  __ELITJS_LOG__.clear();
  const logA = createLogger('shop:a');
  const logB = createLogger('web:b');
  __ELITJS_LOG__.setFilter('shop:*');
  assert.equal(__ELITJS_LOG__.getState().ns, 'shop:*');
  assert.equal(logA.enabled, true);
  assert.equal(logB.enabled, false);
  logA.info('in');
  logB.info('out');
  assert.equal(__ELITJS_LOG__.dump().entries.length, 1);
  __ELITJS_LOG__.setFilter(null);
  logB.info('now-in');
  assert.equal(__ELITJS_LOG__.dump().entries.length, 2);
});

test('clear ล้าง buffer แต่ seq ยัง monotonic', () => {
  const log = createLogger('clr');
  log.info('x');
  const before = __ELITJS_LOG__.dump().lastSeq;
  __ELITJS_LOG__.clear();
  log.info('y');
  const dump = __ELITJS_LOG__.dump();
  assert.equal(dump.entries.length, 1);
  assert.ok(dump.entries[0].seq > before);
});

test('installBrowser({...}) เปลี่ยน config ตอน runtime ได้ (เรียกซ้ำไม่พัง)', () => {
  assert.equal(__ELITJS_LOG__.getState().consoleLevel, 'warn');
  installBrowser({ console: false });
  assert.equal(__ELITJS_LOG__.getState().consoleLevel, 'silent', 'console:false = ไม่แสดงเลย');
  installBrowser({ console: true });
  assert.equal(__ELITJS_LOG__.getState().consoleLevel, 'debug', 'console:true = แสดงทุกอย่าง');
  installBrowser({ console: 'error' });
  assert.equal(__ELITJS_LOG__.getState().consoleLevel, 'error');
  installBrowser({ console: 'warn' }); // คืน default ให้ test อื่น
  assert.equal(installBrowser(), __ELITJS_LOG__, 'idempotent — คืน instance เดิม');
});

test('installBrowser({src:true}) เปิดจับ call site ตอน runtime ได้ — dump ได้ src จริง', () => {
  __ELITJS_LOG__.clear();
  assert.equal(__ELITJS_LOG__.getState().src, false, 'default ปิด (จับ stack แพง)');
  installBrowser({ src: true });
  const log = createLogger('sourcemode');
  log.warn('captured');
  log.debug(() => ['lazy %s', 'also-captured']);
  const dump = __ELITJS_LOG__.dump();
  assert.match(dump.state.src === true ? dump.entries[0].src ?? '' : '', /browser\.test\.ts:\d+/);
  assert.match(dump.entries[1].src ?? '', /browser\.test\.ts:\d+/, 'lazy thunk ก็ได้ src ของ call site');
  installBrowser({ src: false }); // คืน default
  assert.equal(__ELITJS_LOG__.getState().src, false);
});

test('master switch: setEnabled(false) ดับหมด (panel จะไม่เห็น log), setEnabled(true) กลับมา', () => {
  __ELITJS_LOG__.clear();
  assert.equal(__ELITJS_LOG__.getState().enabled, true, 'dev default = เปิด');
  const log = createLogger('master');

  let consoleWrites = 0;
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const consoleAny = console as unknown as Record<string, (...args: unknown[]) => void>;
  for (const k of Object.keys(orig)) consoleAny[k] = (): void => { consoleWrites++; };
  try {
    __ELITJS_LOG__.setEnabled(false);
    const off = __ELITJS_LOG__.getState();
    assert.equal(off.enabled, false);
    assert.equal(off.buffer, false);
    log.error('invisible');
    log.info('invisible');
    assert.equal(consoleWrites, 0, 'console เงียบสนิท');
    assert.equal(__ELITJS_LOG__.dump().entries.length, 0, 'buffer ว่าง — panel ไม่เห็น log ตอนปิด');

    __ELITJS_LOG__.setEnabled(true);
    assert.equal(__ELITJS_LOG__.getState().buffer, true, 'เปิดคืนแล้ว buffer ต้องกลับมา');
    log.warn('back');
    assert.equal(__ELITJS_LOG__.dump().entries.length, 1);
    assert.equal(consoleWrites, 1, 'console กลับมาทำงานตาม level เดิม (warn)');
  } finally {
    Object.assign(console, orig);
  }
});
