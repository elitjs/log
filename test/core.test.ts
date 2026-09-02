// test ของ core (isomorphic) — โฟกัสที่พฤติกรรม multi-sink และการส่ง entry แบบดิบ
import test from 'node:test';
import assert from 'node:assert/strict';
import { addSink, createLogger, formatMessage, removeSink, resolveArgs, safeStringify, setFilter, setLevel, setSourceCapture } from '../src/core.ts';
import type { LogEntry, Sink } from '../src/core.ts';

function recordingSink(minLevel: number): { sink: Sink; entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const sink: Sink = { minLevel, write: (e) => entries.push(e) };
  return { sink, entries };
}

test('entry ที่ส่งให้ sink เป็นข้อมูลดิบ — lazy thunk ยังไม่ถูกเรียก (ความหมาย: browser buffer)', () => {
  const { sink, entries } = recordingSink(0);
  addSink(sink);
  try {
    const log = createLogger('x');
    let calls = 0;
    log.debug(() => {
      calls++;
      return ['v=%d', 1];
    });
    assert.equal(calls, 0, 'core ต้องไม่ resolve thunk — เป็นหน้าที่ของ sink');
    assert.equal(typeof entries[0].args[0], 'function');
    assert.equal(entries[0].level, 'debug');
    assert.equal(entries[0].ns, 'x');
    assert.equal(typeof entries[0].t, 'number');
  } finally {
    removeSink(sink);
  }
});

test('multi-sink: แต่ละ sink มี minLevel ของตัวเอง', () => {
  const a = recordingSink(30); // info ขึ้นไป
  const b = recordingSink(0); // ทุกอย่าง
  addSink(a.sink);
  addSink(b.sink);
  try {
    const log = createLogger('x');
    log.trace('t');
    log.info('i');
    log.error('e');
    assert.deepEqual(a.entries.map((e) => e.level), ['info', 'error']);
    assert.deepEqual(b.entries.map((e) => e.level), ['trace', 'info', 'error']);
  } finally {
    removeSink(a.sink);
    removeSink(b.sink);
  }
});

test('addSink/removeSink ทำให้เมธอดสลับ noop กลับไปมา', () => {
  const { sink, entries } = recordingSink(0);
  const log = createLogger('x');
  const before = log.debug; // ยังไม่มี sink ใด ๆ → noop
  addSink(sink);
  assert.notEqual(log.debug, before);
  log.debug('hi');
  assert.equal(entries.length, 1);
  removeSink(sink);
  assert.equal(log.debug, before, 'กลับเป็น noop ตัวเดิมหลัง removeSink');
  log.debug('gone');
  assert.equal(entries.length, 1);
});

test('setLevel ตั้ง minLevel ของทุก sink', () => {
  const { sink, entries } = recordingSink(0);
  addSink(sink);
  try {
    setLevel('error');
    const log = createLogger('x');
    log.info('hidden');
    log.error('shown');
    assert.deepEqual(entries.map((e) => e.level), ['error']);
  } finally {
    removeSink(sink);
  }
});

test('setFilter กรองที่ core ระดับ global (มีผลกับทุก sink)', () => {
  const { sink, entries } = recordingSink(0);
  addSink(sink);
  try {
    setFilter('shop:*');
    const logA = createLogger('shop:a');
    const logB = createLogger('web:b');
    logA.info('in');
    logB.info('out');
    assert.equal(entries.length, 1);
    assert.equal(logB.enabled, false);
    setFilter(null);
    logB.info('now-in');
    assert.equal(entries.length, 2);
  } finally {
    removeSink(sink);
    setFilter(null);
  }
});

test('resolveArgs: array = กระจายเป็น arguments, ค่าเดี่ยว = argument เดียว, ไม่มี fn = ผ่าน', () => {
  const fn = (): unknown[] => [1, 2];
  assert.deepEqual(resolveArgs([fn]), [1, 2]);
  assert.deepEqual(resolveArgs([() => 'x']), ['x']);
  assert.deepEqual(resolveArgs(['a', 1]), ['a', 1]);
});

test('source capture: ปิดไว้ default, เปิดแล้วได้ "ไฟล์:บรรทัด" ของ call site จริง', () => {
  const { sink, entries } = recordingSink(0);
  addSink(sink);
  try {
    const log = createLogger('src');
    log.info('no-src-by-default');
    assert.equal(entries[0].src, undefined, 'ปิดอยู่ต้องไม่จับ stack (ไม่เสีย performance)');

    setSourceCapture(true);
    try {
      log.info('with-src');
    } finally {
      setSourceCapture(false);
    }
    const src = entries[1].src;
    assert.ok(src, 'เปิดแล้วต้องได้ src มา');
    assert.match(src, /core\.test\.ts:\d+/, 'ชี้มาที่ไฟล์ test นี้ (call site จริง ไม่ใช่ไฟล์ของ logger)');
    assert.ok(!/core\.ts/.test(src.split(':')[0] ?? ''), 'ต้องกรอง frame ของ logger เองออก');
  } finally {
    removeSink(sink);
    setSourceCapture(false);
  }
});

test('formatMessage: printf + ต่อ args ที่เหลือตอนท้าย', () => {
  assert.equal(formatMessage(['hi %s id=%d', 'a', 5]), 'hi a id=5');
  assert.equal(formatMessage(['%j', { a: 1 }]), '{"a":1}');
  assert.equal(formatMessage(['100%% sure %f', 0.5]), '100% sure 0.5');
  assert.equal(formatMessage(['msg', { x: 1 }, 'tail']), 'msg {"x":1} tail');
  assert.equal(formatMessage([42, 'str']), '42 str');
});

test('formatMessage + safeStringify: ทน circular และ Error', () => {
  const obj: Record<string, unknown> = { name: 'loop' };
  obj.self = obj;
  assert.match(formatMessage([obj]), /\{"name":"loop","self":"\[Circular\]"\}/);
  const err = new Error('boom');
  assert.match(formatMessage([err]), /Error: boom/);
  assert.match(formatMessage(['%j', err]), /"message":"boom"/);
  assert.equal(safeStringify(undefined), 'undefined');
  assert.equal(safeStringify(123n), '"123n"', 'bigint กลายเป็น JSON string (พฤติกรรมมาตรฐานของ JSON.stringify + replacer)');
  assert.match(safeStringify([function foo() {}]), /\[Function: foo\]/);
});

test('formatMessage แบบ oneLineErrors: Error เหลือบรรทัดเดียว (สำหรับ panel)', () => {
  const err = new Error('kaboom');
  const compact = formatMessage(['payment failed for order %d', 1001, err], { oneLineErrors: true });
  assert.ok(compact.includes('Error: kaboom'));
  assert.ok(!compact.includes('\n'), 'ต้องไม่มี newline จาก stack');
  // default: ยังมี stack เต็ม (ใช้ใน console echo)
  const full = formatMessage(['failed', err]);
  assert.match(full, /at /);
});
