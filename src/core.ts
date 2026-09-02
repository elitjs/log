/**
 * @elitjs/log core — isomorphic ใช้ได้ทั้ง Node และ browser (ไม่ import อะไรที่ผูกกับ platform)
 *
 * สถาปัตยกรรมเรื่อง performance:
 *   1. noop swap — ตอนที่ไม่มี sink ไหนรับ level นั้น เมธอด (log.debug ฯลฯ) จะถูกแทนด้วย
 *      ฟังก์ชันเปล่าจริง ๆ → call site จ่ายแค่ค่า function call ที่ V8 inline ได้
 *   2. entry เก็บ args แบบ "ดิบ" — ไม่ format ไม่ serialize จนกว่า sink จะขอ
 *      (Node stdout ฟอร์แมตตอนเขียน / browser buffer เก็บไว้ฟอร์แมตตอนดูใน DevTools panel)
 *   3. lazy argument `log.debug(() => ...)` — thunk จะถูกเรียกเฉพาะเมื่อ sink ที่รับอยู่ consume เท่านั้น
 *      (browser buffer เก็บ thunk ไว้ แล้ว resolve ตอน dump ให้ panel — ตอนที่ไม่มีใครดู ไม่เกิดการทำงานเลย)
 *   4. timestamp เก็บเป็น epoch ms (Date.now()) — การจัดรูปแบบเป็น string เกิดตอนแสดงผลเท่านั้น
 */

export type LevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error';
export type Level = LevelName | 'silent';

/** ค่า level เรียงจาก verbose ไป silent (ตัวเลขยิ่งมากยิ่ง quiet) */
export const LEVELS: Readonly<Record<Level, number>> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  silent: 100,
};
const METHODS: readonly LevelName[] = ['trace', 'debug', 'info', 'warn', 'error'];

export interface LogEntry {
  /** epoch ms ตอนเรียก (ยังไม่ format) */
  t: number;
  level: LevelName;
  /** namespace ของ logger เช่น 'shop:http' */
  ns: string;
  /** arguments แบบดิบ — lazy thunk ยังเป็น function อยู่ ให้ sink เป็นคน resolve (ดู resolveArgs) */
  args: unknown[];
  /** "ไฟล์:บรรทัด" ของ call site — มีเฉพาะเมื่อเปิด source capture (setSourceCapture) */
  src?: string;
}

/** ปลายทางของ log — Node ใช้ stdout/stderr, browser ใช้ ring buffer + console */
export interface Sink {
  minLevel: number;
  write(entry: LogEntry): void;
}

export type LogFn = (...args: unknown[]) => void;

export interface Logger {
  readonly name: string;
  /** namespace นี้ผ่านตัวกรอง ns หรือไม่ (อัปเดตตอน setFilter/refreshMasks) */
  enabled: boolean;
  trace: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  child(sub: string): Logger;
  /** level นี้จะไปถึง sink อย่างน้อยหนึ่งตัวหรือไม่ (ใช้กันเข้า code block ที่เตรียมข้อมูลแพง ๆ) */
  isEnabled(lv: Level): boolean;
}

const noop: LogFn = () => {};

interface LoggerInternal extends Logger {
  $: Record<LevelName, LogFn>;
}

// ---------------- state กลางของ core ----------------

const sinks: Sink[] = [];
let nsFilter: ((name: string) => boolean) | null = null;
const registry = new Set<LoggerInternal>();

function dispatch(log: LoggerInternal, lv: LevelName, args: unknown[]): void {
  // มาถึงตรงนี้ได้ = mask ยืนยันแล้วว่ามี sink รับ (เมธอดจริงถูกติดตั้งไว้เฉพาะตอนมี sink)
  const entry: LogEntry = { t: Date.now(), level: lv, ns: log.name, args };
  if (sourceCaptureOn) {
    const src = sourceFromStack(new Error().stack);
    if (src) entry.src = src;
  }
  const min = LEVELS[lv];
  for (const s of sinks) {
    if (s.minLevel <= min) s.write(entry);
  }
}

// ---------------- source capture: ไฟล์:บรรทัด ของ call site (opt-in) ----------------
// การจับ stack มีค่าใช้จ่าย (~µs ต่อครั้ง) จึงปิดไว้ default — เปิดด้วย setSourceCapture(true)
// หรือผ่าน config ของแต่ละ platform (Node: LOG_SRC=1 / browser: ?src=1, ELITJS_LOG_CONFIG.src)

