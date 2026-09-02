/**
 * @elitjs/log — browser entry
 *
 * import { createLogger } from './dist/browser.js'   (หรือ '@elitjs/log/browser')
 *
 * หัวใจคือ "console สะอาด แต่ log ไม่หาย":
 *   - ring buffer เก็บทุก entry (trace ขึ้นไป) ไว้ใน memory ของหน้าเว็บ
 *     โดยเก็บ args แบบดิบ ไม่ format — การ serialize จะเกิดตอน DevTools panel ขอดูเท่านั้น
 *     (เปิด/ปิด console ไม่กระทบ buffer เป็นอย่างไร — panel เห็นครบเสมอ)
 *   - console echo คุมแยกได้ว่าจะแสดง/ไม่แสดง หรือแสดงถึง level ไหน
 *
 * การ config console echo (ลำดับ priority สูง → ต่ำ):
 *   1. installBrowser({ console: false })          — เรียกตอนไหนก็ได้ หรือส่งตอนเริ่ม
 *   2. window.ELITJS_LOG_CONFIG = { console: false }   — ใส่ก่อน import ตัว lib
 *   3. ?console=<ค่า> ใน URL                        — (alias เดิม: ?log=<level>)
 *   4. localStorage 'elitjs.log.console'               — (alias เดิม: 'elitjs.log.level')
 *   5. default 'warn' (error/warn ยังขึ้น console เสมอ)
 *
 * ค่าที่ใช้ config console ได้:
 *   false | '0' | 'off' | 'silent'  → ไม่แสดงใน console เลย
 *   true  | '1'  | 'on'             → แสดงทุกอย่าง (เท่ากับ 'debug')
 *   'trace' | 'debug' | 'info' | 'warn' | 'error' → แสดงถึง level นั้น
 *
 * นอกจาก console ยัง config ผ่านช่องทางเดียวกันได้อีก:
 *   ?ns=<pattern> / elitjs.log.ns   = กรอง namespace เช่น shop:*,-shop:db
 *   ?cap=<n>    / elitjs.log.cap    = ขนาด ring buffer (default 1000)
 *
 * ตัว DevTools extension คุยผ่าน global `window.__ELITJS_LOG__`:
 *   dump(sinceSeq?), clear(), setConsoleLevel(v), setFilter(pattern), setCap(n), getState()
 */
import { LEVELS, addSink, createLogger, formatMessage, refreshMasks, resolveArgs, safeStringify, setFilter, setSourceCapture } from './core.ts';
import type { Level, LevelName, LogEntry, Sink, Logger } from './core.ts';

export { createLogger, setFilter } from './core.ts';
export type { Level, LevelName, LogEntry, Sink, Logger, LogFn } from './core.ts';

export interface DumpEntry {
  seq: number;
  /** epoch ms */
  t: number;
  level: LevelName;
  ns: string;
  /** message ที่ format แล้ว (printf-style) */
  msg: string;
  /** "ไฟล์:บรรทัด" ของ call site — null ถ้าปิด source capture ไว้ */
  src: string | null;
  /** arguments ทั้งหมดแบบ JSON (สำหรับ detail view) — null ถ้าไม่มี */
  raw: string | null;
}

export interface ElitjsLogState {
  /** master switch — ปิดอยู่ = ดับทุกอย่าง (console + ring buffer) panel จะไม่เห็น log */
  enabled: boolean;
  consoleLevel: Level;
  ns: string | null;
  cap: number;
  /** เปิดจับ "ไฟล์:บรรทัด" ของ call site อยู่หรือไม่ */
  src: boolean;
  /** ring buffer เปิดอยู่หรือไม่ (prod ปิด default — ปิดแล้ว panel จะไม่เห็น log) */
  buffer: boolean;
}

export interface DumpResult {
  lastSeq: number;
  entries: DumpEntry[];
  state: ElitjsLogState;
}

