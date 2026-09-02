// test ลำดับ priority ของ config ฝั่ง browser — ต้องเป็นไฟล์แยก (process แยก)
// เพราะ query/ELITJS_LOG_CONFIG ถูกอ่านตอน import ครั้งแรกเท่านั้น
//
// สถานการณ์: localStorage บอก 'off', query บอก '?console=debug', ELITJS_LOG_CONFIG บอก false
// คาดหวัง: ELITJS_LOG_CONFIG ชนะ (silent) แล้วเรียก installBrowser({console:true}) ต้องชนะทุกอย่าง (debug)
delete process.env.NODE_ENV; // กัน env ของเครื่องทำให้ detectProd คิดว่าเป็น production
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>([
  ['elitjs.log.console', 'off'], // priority ต่ำสุดในสามช่องทางนี้
]);
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string): string | null => store.get(k) ?? null,
  setItem: (k: string, v: string): void => {
    store.set(k, v);
  },
};
(globalThis as Record<string, unknown>).location = { search: '?console=debug&ns=shop:*&cap=50' };
(globalThis as Record<string, unknown>).ELITJS_LOG_CONFIG = { console: false };

const { createLogger, installBrowser, parseConsoleSpec } = await import('../src/browser.ts');
const { __ELITJS_LOG__ } = globalThis as unknown as { __ELITJS_LOG__: ReturnType<typeof installBrowser> };

test('parseConsoleSpec: รองรับทั้ง boolean-style และชื่อ level', () => {
  assert.equal(parseConsoleSpec('0'), 'silent');
  assert.equal(parseConsoleSpec('false'), 'silent');
  assert.equal(parseConsoleSpec('off'), 'silent');
  assert.equal(parseConsoleSpec('none'), 'silent');
  assert.equal(parseConsoleSpec('1'), 'debug');
  assert.equal(parseConsoleSpec('true'), 'debug');
  assert.equal(parseConsoleSpec('on'), 'debug');
  assert.equal(parseConsoleSpec('all'), 'debug');
  assert.equal(parseConsoleSpec('trace'), 'trace');
  assert.equal(parseConsoleSpec('warn'), 'warn');
  assert.equal(parseConsoleSpec('WARN'), 'warn', 'case-insensitive');
  assert.equal(parseConsoleSpec('bogus'), null, 'ค่าไม่ถูกต้อง → null (ไปใช้ default)');
  assert.equal(parseConsoleSpec(null), null);
  assert.equal(parseConsoleSpec(''), null);
});

test('priority: ELITJS_LOG_CONFIG ชนะ query และ localStorage', () => {
  const state = __ELITJS_LOG__.getState();
  assert.equal(state.consoleLevel, 'silent', 'ELITJS_LOG_CONFIG.console:false ต้องชนะ ?console=debug และ elitjs.log.console=off');
  // ns กับ cap มาจาก query (ELITJS_LOG_CONFIG ไม่ได้ระบุ)
  assert.equal(state.ns, 'shop:*');
  assert.equal(state.cap, 50);
});

test('priority: installBrowser(opts) ชนะทุกอย่าง แม้เรียกหลัง auto-install', () => {
  installBrowser({ console: true, ns: null, cap: 1000 });
  const state = __ELITJS_LOG__.getState();
  assert.equal(state.consoleLevel, 'debug');
  assert.equal(state.ns, null);
  assert.equal(state.cap, 1000);
});

test('console:silent ปิด console จริง แต่ ring buffer ยังเก็บครบ', () => {
  installBrowser({ console: false });
  const log = createLogger('quiet');
  const origError = console.error;
  const origLog = console.log;
  let writes = 0;
  console.error = (): void => {
    writes++;
  };
  console.log = (): void => {
    writes++;
  };
  try {
    __ELITJS_LOG__.clear();
    log.error('invisible-in-console');
    log.info('also-invisible');
    assert.equal(writes, 0, 'ต้องไม่มีอะไรแตะ console เลย');
    const dump = __ELITJS_LOG__.dump();
    assert.equal(dump.entries.length, 2, 'แต่ buffer ยังเก็บครบให้ panel');
  } finally {
    console.error = origError;
    console.log = origLog;
  }
});
