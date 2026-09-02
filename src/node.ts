/**
 * @elitjs/log — Node entry
 *
 * import { createLogger } from './src/node.ts'   (หรือ '@elitjs/log' หลัง build -> dist/node.js)
 *
 * env (อ่านตอน import ครั้งแรก หรือตอนเรียก refresh()):
 *   LOG_LEVEL = trace | debug | info | warn | error | silent
 *               (default: debug ใน dev / warn ตอน NODE_ENV=test / info ตอน production)
 *   LOG_NS    = กรอง namespace เช่น "shop:*, -shop:db" (ใช้ DEBUG เป็น alias ได้)
 *   LOG_TIME  = time (default) | iso | ms | none
 *   NO_COLOR  = ตั้งค่าไว้เพื่อปิดสี (สีทำงานเฉพาะตอน output เป็น TTY อยู่แล้ว)
 */
import { formatWithOptions } from 'node:util';
import { LEVELS, addSink, createLogger, parseLevel, parseNamespaces, refreshMasks, resolveArgs, setFilter, setLevel, setSourceCapture } from './core.ts';
import type { Level, LogEntry, Sink, Logger } from './core.ts';

export { createLogger, setLevel, setFilter, refreshMasks, LEVELS } from './core.ts';
export type { Level, LevelName, LogEntry, Sink, Logger, LogFn } from './core.ts';

// ---------------- ANSI / badge (precompute ตอนโหลด) ----------------

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};
const BADGE: Record<string, { label: string; color: string; plain: string; colored: string }> = {
  trace: { label: 'TRACE', color: C.gray, plain: '', colored: '' },
  debug: { label: 'DEBUG', color: C.cyan, plain: '', colored: '' },
  info: { label: 'INFO', color: C.green, plain: '', colored: '' },
  warn: { label: 'WARN', color: C.yellow, plain: '', colored: '' },
  error: { label: 'ERROR', color: C.red, plain: '', colored: '' },
};
for (const b of Object.values(BADGE)) {
  b.plain = b.label.padEnd(5);
  b.colored = b.color + b.plain + C.reset;
}
const FMT_PLAIN = { colors: false, depth: 4, breakLength: Infinity };
const FMT_COLOR = { colors: true, depth: 4, breakLength: Infinity };

// ---------------- timestamp: แคชระดับวินาที ----------------
// toISOString() แพง (~800ns) จึงคำนวณแค่ครั้งเดียวตอนข้ามวินาที เหลือ per-call แค่ Date.now()

let timeMode = 'time';
let tsCacheSec = -1;
let tsCacheTime = '';
let tsCacheIso = '';

function timePart(): string | null {
  if (timeMode === 'none') return null;
  const now = Date.now();
  if (timeMode === 'ms') return String(now);
  const sec = Math.floor(now / 1000);
  if (sec !== tsCacheSec) {
    tsCacheSec = sec;
    const iso = new Date(sec * 1000).toISOString(); // YYYY-MM-DDTHH:MM:SS.000Z
    tsCacheTime = iso.slice(11, 19);
    tsCacheIso = iso;
  }
  const ms = String(now % 1000).padStart(3, '0');
  if (timeMode === 'iso') return tsCacheIso.slice(0, 20) + ms + 'Z';
  return tsCacheTime + '.' + ms; // HH:MM:SS.mmm (UTC)
}

// ---------------- sink: stdout/stderr ----------------

let outStream = process.stdout;
let errStream = process.stderr;
let outColor = false;
let errColor = false;

function recolor(): void {
  const no = !!process.env.NO_COLOR;
  outColor = !no && outStream.isTTY === true;
  errColor = !no && errStream.isTTY === true;
}

/** เปลี่ยน stream ปลายทาง (ใช้ใน test — production ไม่ต้องเรียก) */
export function setNodeStreams(opts: { out?: { write(s: string): void; isTTY?: boolean }; err?: { write(s: string): void; isTTY?: boolean } }): void {
  outStream = (opts.out ?? process.stdout) as typeof outStream;
  errStream = (opts.err ?? process.stderr) as typeof errStream;
  recolor();
}