export interface ElitjsLogGlobal {
  version: string;
  dump(sinceSeq?: number): DumpResult;
  clear(): void;
  /** master switch: ปิด = ดับทุก sink (panel เห็นแค่สถานะ), เปิด = กลับมาตาม config (buffer ถูกเปิดคืนให้ดูใน panel ได้เลย) */
  setEnabled(on: boolean): void;
  setConsoleLevel(level: string | boolean): void;
  setFilter(pattern: string | null): void;
  setCap(n: number): void;
  getState(): ElitjsLogState;
}

/** config ของฝั่ง browser — ใช้ได้ทั้งผ่าน window.ELITJS_LOG_CONFIG และ installBrowser(opts) */
export interface BrowserConfig {
  /**
   * คุม console echo:
   * - false / 'silent' → ไม่แสดงใน console เลย (log ยังเข้า ring buffer ให้ panel เสมอ)
   * - true → แสดงทุกอย่าง (เท่ากับ 'debug')
   * - หรือระบุ level ตรง ๆ 'trace' | 'debug' | 'info' | 'warn' | 'error'
   */
  console?: Level | boolean;
  /** กรอง namespace เช่น 'shop:*' (null = เปิดทั้งหมด) */
  ns?: string | null;
  /** ขนาด ring buffer */
  cap?: number;
  /**
   * เปิดจับ "ไฟล์:บรรทัด" ของที่เรียก log (จับจาก stack ตอน log — มีค่าใช้จ่ายหลักสิบ µs/ครั้ง (วัดจริง ~25µs ใน Node)
   * จึงปิดไว้ default และเปิดเฉพาะตอน debug จริง ๆ)
   */
  src?: boolean;
  /**
   * เปิด ring buffer (ที่ DevTools panel อ่าน) — default: เปิดใน dev / ปิดเมื่อ build แบบ production
   * (ดู detectProd) — สั่งเปิดคืนตอน debug ใน prod ได้ด้วย ?enabled=1
   */
  buffer?: boolean;
  /**
   * master switch ของ log ทั้งหน้า:
   * - false → ดับทุกอย่าง (console echo + ring buffer) — extension panel จะไม่เห็น log
   * - true → ทำงานตาม config อื่น (เปิดแบบนี้ใน prod จะได้ buffer กลับมาให้ panel เลย)
   * - default: เปิดใน dev / ปิดเมื่อ NODE_ENV=production|prod (ดู detectProd)
   */
  enabled?: boolean;
}

// ---------------- ring buffer ----------------

interface BufferedEntry {
  seq: number;
  t: number;
  level: LevelName;
  ns: string;
  src?: string;
  args: unknown[]; // ยังเป็นดิบ (thunk ยังไม่ถูกเรียก)
}

const VERSION = '0.6.0';
let buffer: BufferedEntry[] = [];
let seqCounter = 0;
let cap = 1000;

const bufferSink: Sink = {
  minLevel: LEVELS.trace, // buffer บันทึกทุกอย่างเสมอ (ต้นทุนแค่ push array)
  write(e: LogEntry): void {
    buffer.push({ seq: ++seqCounter, t: e.t, level: e.level, ns: e.ns, src: e.src, args: e.args });
    // compact เป็นระยะ (ไม่ใช่ทุก push) เพื่อ amortized O(1)
    if (buffer.length > cap + 256) buffer.splice(0, buffer.length - cap);
  },
};

// ---------------- console echo ----------------

let consoleLevel: Level = 'warn';

// หาฟังก์ชัน console ตอนเขียนจริง (ไม่ capture ตอนโหลด module)
// เพื่อให้เคารพการที่ถูก monkey-patch ภายหลัง เช่น โดย test runner
function consoleFn(level: LevelName): (...args: unknown[]) => void {
  switch (level) {
    case 'error':
      return console.error;
    case 'warn':
      return console.warn;
    case 'info':
      return console.info;
    default:
      return console.log;
  }
}

