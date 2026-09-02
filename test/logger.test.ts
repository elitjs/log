// test ของ Node entry — พอร์ตมาจากฉบับ JavaScript ทั้งหมด
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger, getLevel, refresh, setEnabled, setLevel, setNodeStreams } from '../src/node.ts';
import type { Level, Logger } from '../src/node.ts';

const ENV_KEYS = ['LOG_LEVEL', 'LOG_NS', 'DEBUG', 'LOG_TIME', 'LOG_SRC', 'LOG_ENABLED', 'NO_COLOR', 'NODE_ENV'];

interface CaptureStream {
  write(s: string): void;
  isTTY: false;
  text: string;
}

function capture(): CaptureStream {
  const chunks: string[] = [];
  return {
    write: (s: string) => chunks.push(s),
    isTTY: false,
    get text() {
      return chunks.join('');
    },
  };
}

interface Ctx {
  out: CaptureStream;
  err: CaptureStream;
  level: Level;
  log: Logger;
}

/** ล้าง env ที่เกี่ยวข้อง ตั้งค่าใหม่ refresh ให้ lib อ่านค่าใหม่ ชะลอ stream มา capture แล้วสร้าง logger ให้ */
function setup(env: Record<string, string> = {}, ns = 't'): Ctx {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  const out = capture();
  const err = capture();
  setNodeStreams({ out, err });
  const level = refresh();
  return { out, err, level, log: createLogger(ns) };
}

test('LOG_LEVEL กรอง level ที่ต่ำกว่าออก และ warn/error ไป stderr', () => {
  const { out, err, log } = setup({ LOG_LEVEL: 'warn', LOG_TIME: 'none' });
  log.trace('nope');
  log.debug('nope');
  log.info('nope');
  log.warn('yes-warn');
  log.error('yes-error');
  assert.equal(out.text, '');
  assert.match(err.text, /WARN/);
  assert.match(err.text, /yes-warn/);
  assert.match(err.text, /ERROR/);
  assert.match(err.text, /yes-error/);
  assert.ok(!err.text.includes('nope'));
});

test('LOG_LEVEL ค่าไม่ถูกต้อง → ใช้ default ตาม NODE_ENV', () => {
  assert.equal(setup({ LOG_LEVEL: 'nope' }).level, 'debug');
  assert.equal(setup({ LOG_LEVEL: 'nope', NODE_ENV: 'production' }).level, 'silent', 'production → ปิด log เลย');
  assert.equal(setup({ LOG_LEVEL: 'nope', NODE_ENV: 'prod' }).level, 'silent', 'prod → ปิด log เลยด้วย');
  assert.equal(setup({ NODE_ENV: 'Production' }).level, 'silent', 'case-insensitive');
});

test('NODE_ENV=production แต่ตั้ง LOG_LEVEL ชัด ๆ → LOG_LEVEL ชนะ (ทางออกตอน debug ใน prod)', () => {
  const { err, log } = setup({ LOG_LEVEL: 'error', NODE_ENV: 'production', LOG_TIME: 'none' });
  assert.equal(log.isEnabled('info'), false);
  log.error('only-errors');
  assert.match(err.text, /only-errors/);
});

test('LOG_ENABLED=0 → master switch ปิด ดับหมดแม้ LOG_LEVEL=debug', () => {
  const { out, err, log } = setup({ LOG_LEVEL: 'debug', LOG_ENABLED: '0', LOG_TIME: 'none' });
  log.info('hidden');
  log.error('hidden-too');
  assert.equal(out.text, '');
  assert.equal(err.text, '');
});

test('LOG_ENABLED=1 → ใช้ LOG_LEVEL ตามปกติ', () => {
  const { out, log } = setup({ LOG_LEVEL: 'debug', LOG_ENABLED: '1', LOG_TIME: 'none' });
  log.info('shown');
  assert.match(out.text, /shown/);
});

test('setEnabled ตอน runtime: ปิดแล้วเปิดคืนได้ level ตามเดิม', () => {
  const { out, log } = setup({ LOG_LEVEL: 'debug', LOG_TIME: 'none' });
  setEnabled(false);
  log.info('gone');
  assert.equal(out.text, '');
  setEnabled(true);
  log.info('back');
  assert.match(out.text, /back/);
});