export const nodeSink: Sink = {
  minLevel: LEVELS.info,
  write(e: LogEntry): void {
    const toErr = LEVELS[e.level] >= LEVELS.warn;
    const stream = toErr ? errStream : outStream;
    const color = toErr ? errColor : outColor;
    let line = '';
    const t = timePart();
    if (t) line += (color ? C.dim + t + C.reset : t) + ' ';
    line += (color ? BADGE[e.level].colored : BADGE[e.level].plain) + ' ';
    if (e.ns) line += (color ? C.dim + e.ns + C.reset : e.ns) + ' ';
    line += formatWithOptions(color ? FMT_COLOR : FMT_PLAIN, ...resolveArgs(e.args));
    if (e.src) line += ' ' + (color ? C.dim + `(${e.src})` + C.reset : `(${e.src})`);
    stream.write(line + '\n');
  },
};

// ---------------- env ----------------

function defaultLevel(): Level {
  const env = (process.env.NODE_ENV ?? '').trim().toLowerCase();
  // production/prod → ปิด log เลย (silent = ทุก method เป็น noop)
  // ตั้ง LOG_LEVEL ชัด ๆ จะชนะ default นี้ได้ เช่น LOG_LEVEL=error ใน prod เพื่อดูแต่ error
  if (env === 'production' || env === 'prod') return 'silent';
  if (env === 'test') return 'warn';
  return 'debug';
}

function parseTimeMode(raw: string | undefined): string {
  const v = raw == null ? '' : raw.trim().toLowerCase();
  if (v === 'none' || v === '0' || v === 'false' || v === 'off') return 'none';
  if (v === 'ms') return 'ms';
  if (v === 'iso') return 'iso';
  return 'time';
}

const LEVEL_BY_VALUE = new Map<number, Level>(Object.entries(LEVELS).map(([k, v]) => [v, k as Level]));

export function getLevel(): Level {
  return LEVEL_BY_VALUE.get(nodeSink.minLevel) ?? 'info';
}

/** อ่าน env ใหม่อีกครั้ง (มีผลกับ sink ทุกตัว เช่นเดิม) */
export function refresh(): Level {
  timeMode = parseTimeMode(process.env.LOG_TIME);
  nodeSink.minLevel = LEVELS[parseLevel(process.env.LOG_LEVEL, defaultLevel())];
  // LOG_ENABLED=0 → master switch ปิด ดับหมดไม่สน LOG_LEVEL (LOG_ENABLED=1 → ใช้ LOG_LEVEL ตามปกติ)
  if (envBool(process.env.LOG_ENABLED) === false) nodeSink.minLevel = LEVELS.silent;
  setFilter(process.env.LOG_NS || process.env.DEBUG || null);
  setSourceCapture(isTruthy(process.env.LOG_SRC));
  recolor();
  refreshMasks();
  return getLevel();
}

function isTruthy(raw: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((raw ?? '').trim().toLowerCase());
}

/** แปลง env เป็น boolean แบบสามค่า (null = ไม่ได้ตั้ง) */
function envBool(raw: string | undefined): boolean | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return null;
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return null;
}

let levelBeforeDisable: Level | null = null;

/** master switch ตอน runtime: ปิด = ทุก method เป็น noop / เปิด = กลับไป level ก่อนปิด (หรือตาม env) */
export function setEnabled(on: boolean): void {
  if (on) {
    nodeSink.minLevel = LEVELS[levelBeforeDisable ?? parseLevel(process.env.LOG_LEVEL, defaultLevel())];
    levelBeforeDisable = null;
  } else {
    levelBeforeDisable = getLevel();
    nodeSink.minLevel = LEVELS.silent;
  }
  refreshMasks();
}

addSink(nodeSink);
refresh();

/** logger กลางๆ สำหรับใช้เร็ว ๆ: import log from './src/node.ts' */
const root: Logger = createLogger();
export default root;