let sourceCaptureOn = false;

/** เปิด/ปิดการจับ "ไฟล์:บรรทัด" ของที่เรียก log (มีผลทันทีกับทุก logger) */
export function setSourceCapture(on: boolean): void {
  sourceCaptureOn = on === true;
}

const LOC_RE = /((?:https?|file):\/\/\S+?|[\w./\\-]+\.[cm]?[jt]s):(\d+):(\d+)/;

function extractLoc(line: string): string | null {
  const m = LOC_RE.exec(line);
  return m ? `${m[1]}:${m[2]}` : null;
}

const fileOf = (loc: string): string => loc.slice(0, loc.lastIndexOf(':'));

// ชื่อไฟล์ของตัว logger เอง — ใช้กรอง frame ที่เป็นของ lib ออก (จับครั้งเดียวตอนโหลด module)
let ownFile: string | null = null;
try {
  for (const line of (new Error().stack ?? '').split('\n').slice(0, 3)) {
    const loc = extractLoc(line);
    if (loc) {
      ownFile = fileOf(loc);
      break;
    }
  }
} catch {
  // environment ไม่มี stack — source capture จะคืน null
}

/**
 * หา call site ของผู้เรียก log จาก stack string
 * frame ที่อยู่ในไฟล์ของ logger เองจะถูกข้าม — ถ้าทุก frame รวมเป็นไฟล์เดียวกันหมด
 * (กรณี bundle รวม lib กับ app เป็นไฟล์เดียว) จะ fallback ไปตำแหน่งโครงสร้าง
 * [dispatch, method, caller] = frame ที่ 3
 */
function sourceFromStack(stack: string | undefined): string | null {
  if (!stack) return null;
  const locs: string[] = [];
  for (const line of stack.split('\n')) {
    const loc = extractLoc(line);
    if (!loc) continue;
    if (fileOf(loc) !== ownFile) return loc;
    locs.push(loc);
  }
  return locs.length >= 3 ? locs[2] : null;
}

function applyMask(log: LoggerInternal): void {
  const nsOn = nsFilter ? nsFilter(log.name) : true;
  log.enabled = nsOn;
  for (const lv of METHODS) {
    const on = nsOn && sinks.some((s) => s.minLevel <= LEVELS[lv]);
    log[lv] = on ? log.$[lv] : noop;
  }
}

/** คำนวณ mask ใหม่ทุก logger — เรียกหลังแก้ minLevel ของ sink โดยตรง */
export function refreshMasks(): void {
  for (const log of registry) applyMask(log);
}

// ---------------- การ parse ค่า config ----------------