test('lazy argument ไม่ถูกเรียกตอนปิดอยู่ และถูกเรียกตอนเปิด', () => {
  const { out, log } = setup({ LOG_LEVEL: 'error', LOG_TIME: 'none' });
  let calls = 0;
  const lazy = (): unknown[] => {
    calls++;
    return ['computed %d', 1];
  };
  log.debug(lazy);
  assert.equal(calls, 0, 'lazy fn ต้องไม่ถูกเรียกตอน level ปิดอยู่');

  setLevel('debug');
  log.debug(lazy);
  assert.equal(calls, 1);
  assert.match(out.text, /computed 1/);
});

test('lazy argument คืนค่าเดี่ยว (ไม่ใช่ array) ก็ใช้ได้', () => {
  const { out, log } = setup({ LOG_LEVEL: 'debug', LOG_TIME: 'none' });
  log.debug(() => 'plain message');
  assert.match(out.text, /plain message/);
});

test('LOG_NS กรองด้วย wildcard และ -exclude', () => {
  setup({ LOG_LEVEL: 'trace', LOG_NS: 'app:*, -app:db', LOG_TIME: 'none' });
  assert.equal(createLogger('app:http').enabled, true);
  assert.equal(createLogger('app:db').enabled, false);
  assert.equal(createLogger('web').enabled, false);
});

test('LOG_NS แบบไม่มี wildcard ก็ match ลูกได้ (app ครอบ app:user)', () => {
  setup({ LOG_LEVEL: 'debug', LOG_NS: 'app', LOG_TIME: 'none' });
  assert.equal(createLogger('app').enabled, true);
  assert.equal(createLogger('app:user').enabled, true);
  assert.equal(createLogger('other').enabled, false);
});

test('DEBUG ใช้เป็น alias ของ LOG_NS ได้', () => {
  setup({ LOG_LEVEL: 'trace', DEBUG: 'only:me', LOG_TIME: 'none' });
  assert.equal(createLogger('only:me').enabled, true);
  assert.equal(createLogger('someone:else').enabled, false);
});

test('รองรับ printf-style format แบบเดียวกับ console.log', () => {
  const { out, log } = setup({ LOG_LEVEL: 'debug', LOG_TIME: 'none' });
  log.info('hi %s id=%d ok=%j', 'alice', 5, { a: 1 });
  assert.match(out.text, /hi alice id=5 ok=\{"a":1\}/);
});

test('Error object แสดง stack ได้', () => {
  const { err, log } = setup({ LOG_LEVEL: 'error', LOG_TIME: 'none' });
  log.error('boom:', new Error('kaboom'));
  assert.match(err.text, /boom:/);
  assert.match(err.text, /Error: kaboom/);
  assert.match(err.text, /at /);
});

test('setLevel เปลี่ยนได้ตอน runtime และกระทบ logger เดิม', () => {
  const { out, err, log } = setup({ LOG_LEVEL: 'error', LOG_TIME: 'none' });
  assert.equal(log.trace, log.debug); // ปิดหมด → เป็น noop ตัวเดียวกัน
  setLevel('trace');
  assert.notEqual(log.trace, log.debug);
  log.trace('now-visible');
  assert.match(out.text, /now-visible/);
  assert.equal(getLevel(), 'trace');
  setLevel('silent');
  log.error('never');
  assert.ok(!err.text.includes('never'));
});

test('setLevel(silent) ปิดหมดทุก level', () => {
  const { out, err, log } = setup({ LOG_LEVEL: 'silent', LOG_TIME: 'none' });
  log.error('nope');
  assert.equal(out.text, '');
  assert.equal(err.text, '');
  assert.equal(log.isEnabled('error'), false);
});

test('child() สร้าง namespace แบบ hierarchy และถูกกรองด้วย LOG_NS', () => {
  setup({ LOG_LEVEL: 'debug', LOG_NS: 'a:b', LOG_TIME: 'none' });
  const a = createLogger('a');
  assert.equal(a.child('b').name, 'a:b');
  assert.equal(a.child('b').enabled, true);
  assert.equal(a.child('c').enabled, false);
});

test('LOG_SRC=1 แสดง (ไฟล์:บรรทัด) ต่อท้ายบรรทัด log', () => {
  const { out, log } = setup({ LOG_LEVEL: 'debug', LOG_TIME: 'none', LOG_SRC: '1' });
  log.info('where-am-i');
  assert.match(out.text, /where-am-i \(.*logger\.test\.ts:\d+\)/);
});

test('log.isEnabled ใช้กันข้อมูลแพงใน hot path ได้', () => {
  const { log } = setup({ LOG_LEVEL: 'info' });
  assert.equal(log.isEnabled('debug'), false);
  assert.equal(log.isEnabled('info'), true);
  assert.equal(log.isEnabled('error'), true);
});
