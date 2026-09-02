// test browser entry แบบ production — ไฟล์แยก (process แยก) เพราะ prod ถูก detect ตอน import
import test from 'node:test';
import assert from 'node:assert/strict';

// จำลอง bundler ที่แทน process.env.NODE_ENV = 'production' ให้ตอน build
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).process = { env: { NODE_ENV: 'production' } };
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (): string | null => null,
  setItem: (): void => {},
};
(globalThis as Record<string, unknown>).location = { search: '' };

const { createLogger, installBrowser } = await import('../src/browser.ts');
const { __ELITJS_LOG__ } = globalThis as unknown as { __ELITJS_LOG__: ReturnType<typeof installBrowser> };

test('production build → ปิด log เลย: console silent + ไม่มี ring buffer', () => {
  const state = __ELITJS_LOG__.getState();
  assert.equal(state.enabled, false, 'master switch ปิด (prod default)');
  assert.equal(state.consoleLevel, 'silent');
  assert.equal(state.buffer, false);

  const log = createLogger('prod');
  assert.equal(log.isEnabled('error'), false, 'ทุก level ต้องเป็น noop');

  let consoleWrites = 0;
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const consoleAny = console as unknown as Record<string, (...args: unknown[]) => void>;
  for (const k of Object.keys(orig)) consoleAny[k] = (): void => { consoleWrites++; };
  try {
    log.error('invisible');
    log.info('invisible');
    assert.equal(consoleWrites, 0, 'console ต้องเงียบสนิท');
    assert.equal(__ELITJS_LOG__.dump().entries.length, 0, 'buffer ต้องไม่เก็บอะไรเลย — panel จะไม่เห็น log');
  } finally {
    Object.assign(console, orig);
  }
});

test('master switch enabled:true → เปิดคืนทั้ง buffer และ console (แบบ dev) — ปุ่ม ⏻ ใน panel ใช้ทางนี้', () => {
  installBrowser({ enabled: true });
  const state = __ELITJS_LOG__.getState();
  assert.equal(state.enabled, true);
  assert.equal(state.buffer, true, 'เปิด master แล้ว buffer ต้องกลับมา');
  assert.equal(state.consoleLevel, 'warn', 'console ที่โดนปิดเพราะ prod default ต้องกลับเป็น warn');

  const log = createLogger('prod-debug');
  log.warn('now-visible');
  const dump = __ELITJS_LOG__.dump();
  assert.equal(dump.entries.length, 1);
  assert.match(dump.entries[0].msg, /now-visible/);

  // ปิดคืนได้จาก panel: setEnabled(false) → เงียบสนิทอีกครั้ง
  __ELITJS_LOG__.setEnabled(false);
  assert.equal(__ELITJS_LOG__.getState().enabled, false);
  log.error('gone-again');
  assert.equal(__ELITJS_LOG__.dump().entries.length, 0);
});