const consoleSink: Sink = {
  minLevel: LEVELS.warn,
  write(e: LogEntry): void {
    const args = resolveArgs(e.args);
    const time = new Date(e.t).toISOString().slice(11, 23);
    const badge = e.level.toUpperCase().padEnd(5);
    // %c สีต่างกันต่อช่วง: เวลา (เทา) / badge (สีตาม level) / ns (หม่น)
    const colors: Record<LevelName, string> = {
      trace: 'color:#9e9e9e',
      debug: 'color:#4dd0e1',
      info: 'color:#81c784',
      warn: 'color:#ffb74d',
      error: 'color:#e57373',
    };
    consoleFn(e.level)(
      `%c${time}%c ${badge} %c${e.ns || '-'}%c ${formatMessage(args)}`,
      'color:#9e9e9e',
      colors[e.level],
      'color:#9e9e9e',
      'color:inherit',
    );
  },
};

// ---------------- config จาก query / localStorage ----------------

function clampInt(raw: string | number | null | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * แปลงค่า config ของ console เป็น Level — คืน null เมื่อไม่ระบุ/ค่าไม่ถูกต้อง (ให้ไปใช้ default)
 * รองรับทั้งแบบ boolean ('0'/'off'/'on'/'1' ฯลฯ) และชื่อ level ตรง ๆ
 */
export function parseConsoleSpec(raw: string | null | undefined): Level | null {
  if (raw == null || String(raw).trim() === '') return null;
  const v = String(raw).trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off' || v === 'none' || v === 'no' || v === 'hide') return 'silent';
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes' || v === 'all' || v === 'show') return 'debug';
  return v in LEVELS ? (v as Level) : null;
}

/** boolean → Level (true = แสดงทุกอย่าง, false = silent) แล้วผ่าน parseConsoleSpec ต่อ */
function normalizeConsole(v: Level | boolean | string | undefined): Level | null {
  if (v === undefined) return null;
  if (v === true) return 'debug';
  if (v === false) return 'silent';
  return parseConsoleSpec(v);
}

function parseBool(raw: string | null | undefined): boolean | null {
  if (raw == null || String(raw).trim() === '') return null;
  const v = String(raw).trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
  if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
  return null;
}

/**
 * ตรวจว่ากำลังรันแบบ production หรือไม่
 * - bundler (webpack/vite) จะแทน process.env.NODE_ENV ให้เป็นค่าคงที่ตอน build
 * - Vite แทน import.meta.env.PROD = true ใน production build
 * - กรณีรันเปล่า ๆ ใน browser โดยไม่ผ่าน bundler จะไม่มีค่าพวกนี้ → ถือว่าเป็น dev
 */
export function detectProd(): boolean {
  try {
    const pe = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    const nodeEnv = pe?.env?.NODE_ENV;
    if (typeof nodeEnv === 'string') {
      const v = nodeEnv.trim().toLowerCase();
      if (v === 'production' || v === 'prod') return true;
    }
  } catch {
    /* ignore */
  }
  try {
    const im = (import.meta as unknown as { env?: { PROD?: boolean; MODE?: string } }).env;
    if (im?.PROD === true) return true;
    if (typeof im?.MODE === 'string' && im.MODE.trim().toLowerCase() === 'production') return true;
  } catch {
    /* ignore */
  }
  return false;
}

// ---------------- install ----------------

let installed = false;
let nsRawState: string | null = null;
let srcEnabled = false;
let bufferOn = true;
let enabledOn = true;
// console เป็น silent เพราะ prod default (ไม่ใช่ผู้ใช้สั่งเอง) — ตอน master เปิดคืนให้กลับเป็น warn
let consoleDefaultedInProd = false;
let api: ElitjsLogGlobal | null = null;

/** คำนวณ minLevel ของ sink ทั้งสองจากสถานะปัจจุบัน (master + ค่าย่อย) แล้ว remask */
function syncSinks(): void {
  bufferSink.minLevel = enabledOn && bufferOn ? LEVELS.trace : LEVELS.silent;
  consoleSink.minLevel = enabledOn ? LEVELS[consoleLevel] : LEVELS.silent;
  refreshMasks();
}

function setBuffer(on: boolean): void {
  bufferOn = on === true;
  if (!bufferOn) buffer = [];
  syncSinks();
}

/** master switch ตอน runtime — เปิดแล้ว buffer กลับมาให้ panel ดูได้เลย */
function setEnabledInternal(on: boolean): void {
  enabledOn = on === true;
  if (enabledOn) {
    bufferOn = true;
    if (consoleDefaultedInProd) {
      consoleLevel = 'warn';
      consoleDefaultedInProd = false;
    }
  } else {
    buffer = [];
  }
  syncSinks();
}

/** ปรับ config เฉพาะ field ที่ระบุมา (undefined = ไม่แตะ) */
function applyConfig(cfg: BrowserConfig): void {
  if (!api) return;
  if (cfg.enabled !== undefined) setEnabledInternal(cfg.enabled);
  const c = normalizeConsole(cfg.console);
  if (c != null) {
    consoleLevel = c;
    consoleDefaultedInProd = false;
    syncSinks();
  }
  if (cfg.ns !== undefined) api.setFilter(cfg.ns || null);
  if (cfg.cap != null) api.setCap(clampInt(cfg.cap, cap, 10, 100_000));
  if (cfg.src !== undefined) {
    srcEnabled = cfg.src === true;
    setSourceCapture(srcEnabled);
  }
  if (cfg.buffer !== undefined) setBuffer(cfg.buffer);
}

/**
 * ติดตั้ง @elitjs/log ลง browser (auto ตอน import เมื่อมี window) — เรียกซ้ำเพื่อเปลี่ยน config ตอน runtime ได้
 * priority: opts ที่ส่งตรงนี้ > window.ELITJS_LOG_CONFIG > query (?console/?log) > localStorage > default 'warn'
 */
export function installBrowser(opts: BrowserConfig = {}): ElitjsLogGlobal {
  if (!installed) {
    installed = true;

    const q = new URLSearchParams(location.search);
    const ls = typeof localStorage !== 'undefined' ? localStorage : null;
    // แกะค่าที่ระบุมาชัด ๆ จากแต่ละช่องทางก่อน (null = ไม่ได้ระบุ ให้ไปตัดสินที่ default)
    const prod = detectProd();
    const pre = (globalThis as { ELITJS_LOG_CONFIG?: BrowserConfig }).ELITJS_LOG_CONFIG ?? {};
    const consoleCh = normalizeConsole(pre.console) ??
      parseConsoleSpec(q.get('console') ?? q.get('log') ?? ls?.getItem('elitjs.log.console') ?? ls?.getItem('elitjs.log.level'));
    const bufferCh = pre.buffer ?? parseBool(q.get('buffer') ?? ls?.getItem('elitjs.log.buffer'));
    const enabledCh = pre.enabled ?? parseBool(q.get('enabled') ?? ls?.getItem('elitjs.log.enabled'));

    // master switch: default ปิดใน production/prod — ปิดแล้ว console+buffer ดับหมด (panel เห็น enabled:false)
    // ถ้าสั่งเปิดชัด ๆ (enabledCh === true) ให้ sub-default เป็นแบบ dev เพื่อเปิดดูใน panel ได้ทันที
    const likeDev = enabledCh === true || !prod;
    const resolved: BrowserConfig = {
      enabled: enabledCh ?? !prod,
      console: enabledCh === false ? 'silent' : (consoleCh ?? (likeDev ? 'warn' : 'silent')),
      ns: pre.ns !== undefined ? pre.ns : (q.get('ns') ?? ls?.getItem('elitjs.log.ns') ?? null),
      cap: pre.cap != null ? pre.cap : clampInt(q.get('cap') ?? ls?.getItem('elitjs.log.cap'), 1000, 10, 100_000),
      src: pre.src !== undefined ? pre.src : (parseBool(q.get('src') ?? ls?.getItem('elitjs.log.src')) ?? false),
      buffer: enabledCh === false ? false : (bufferCh ?? likeDev),
    };

    api = {
      version: VERSION,
      dump(sinceSeq = 0): DumpResult {
        let start = 0;
        while (start < buffer.length && buffer[start].seq <= sinceSeq) start++;
        const entries = buffer.slice(start).map((e): DumpEntry => {
          const args = resolveArgs(e.args); // thunk ถูกเรียกครั้งแรกตอนนี้ — เฉพาะตอนที่มีคนดูจริง ๆ
          const raw = args.length === 0 ? null : safeStringify(args);
          // oneLineErrors: แถวใน panel กระชับ แค่บรรทัดเดียว — stack เต็มอยู่ใน raw (กดที่แถวเพื่อดู)
          return { seq: e.seq, t: e.t, level: e.level, ns: e.ns, msg: formatMessage(args, { oneLineErrors: true }), src: e.src ?? null, raw };
        });
        return { lastSeq: seqCounter, entries, state: api!.getState() };
      },
      clear(): void {
        buffer = [];
        // ไม่รีเซ็ต seqCounter — seq ยัง monotonic เพื่อ logic sinceSeq ของ panel
      },
      setConsoleLevel(level: string | boolean): void {
        consoleLevel = normalizeConsole(level) ?? consoleLevel;
        syncSinks();
      },
      setEnabled(on: boolean): void {
        setEnabledInternal(on);
      },
      setFilter(pattern: string | null): void {
        nsRawState = pattern || null;
        setFilter(nsRawState);
      },
      setCap(n: number): void {
        cap = clampInt(n, cap, 10, 100_000);
        if (buffer.length > cap) buffer.splice(0, buffer.length - cap);
      },
      getState(): ElitjsLogState {
        // buffer รายงานค่า effective — master ปิดอยู่แม้ bufferOn=true ก็ถือว่าปิด (sink ไม่ทำงานจริง)
        return { enabled: enabledOn, consoleLevel, ns: nsRawState, cap, src: srcEnabled, buffer: enabledOn && bufferOn };
      },
    };

    (globalThis as { __ELITJS_LOG__?: ElitjsLogGlobal }).__ELITJS_LOG__ = api;
    addSink(bufferSink);
    addSink(consoleSink);
    applyConfig(resolved);
    // ตั้งทีหลัง applyConfig — branch console ของ applyConfig จะรีเซ็ต flag นี้เสมอ
    // (ใช้บอกว่า console เป็น silent เพราะ prod default ไม่ใช่ผู้ใช้สั่ง เพื่อคืนค่าตอน master เปิด)
    consoleDefaultedInProd = enabledCh !== true && prod && consoleCh == null;
  }
  applyConfig(opts); // เรียกซ้ำครั้งหลัง = ปรับ config ตอน runtime
  return api!;
}

if (typeof window !== 'undefined') {
  installBrowser();
}

/** เปลี่ยน console echo จาก code ได้ (ไม่กระทบ ring buffer ซึ่งเก็บทุกอย่างอยู่แล้ว) */
export function setConsoleLevel(level: string | boolean): void {
  if (api) api.setConsoleLevel(level);
}

/** master switch จาก code: false = ดับทุกอย่าง (panel ไม่เห็น log) / true = กลับมาตาม config */
export function setEnabled(on: boolean): void {
  if (api) api.setEnabled(on);
}

/** logger กลางๆ สำหรับใช้เร็ว ๆ: import log from './dist/browser.js' */
const root: Logger = createLogger();
export default root;