export function parseLevel(raw: unknown, fallback: Level): Level {
  if (raw == null || raw === '') return fallback;
  const lv = String(raw).trim().toLowerCase();
  return lv in LEVELS ? (lv as Level) : fallback;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * แปลง "app:*, -app:db" เป็น matcher function
 * - `*` เป็น wildcard, pattern ธรรมดาอย่าง `app` จะ match ทั้ง `app` และลูก `app:user`
 * - ขึ้นต้นด้วย `-` คือ exclude (เช็คก่อน include เสมอ)
 * - ระบุแต่ exclude = เปิดทุก namespace ที่ไม่โดน exclude
 */
export function parseNamespaces(raw: string | null | undefined): ((name: string) => boolean) | null {
  if (raw == null || String(raw).trim() === '') return null;
  const inc: { re: RegExp; prefix: string | null }[] = [];
  const exc: { re: RegExp; prefix: string | null }[] = [];
  for (let part of String(raw).split(',')) {
    part = part.trim();
    let negate = false;
    if (part.startsWith('-')) {
      negate = true;
      part = part.slice(1).trim();
    }
    if (!part) continue;
    const re = new RegExp('^' + part.split('*').map(escapeRe).join('.*') + '$');
    const prefix = part.includes('*') ? null : part;
    (negate ? exc : inc).push({ re, prefix });
  }
  const matches = (name: string, list: { re: RegExp; prefix: string | null }[]) =>
    list.some((e) => e.re.test(name) || (e.prefix != null && (name === e.prefix || name.startsWith(e.prefix + ':'))));
  return (name) => !matches(name, exc) && (inc.length === 0 || matches(name, inc));
}

// ---------------- จัดการ sink / config ----------------

export function addSink(sink: Sink): void {
  sinks.push(sink);
  refreshMasks();
}

export function removeSink(sink: Sink): void {
  const i = sinks.indexOf(sink);
  if (i >= 0) sinks.splice(i, 1);
  refreshMasks();
}

/** ตั้ง minLevel ของ "ทุก" sink (Node มี sink เดียวจึงเหมือน setLevel ตัวเดียว) — browser ใช้ setConsoleLevel แทน */
export function setLevel(level: string): void {
  const n = LEVELS[parseLevel(level, 'silent')];
  for (const s of sinks) s.minLevel = n;
  refreshMasks();
}

/** กรองด้วย namespace pattern เช่น 'shop:*, -shop:db' (null/'' = เปิดทั้งหมด) */
export function setFilter(raw: string | null | undefined): void {
  nsFilter = parseNamespaces(raw || null);
  refreshMasks();
}

export function createLogger(name = ''): Logger {
  const log = {
    name,
    enabled: false,
    child: (sub: string): Logger => createLogger(name ? `${name}:${sub}` : sub),
    isEnabled: (lv: Level): boolean => {
      const v = LEVELS[lv];
      return v !== undefined && log.enabled === true && sinks.some((s) => s.minLevel <= v);
    },
  } as LoggerInternal;
  log.$ = { trace: noop, debug: noop, info: noop, warn: noop, error: noop };
  for (const lv of METHODS) {
    log.$[lv] = (...args: unknown[]) => dispatch(log, lv, args);
  }
  applyMask(log);
  registry.add(log);
  return log;
}

// ---------------- resolve / format (isomorphic) ----------------

/**
 * แกะ lazy argument: ฟังก์ชันตัวแรกจะถูกเรียก
 * - คืน array = กระจายเป็น arguments ใหม่ (ธรรมเนียมเดียวกันทั้ง Node/browser)
 * - คืนค่าเดี่ยว = ใช้เป็น argument เดียว
 */
export function resolveArgs(args: unknown[]): unknown[] {
  if (typeof args[0] === 'function') {
    const r = (args[0] as () => unknown)();
    return Array.isArray(r) ? r : [r];
  }
  return args;
}

/** JSON.stringify ทน circular / Error / bigint / function ได้ (คืน string เสมอ) */
export function safeStringify(v: unknown): string {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(v, function (_k: string, value: unknown) {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value as object)) return '[Circular]';
        seen.add(value as object);
        if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
      }
      if (typeof value === 'bigint') return `${(value as bigint).toString()}n`;
      if (typeof value === 'function') return `[Function: ${(value as { name?: string }).name || 'anonymous'}]`;
      return value;
    });
    return json ?? String(v);
  } catch {
    return String(v);
  }
}

export function stringifyArg(v: unknown, oneLineErrors = false): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) {
    if (oneLineErrors || !v.stack) return `${v.name}: ${v.message}`;
    return v.stack;
  }
  if (typeof v === 'object' && v !== null) return safeStringify(v);
  return String(v);
}

export interface FormatOptions {
  /** true = Error แสดงแค่บรรทัดเดียว "Name: message" (เหมาะกับ view กระชับ เช่น panel) — stack เต็มอยู่ใน raw */
  oneLineErrors?: boolean;
}

/**
 * ฟอร์แมต message แบบ printf ตามธรรมเนียม console.log:
 * %s %d %f %j %o %% — arguments ที่เหลือจะถูกต่อท้าย (เหมือน util.format)
 * ใช้ใน browser (Node ใช้ util.formatWithOptions ซึ่งแสดง object สวยกว่า)
 */
export function formatMessage(args: unknown[], opts: FormatOptions = {}): string {
  const one = opts.oneLineErrors === true;
  const str = (v: unknown): string => stringifyArg(v, one);
  const a = resolveArgs(args);
  if (typeof a[0] === 'string') {
    let i = 1;
    const msg = (a[0] as string).replace(/%[sdfoj%]/g, (m) => {
      if (m === '%%') return '%';
      if (i >= a.length) return m;
      const v = a[i++];
      switch (m) {
        case '%s':
          return String(v);
        case '%d':
          return String(Math.trunc(Number(v)));
        case '%f':
          return String(Number(v));
        default:
          return safeStringify(v); // %j %o
      }
    });
    const parts = [msg];
    for (; i < a.length; i++) parts.push(str(a[i]));
    return parts.join(' ');
  }
  return a.map(str).join(' ');
}
