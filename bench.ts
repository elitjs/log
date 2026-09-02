/**
 * เทียบ overhead ของ console.log กับ @elitjs/log
 *
 * รันแบบ redirect output ทิ้ง เพื่อวัดแต่ตัว lib (ไม่ใช่ค่า render จอ):
 *   Git Bash / macOS / Linux:   node bench.ts > /dev/null
 *   PowerShell / cmd:           node bench.ts > $null   (หรือ > NUL)
 *
 * ปรับได้:  N=1000000 ROUNDS=5 node bench.ts > /dev/null
 * แต่ละ case ถูกรันหลายรอบแบบ interleave แล้วเอาค่าที่เร็วที่สุด (ลด noise จาก GC/ลำดับการรัน)
 */
import { createLogger, setLevel } from './src/node.ts';

const N = Number(process.env.N || 200_000);
const ROUNDS = Number(process.env.ROUNDS || 3);
const user = { id: 7, name: 'alice', roles: ['admin', 'user'] };
const log = createLogger('bench');

const cases: { name: string; prepare: (() => void) | null; fn: (i: number) => void }[] = [
  { name: 'console.log("hello")', prepare: null, fn: () => console.log('hello') },
  {
    name: 'console.log + ต่อ string + JSON.stringify',
    prepare: null,
    fn: () => console.log('user ' + user.name + ' ' + JSON.stringify(user)),
  },
  {
    name: '@elitjs/log ปิด: log.debug("user %s %j",...)',
    prepare: () => setLevel('error'),
    fn: () => log.debug('user %s %j', user.name, user),
  },
  {
    name: '@elitjs/log ปิด: log.debug(() => [...]) lazy',
    prepare: () => setLevel('error'),
    fn: () => log.debug(() => ['user %s %j', user.name, user]),
  },
  {
    name: '@elitjs/log เปิด: log.info("hello")',
    prepare: () => setLevel('debug'),
    fn: () => log.info('hello'),
  },
];

if (process.stdout.isTTY) {
  process.stderr.write('⚠  stdout กำลังต่อกับ terminal — แนะนำรันเป็น: node bench.ts > /dev/null\n');
}

const perRound = Math.max(1_000, Math.floor(N / ROUNDS));
const best = new Map<(typeof cases)[number], number>();

for (let r = 0; r < ROUNDS; r++) {
  for (const c of cases) {
    if (c.prepare) c.prepare();
    for (let i = 0; i < 1_000; i++) c.fn(i); // warmup
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < perRound; i++) c.fn(i);
    const ns = Number(process.hrtime.bigint() - t0) / perRound;
    const prev = best.get(c);
    if (prev === undefined || ns < prev) best.set(c, ns);
  }
}

const w = Math.max(...cases.map((c) => c.name.length));
process.stderr.write(`\nจำนวน ${perRound.toLocaleString('en-US')} calls/รอบ × ${ROUNDS} รอบ (ค่าที่ดีที่สุด):\n\n`);
for (const c of cases) {
  const ns = best.get(c) ?? 0;
  const ops = Math.round(1e9 / ns).toLocaleString('en-US');
  process.stderr.write(`${c.name.padEnd(w)}   ${ns.toFixed(1).padStart(8)} ns/op   ${ops.padStart(13)} ops/s\n`);
}
