import { windAt } from "./wind";
import { createContacts, indexContacts, queryContacts, type ContactBuckets } from "./contacts";
// Fixed-step water on a sphere. All macroscopic drops have state; only fine condensation is
// procedural. Every macroscopic drop uses the same projected surface geometry as its contact test.
// Plain data and worklets let the same simulation run on React Native's UI thread. Swift and
// Kotlin follow the same operations, including the seeded random sequence and Newton cube root.
export const RAIN_DROPS = 384;
export const RAIN_TRAILS = 48;
export const RAIN_TRAIL_SLOTS = 8;
const PATH = 12;
const DRY = 8;
const STEPS = 60;
const GRAVITY = 0.0009;
const PIN = 0.0015;
const TOP = 0.014;

export interface RainLayout {
  counts: number;
  drops: number;
  pool: number;
  trails: number;
  amount: number;
  density: number;
  spawn: number;
  direction: number;
  /** Optional extension in format 7; older programs retain their flow-aligned arrivals. */
  angle?: number;
  enabled?: number;
  wind?: number;
  mist?: number;
  size?: number;
  windSpeed?: number;
  gusts?: number;
  turbulence?: number;
}
export interface RainProgram {
  rain: RainLayout;
  static: ArrayLike<number>;
  staticSlot: number;
}
export interface RainData {
  /** Rebuilt each fixed step; not part of the simulated water state. */
  contacts: ContactBuckets;
  done: number;
  frac: number;
  seed: number;
  /** Seconds on the scene clock; wet trails keep ageing when rain stops. */
  time: number;
  /** Last integrated rain clock, used to timestamp fixed steps within a frame. */
  tau: number;
  paused: boolean;
  pausedAt: number;
  /** Whether generated/shed water remains, independent of authored-drop amount. */
  dynamic: boolean;
  /** Water deposited into the thin wet film, in the same r³ units as the lobes. */
  film: number;
  /** 0 absent, 1 attached, 2 draining into another, 3 detached at the bottom. */
  live: number[];
  x: number[];
  y: number[];
  z: number[];
  r: number[];
  /** Motion deformation eases independently of the water volume. */
  stretch: number[];
  pstretch: number[];
  /** The footprint turns gradually; a collision impulse must not rotate it in one frame. */
  heading: number[];
  pheading: number[];
  px: number[];
  py: number[];
  pr: number[];
  goal: number[];
  vx: number[];
  vy: number[];
  vz: number[];
  stick: number[];
  last: number[];
  /** Surface distance before the next opportunity to leave residual water. */
  shed: number[];
  age: number[];
  /** Total surface distance, retained when authored rain is replenished. */
  travel: number[];
  /** Steps spent settling after an absorption. */
  hold: number[];
  /** One contact pair at a time: both lobes stay allocated until fully integrated. */
  pair: number[];
  started: number[];
  phase: number[];
  pphase: number[];
  mass: number[];
  radius0: number[];
  render0: number[];
  joinx: number[];
  joiny: number[];
  joinz: number[];
  /** Authored drop index, or -1 for incoming rain and shed beads. */
  own: number[];
  /** Original geometry is still untouched. */
  untouched: number[];
  /** Paths are independent of drop slots, so absorbed drops leave fading paths. */
  /** Rain indices below RAIN_DROPS, snow indices above it; -1 freezes a released path. */
  owner: number[];
  /** Authored rain index, -1 for spontaneous rain, -2 for snow meltwater. */
  source: number[];
  path: number[];
  count: number[];
  width: number[];
  stamp: number[];
}
function zeros(n: number): number[] {
  "worklet";
  return Array.from({ length: n }, () => 0);
}
function rand(rain: RainData): number {
  "worklet";
  const t = (rain.seed + 0x6d2b79f5) | 0;
  rain.seed = t;
  let r = Math.imul(t ^ (t >>> 15), t | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
}
/** Avoid platform-dependent pow/cbrt rounding in collision decisions. */
function root(v: number): number {
  "worklet";
  if (v <= 0) return 0;
  let r = 0.2;
  for (let k = 0; k < 12; k++) r = (2 * r + v / (r * r)) / 3;
  return r;
}
function ease(lo: number, hi: number, value: number): number {
  "worklet";
  const t = Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}
function place(rain: RainData, i: number, x: number, y: number, r: number, own: number): void {
  "worklet";
  rain.live[i] = 1;
  rain.x[i] = x;
  rain.y[i] = y;
  rain.z[i] = Math.sqrt(Math.max(0.0001, 1 - x * x - y * y));
  rain.r[i] = r;
  rain.stretch[i] = 0;
  rain.pstretch[i] = 0;
  rain.heading[i] = -Math.PI / 2;
  rain.pheading[i] = -Math.PI / 2;
  rain.px[i] = x;
  rain.py[i] = y;
  rain.pr[i] = r;
  rain.goal[i] = r;
  rain.vx[i] = 0;
  rain.vy[i] = 0;
  rain.vz[i] = 0;
  rain.stick[i] = 0.55 + rand(rain) * 0.9;
  rain.last[i] = 0;
  rain.shed[i] = 0.12 + 0.32 * rand(rain);
  rain.age[i] = 0;
  rain.hold[i] = 0;
  rain.pair[i] = -1;
  rain.phase[i] = 0;
  rain.pphase[i] = 0;
  rain.own[i] = own;
  rain.untouched[i] = own >= 0 ? 1 : 0;
}
export function createRain(program: RainProgram): RainData {
  "worklet";
  const n = RAIN_DROPS;
  const rain: RainData = {
    contacts: createContacts(n),
    done: 0,
    frac: 0,
    seed: 0x2f6b9d35,
    time: 0,
    tau: 0,
    paused: false,
    pausedAt: 0,
    dynamic: false,
    film: 0,
    live: zeros(n),
    x: zeros(n),
    y: zeros(n),
    z: zeros(n),
    r: zeros(n),
    stretch: zeros(n),
    pstretch: zeros(n),
    heading: Array.from({ length: n }, () => -Math.PI / 2),
    pheading: Array.from({ length: n }, () => -Math.PI / 2),
    px: zeros(n),
    py: zeros(n),
    pr: zeros(n),
    goal: zeros(n),
    vx: zeros(n),
    vy: zeros(n),
    vz: zeros(n),
    stick: zeros(n),
    last: zeros(n),
    shed: zeros(n),
    age: zeros(n),
    travel: zeros(n),
    hold: zeros(n),
    pair: Array.from({ length: n }, () => -1),
    started: zeros(n),
    phase: zeros(n),
    pphase: zeros(n),
    mass: zeros(n),
    radius0: zeros(n),
    render0: zeros(n),
    joinx: zeros(n),
    joiny: zeros(n),
    joinz: zeros(n),
    own: Array.from({ length: n }, () => -1),
    untouched: zeros(n),
    owner: Array.from({ length: RAIN_TRAILS }, () => -1),
    source: Array.from({ length: RAIN_TRAILS }, () => -1),
    path: zeros(RAIN_TRAILS * PATH * 2),
    count: zeros(RAIN_TRAILS),
    width: zeros(RAIN_TRAILS),
    stamp: zeros(RAIN_TRAILS * PATH),
  };
  const count = program.static[(program.rain.counts - program.staticSlot) * 4]!;
  for (let i = 0; i < count; i++) {
    const at = (program.rain.drops - program.staticSlot + i) * 4;
    place(
      rain,
      i,
      Math.fround(program.static[at]!),
      Math.fround(program.static[at + 1]!),
      Math.fround(program.static[at + 2]!),
      i,
    );
  }
  return rain;
}
/** Place arrivals along the incoming rain, then dissipate their impact on the glass. */
function arrive(
  rain: RainData,
  i: number,
  radius: number,
  own: number,
  spawn: number,
  gx: number,
  gy: number,
  impact: number,
): boolean {
  "worklet";
  const side = rand(rain) * 1.9 - 0.95;
  const scattered = rand(rain) * 1.9 - 0.95;
  const edge = 0.82 + 0.12 * rand(rain);
  const along = scattered + (edge - scattered) * spawn;
  const across = side * Math.sqrt(Math.max(0, 1 - along * along * spawn));
  const x = -across * gy - along * gx;
  const y = across * gx - along * gy;
  if (i < 0 || x * x + y * y >= 0.95) return false;
  place(rain, i, x, y, 0, own);
  rain.goal[i] = radius;
  if (impact > 0) {
    const radial = x * gx + y * gy;
    rain.vx[i] = impact * (gx - radial * x);
    rain.vy[i] = impact * (gy - radial * y);
    rain.vz[i] = -impact * radial * rain.z[i]!;
  }
  rain.untouched[i] = 0;
  return true;
}
function active(rain: RainData, i: number, amount: number, count: number): boolean {
  "worklet";
  return rain.live[i] === 1 && (rain.own[i]! < 0 || amount * count > rain.own[i]!);
}
function free(rain: RainData): number {
  "worklet";
  // Authored slots stay reserved even after their water has left the sphere.
  for (let i = 16; i < RAIN_DROPS; i++) if (rain.live[i] === 0) return i;
  return -1;
}
/** Freeze the head into a path before its drop disappears or starts the next chunk. */
export function releaseRainTrail(
  rain: RainData,
  i: number,
  x: number,
  y: number,
  time: number,
): void {
  "worklet";
  for (let k = 0; k < RAIN_TRAILS; k++) {
    if (rain.owner[k] !== i) continue;
    const at = k * PATH * 2;
    const age = k * PATH;
    for (let j = PATH - 1; j > 0; j--) {
      rain.path[at + j * 2] = rain.path[at + (j - 1) * 2]!;
      rain.path[at + j * 2 + 1] = rain.path[at + (j - 1) * 2 + 1]!;
      rain.stamp[age + j] = rain.stamp[age + j - 1]!;
    }
    rain.path[at] = x;
    rain.path[at + 1] = y;
    rain.stamp[age] = time;
    rain.count[k] = Math.min(PATH, rain.count[k]! + 1);
    rain.owner[k] = -1;
  }
}
function release(rain: RainData, i: number): void {
  "worklet";
  releaseRainTrail(rain, i, rain.x[i]!, rain.y[i]!, rain.time);
}
function trail(rain: RainData, i: number): void {
  "worklet";
  traceRainTrail(
    rain,
    i,
    rain.own[i]!,
    rain.x[i]!,
    rain.y[i]!,
    rain.px[i]!,
    rain.py[i]!,
    rain.r[i]!,
    rain.time,
  );
}
/** Snow runoff shares the same bounded path history, film optics and re-fogging as rain. */
export function traceRainTrail(
  rain: RainData,
  i: number,
  source: number,
  x: number,
  y: number,
  px: number,
  py: number,
  radius: number,
  time: number,
): void {
  "worklet";
  let slot = -1;
  for (let k = 0; k < RAIN_TRAILS; k++) if (rain.owner[k] === i) slot = k;
  if (slot >= 0) {
    const at = slot * PATH * 2;
    const dx = x - rain.path[at]!;
    const dy = y - rain.path[at + 1]!;
    if (dx * dx + dy * dy < 0.002025) return;
    if (rain.count[slot]! >= PATH - 1) {
      releaseRainTrail(rain, i, x, y, time);
      slot = -1;
    }
  }
  if (slot < 0) {
    // A full chunk stays behind until its youngest point is completely fogged over.
    for (let k = 0; k < RAIN_TRAILS; k++) {
      if (rain.count[k] === 0 || (rain.owner[k]! < 0 && time - rain.stamp[k * PATH]! >= DRY)) {
        slot = k;
        break;
      }
    }
    if (slot < 0) return;
    rain.owner[slot] = i;
    rain.source[slot] = source;
    rain.count[slot] = 1;
    rain.path[slot * PATH * 2] = px;
    rain.path[slot * PATH * 2 + 1] = py;
    rain.stamp[slot * PATH] = Math.max(0, time - 1 / STEPS);
    rain.width[slot] = radius;
    return;
  }
  const at = slot * PATH * 2;
  const age = slot * PATH;
  for (let k = PATH - 1; k > 0; k--) {
    rain.path[at + k * 2] = rain.path[at + (k - 1) * 2]!;
    rain.path[at + k * 2 + 1] = rain.path[at + (k - 1) * 2 + 1]!;
    rain.stamp[age + k] = rain.stamp[age + k - 1]!;
  }
  rain.path[at] = x;
  rain.path[at + 1] = y;
  rain.stamp[age] = time;
  rain.count[slot] = Math.min(PATH - 1, rain.count[slot]! + 1);
  rain.width[slot] = Math.max(rain.width[slot]!, radius);
}
/** Distance to a moving drop's tapered footprint along a contact ray. The shader uses the
 * same speed-dependent stretch and head/tail taper in its projected tangent coordinates. */
function extent(
  rain: RainData,
  i: number,
  dx: number,
  dy: number,
  dz: number,
  distance: number,
): number {
  "worklet";
  const hx = Math.cos(rain.heading[i]!);
  const hy = Math.sin(rain.heading[i]!);
  const hz = -(rain.x[i]! * hx + rain.y[i]! * hy) / Math.max(rain.z[i]!, 0.00001);
  const norm = Math.sqrt(hx * hx + hy * hy + hz * hz);
  const along = (dx * hx + dy * hy + dz * hz) / (distance * norm);
  const drive = rain.stretch[i]!;
  const length = 1 + 0.32 * drive;
  const across2 = Math.max(0, 1 - along * along);
  let reach = rain.r[i]! / Math.sqrt(across2 * length + (along * along) / (length * length));
  for (let k = 0; k < 3; k++) {
    const offset = 0.06 * drive * rain.r[i]!;
    const q = (reach * along + offset) / Math.max(rain.r[i]! * length, 0.000001);
    const taper = 1 + 0.14 * drive * Math.min(1, Math.max(-1, q));
    const aa = (across2 * length) / (taper * taper) + (along * along) / (length * length);
    const bb = (2 * along * offset) / (length * length);
    const cc = (offset * offset) / (length * length) - rain.r[i]! * rain.r[i]!;
    reach = (-bb + Math.sqrt(bb * bb - 4 * aa * cc)) / (2 * aa);
  }
  return reach;
}
function touches(rain: RainData, i: number, j: number): boolean {
  "worklet";
  const dx = rain.x[j]! - rain.x[i]!;
  const dy = rain.y[j]! - rain.y[i]!;
  const dz = rain.z[j]! - rain.z[i]!;
  const d2 = dx * dx + dy * dy + dz * dz;
  const broad = 2.25 * (rain.r[i]! + rain.r[j]!);
  if (d2 >= broad * broad) return false;
  const distance = Math.sqrt(Math.max(d2, 0.000000000001));
  const reach = extent(rain, i, dx, dy, dz, distance) + extent(rain, j, -dx, -dy, -dz, distance);
  return distance < reach;
}
/** The running water carries the contact forward. A pinned bead cannot pull its centre into
 * itself merely because it is larger. At rest, the downstream lobe is the gravity-facing head. */
function driver(rain: RainData, i: number, j: number, gx: number, gy: number): number {
  "worklet";
  const a = rain.vx[i]! * rain.vx[i]! + rain.vy[i]! * rain.vy[i]! + rain.vz[i]! * rain.vz[i]!;
  const b = rain.vx[j]! * rain.vx[j]! + rain.vy[j]! * rain.vy[j]! + rain.vz[j]! * rain.vz[j]!;
  if (Math.max(a, b) < 0.00000001)
    return rain.x[i]! * gx + rain.y[i]! * gy >= rain.x[j]! * gx + rain.y[j]! * gy ? i : j;
  return a >= b ? i : j;
}
function merge(rain: RainData, i: number, j: number): void {
  "worklet";
  const a = rain.goal[i]! * rain.goal[i]! * rain.goal[i]!;
  const b = rain.goal[j]! * rain.goal[j]! * rain.goal[j]!;
  const w = b / (a + b);
  // The contact area controls brief glass friction, including when the head meets a small bead.
  const area =
    (rain.goal[j]! * rain.goal[j]!) /
    (rain.goal[i]! * rain.goal[i]! + rain.goal[j]! * rain.goal[j]!);
  rain.joinx[i] = rain.x[j]! - rain.x[i]!;
  rain.joiny[i] = rain.y[j]! - rain.y[i]!;
  rain.joinz[i] = rain.z[j]! - rain.z[i]!;
  rain.mass[i] = a + b;
  rain.mass[j] = b;
  rain.radius0[i] = rain.goal[i]!;
  rain.radius0[j] = rain.goal[j]!;
  rain.render0[i] = rain.r[i]!;
  rain.render0[j] = rain.r[j]!;
  rain.pair[i] = j;
  rain.pair[j] = i;
  rain.started[i] = rain.time;
  rain.phase[i] = 0;
  rain.pphase[i] = 0;
  const speed = Math.sqrt(
    rain.vx[i]! * rain.vx[i]! + rain.vy[i]! * rain.vy[i]! + rain.vz[i]! * rain.vz[i]!,
  );
  // Glass adhesion briefly resists the head. Contact on one side supplies a small tangent
  // impulse; there is no centre interpolation or attraction of the pinned lobe.
  if (speed > 0.00000001) {
    const along =
      (rain.joinx[i]! * rain.vx[i]! + rain.joiny[i]! * rain.vy[i]! + rain.joinz[i]! * rain.vz[i]!) /
      (speed * speed);
    const radial =
      rain.joinx[i]! * rain.x[i]! + rain.joiny[i]! * rain.y[i]! + rain.joinz[i]! * rain.z[i]!;
    const sx = rain.joinx[i]! - rain.vx[i]! * along - rain.x[i]! * radial;
    const sy = rain.joiny[i]! - rain.vy[i]! * along - rain.y[i]! * radial;
    const sz = rain.joinz[i]! - rain.vz[i]! * along - rain.z[i]! * radial;
    const side = Math.sqrt(sx * sx + sy * sy + sz * sz);
    const impulse = Math.min(0.00075, speed * 0.18) / Math.max(side, 0.000001);
    rain.vx[i] = rain.vx[i]! + sx * impulse;
    rain.vy[i] = rain.vy[i]! + sy * impulse;
    rain.vz[i] = rain.vz[i]! + sz * impulse;
  }
  const drag = 0.76 - 0.2 * area;
  rain.vx[i] = (rain.vx[i]! * (1 - 0.3 * w) + rain.vx[j]! * 0.3 * w) * drag;
  rain.vy[i] = (rain.vy[i]! * (1 - 0.3 * w) + rain.vy[j]! * 0.3 * w) * drag;
  rain.vz[i] = (rain.vz[i]! * (1 - 0.3 * w) + rain.vz[j]! * 0.3 * w) * drag;
  rain.hold[i] = Math.max(rain.hold[i]!, 3 + Math.round(area * 3));
  rain.untouched[i] = 0;
  rain.untouched[j] = 0;
  rain.live[j] = 2;
  rain.travel[j] = 1;
  release(rain, j);
}
/** Contact relaxes into the moving head while the other contact line stays on the glass.
 * Neither centre is animated toward the other. The shared surface carries the joining water. */
function coalesce(rain: RainData, i: number): void {
  "worklet";
  const j = rain.pair[i]!;
  const p = Math.min(1, Math.max(0, (rain.time - rain.started[i]!) / 0.2));
  const donor = rain.radius0[j]! * (1 - ease(0.14, 1, p));
  rain.goal[j] = donor;
  rain.goal[i] = root(rain.mass[i]! - donor * donor * donor);
  // A newly arriving drop may still be growing into its allotted water. Finish that growth
  // continuously during neck formation instead of snapping its rendered radius on contact.
  const grown = ease(0, 0.3, p);
  rain.r[i] = rain.render0[i]! + (rain.goal[i]! - rain.render0[i]!) * grown;
  rain.r[j] = rain.render0[j]! + (donor - rain.render0[j]!) * grown;
  rain.phase[i] = p;
  if (p >= 1) {
    rain.live[j] = 0;
    rain.age[j] = 0;
    rain.pair[i] = -1;
    rain.pair[j] = -1;
  }
}
export function stepRain(
  rain: RainData,
  program: RainProgram,
  dials: ArrayLike<number>,
  time = (rain.done + 1) / STEPS,
  motion = 1,
): void {
  "worklet";
  rain.time = Math.round(time * 1000) / 1000;
  const amount = Math.fround(dials[program.rain.amount]!);
  const density = Math.fround(dials[program.rain.density]!);
  const spawn = Math.fround(dials[program.rain.spawn]!);
  const angle = (Math.fround(dials[program.rain.direction]!) * Math.PI) / 180;
  const gx = Math.sin(angle),
    gy = -Math.cos(angle);
  const strength =
    program.rain.windSpeed === undefined
      ? 0
      : windAt(
          time,
          Math.fround(dials[program.rain.windSpeed]!),
          Math.fround(dials[program.rain.gusts!]!),
          Math.fround(dials[program.rain.turbulence!]!),
        );
  const gustAngle = strength * 0.45 * Math.sin(time * 0.81);
  const incoming =
    program.rain.angle === undefined
      ? angle
      : (Math.max(
          -80,
          Math.min(
            80,
            Math.fround(dials[program.rain.angle]!) +
              gustAngle +
              (program.rain.wind === undefined ? 0 : Math.fround(dials[program.rain.wind]!)),
          ),
        ) *
          Math.PI) /
        180;
  const ax = Math.sin(incoming),
    ay = -Math.cos(incoming);
  const impact =
    program.rain.angle === undefined ? 0 : 0.009 * Math.abs(ax) * (1 + strength * 0.08);
  const count = program.static[(program.rain.counts - program.staticSlot) * 4]!;
  let population = 0;
  rain.dynamic = false;
  for (let i = 0; i < RAIN_DROPS; i++) {
    rain.px[i] = rain.x[i]!;
    rain.py[i] = rain.y[i]!;
    rain.pr[i] = rain.r[i]!;
    rain.pphase[i] = rain.phase[i]!;
    rain.pstretch[i] = rain.stretch[i]!;
    rain.pheading[i] = rain.heading[i]!;
    if (rain.live[i] === 1 && rain.own[i]! < 0) population++;
    if (rain.live[i]! > 0 && rain.own[i]! < 0) rain.dynamic = true;
  }
  const target = 24 * density + 330 * density * density;
  if (density > 0 && population < target) {
    for (let k = 0; k < 9; k++) {
      if (k >= 1 + Math.floor(8 * density * density) || rand(rain) > density * 0.9) break;
      const i = free(rain);
      const radius =
        (0.009 + rand(rain) * rand(rain) * 0.04) *
        (program.rain.size === undefined ? 1 : Math.fround(dials[program.rain.size]!));
      if (arrive(rain, i, radius, -1, spawn, ax, ay, impact)) {
        population++;
        rain.dynamic = true;
      }
      if (population >= target) break;
    }
  }
  for (let i = 0; i < RAIN_DROPS; i++) {
    if (rain.live[i] === 0 && rain.own[i]! >= 0 && amount * count > rain.own[i]!) {
      rain.age[i] = rain.age[i]! + 1;
      if (rain.age[i]! > 120) {
        const at = (program.rain.drops - program.staticSlot + rain.own[i]!) * 4;
        arrive(rain, i, Math.fround(program.static[at + 2]!), rain.own[i]!, spawn, ax, ay, impact);
      }
    }
    if (rain.live[i] === 2) continue;
    if (rain.live[i] === 3) {
      rain.vx[i] = rain.vx[i]! + GRAVITY * gx * motion;
      rain.vy[i] = rain.vy[i]! + GRAVITY * gy * motion;
      rain.x[i] = rain.x[i]! + rain.vx[i]! * motion;
      rain.y[i] = rain.y[i]! + rain.vy[i]! * motion;
      if (rain.x[i]! * gx + rain.y[i]! * gy > 1.2 + rain.r[i]!) rain.live[i] = 0;
      continue;
    }
    if (!active(rain, i, amount, count)) continue;
    rain.r[i] = rain.r[i]! + (rain.goal[i]! - rain.r[i]!) * 0.25;
    let x = rain.x[i]!;
    let y = rain.y[i]!;
    let z = rain.z[i]!;
    const norm = Math.sqrt(x * x + y * y + z * z);
    x /= norm;
    y /= norm;
    z /= norm;
    const pole = x * gx + y * gy;
    const slope = Math.sqrt(Math.max(0, 1 - pole * pole));
    const speed = Math.sqrt(
      rain.vx[i]! * rain.vx[i]! + rain.vy[i]! * rain.vy[i]! + rain.vz[i]! * rain.vz[i]!,
    );
    const force = rain.goal[i]! * rain.goal[i]! * slope;
    const pin = PIN * rain.stick[i]! * (speed > 0.0002 ? 0.35 : 1);
    if (rain.hold[i]! > 0) {
      rain.hold[i] = Math.max(0, rain.hold[i]! - 1);
      rain.vx[i] = rain.vx[i]! * 0.86;
      rain.vy[i] = rain.vy[i]! * 0.86;
      rain.vz[i] = rain.vz[i]! * 0.86;
    } else if (force > pin) {
      // Gravity projected onto the tangent plane for the selected flow direction.
      const gain = GRAVITY * motion * (1 - pin / force);
      rain.vx[i] = (rain.vx[i]! + gain * (gx - pole * x)) * Math.pow(0.92, motion);
      rain.vy[i] = (rain.vy[i]! + gain * (gy - pole * y)) * Math.pow(0.92, motion);
      rain.vz[i] = (rain.vz[i]! - gain * pole * z) * Math.pow(0.92, motion);
    } else {
      rain.vx[i] = rain.vx[i]! * 0.65;
      rain.vy[i] = rain.vy[i]! * 0.65;
      rain.vz[i] = rain.vz[i]! * 0.65;
    }
    // Strip radial momentum, cap surface speed, then project the next point back to the sphere.
    const radial = rain.vx[i]! * x + rain.vy[i]! * y + rain.vz[i]! * z;
    rain.vx[i] = rain.vx[i]! - radial * x;
    rain.vy[i] = rain.vy[i]! - radial * y;
    rain.vz[i] = rain.vz[i]! - radial * z;
    // Incoming wind and a glancing merge can supply an uphill impulse. Glass adhesion
    // dissipates that impact: attached water must drain with the selected gravity.
    if (rain.vx[i]! * gx + rain.vy[i]! * gy < 0) {
      rain.vx[i] = 0;
      rain.vy[i] = 0;
      rain.vz[i] = 0;
    }
    const v = Math.sqrt(
      rain.vx[i]! * rain.vx[i]! + rain.vy[i]! * rain.vy[i]! + rain.vz[i]! * rain.vz[i]!,
    );
    const limit = Math.min(1, TOP / Math.max(v, 0.000001));
    rain.vx[i] = rain.vx[i]! * limit;
    rain.vy[i] = rain.vy[i]! * limit;
    rain.vz[i] = rain.vz[i]! * limit;
    x += rain.vx[i]! * motion;
    y += rain.vy[i]! * motion;
    z += rain.vz[i]! * motion;
    const n = Math.sqrt(x * x + y * y + z * z);
    rain.x[i] = x / n;
    rain.y[i] = y / n;
    rain.z[i] = z / n;
    const dx = rain.x[i]! - rain.px[i]!;
    const dy = rain.y[i]! - rain.py[i]!;
    const wanted = Math.min(1, (v * motion) / 0.004) * Math.min(1, rain.goal[i]! / 0.035);
    rain.stretch[i] = rain.stretch[i]! + (wanted - rain.stretch[i]!) * 0.08;
    if (v > 0.0001) {
      const turn = Math.atan2(rain.vy[i]!, rain.vx[i]!) - rain.heading[i]!;
      rain.heading[i] = rain.heading[i]! + Math.atan2(Math.sin(turn), Math.cos(turn)) * 0.08;
    }
    const moved = dx * dx + dy * dy > 0.00000001;
    if (moved) {
      rain.untouched[i] = 0;
      if (rain.r[i]! > 0.025) trail(rain, i);
      rain.travel[i] = rain.travel[i]! + Math.sqrt(dx * dx + dy * dy);
      rain.last[i] = rain.last[i]! + v * motion;
      // Uneven glass wetting consumes a small film continuously over travelled surface distance.
      const patch = rain.x[i]! * 17 + rain.y[i]! * 11 + rain.z[i]! * 5 + rain.stick[i]!;
      const triangle = 2 * Math.abs(patch - Math.floor(patch) - 0.5);
      const held = rain.goal[i]! * rain.goal[i]! * rain.goal[i]!;
      const loss = held * Math.min(0.02, v * motion * (0.1 + 0.55 * triangle * triangle));
      rain.film += loss;
      rain.goal[i] = root(held - loss);
      if (rain.pair[i]! >= 0) rain.mass[i] = rain.mass[i]! - loss;

      if (rain.pair[i]! < 0 && rain.last[i]! > rain.shed[i]!) {
        rain.last[i] = 0;
        rain.shed[i] = 0.12 + 0.32 * rand(rain);
        rain.stick[i] = 0.55 + rand(rain) * 0.9;
        const j = free(rain);
        if (
          j >= 0 &&
          rain.goal[i]! > 0.04 &&
          rain.x[i]! * gx + rain.y[i]! * gy < 0.9 &&
          v > 0.0005 &&
          rand(rain) < 0.35
        ) {
          const bead = rain.goal[i]! * (0.08 + 0.2 * rand(rain));
          // Residual water is intermittent and spreads across the wet footprint. The sideways
          // direction is the surface normal crossed with velocity, so it stays tangent.
          const rear = extent(rain, i, -rain.vx[i]!, -rain.vy[i]!, -rain.vz[i]!, v);
          const gap = ((rear + bead) * (1.15 + 0.35 * rand(rain))) / v;
          const side = ((rand(rain) - 0.5) * rain.r[i]! * 0.65) / v;
          const bx =
            rain.x[i]! -
            rain.vx[i]! * gap +
            (rain.y[i]! * rain.vz[i]! - rain.z[i]! * rain.vy[i]!) * side;
          const by =
            rain.y[i]! -
            rain.vy[i]! * gap +
            (rain.z[i]! * rain.vx[i]! - rain.x[i]! * rain.vz[i]!) * side;
          const bz =
            rain.z[i]! -
            rain.vz[i]! * gap +
            (rain.x[i]! * rain.vy[i]! - rain.y[i]! * rain.vx[i]!) * side;
          const beadNorm = Math.sqrt(bx * bx + by * by + bz * bz);
          place(rain, j, bx / beadNorm, by / beadNorm, bead, -1);
          rain.goal[i] = root(rain.goal[i]! * rain.goal[i]! * rain.goal[i]! - bead * bead * bead);
        }
      }
    }
  }
  for (let i = 0; i < RAIN_DROPS; i++) {
    if (rain.live[i] === 1 && rain.pair[i]! >= 0) coalesce(rain, i);
    // Release after neck completion and before another contact can capture the head.
    if (!active(rain, i, amount, count)) continue;
    // Surface tension holds a small pendant drop at the downstream pole until water collects.
    if (rain.pair[i]! >= 0) continue;
    const overloaded = rain.goal[i]! > 0.14;
    if (overloaded || rain.x[i]! * gx + rain.y[i]! * gy > 0.96) {
      rain.age[i] = rain.age[i]! + 1;
      if (overloaded || rain.goal[i]! > 0.075 || rain.age[i]! > 90) {
        rain.live[i] = 3;
        const along = rain.vx[i]! * gx + rain.vy[i]! * gy;
        rain.vx[i] = rain.vx[i]! + gx * (0.006 - along);
        rain.vy[i] = rain.vy[i]! + gy * (0.006 - along);
        release(rain, i);
      }
    } else if (rain.z[i]! < 0.04) {
      rain.live[i] = 0;
      release(rain, i);
    }
  }
  // All drops have moved before contacts are tested. A reusable grid rejects far-away pairs;
  // bit masks visit candidates in the same i/j order as the original full pair scan.
  const contacts = rain.contacts;
  indexContacts(contacts, rain.live, rain.pair, rain.own, rain.x, rain.y, rain.r, amount, count);
  for (let i = 0; i < RAIN_DROPS; i++) {
    if (rain.pair[i]! >= 0 || !active(rain, i, amount, count)) continue;
    queryContacts(contacts, i, rain.x[i]!, rain.y[i]!, rain.r[i]!);
    for (let word = i >>> 5; word < contacts.mask.length && rain.pair[i]! < 0; word++) {
      let bits = contacts.mask[word]!;
      while (bits !== 0 && rain.pair[i]! < 0) {
        const bit = bits & -bits;
        const j = word * 32 + 31 - Math.clz32(bit);
        bits ^= bit;
        if (rain.pair[j]! >= 0 || !touches(rain, i, j)) continue;
        const head = driver(rain, i, j, gx, gy);
        merge(rain, head, head === i ? j : i);
      }
    }
  }
  rain.done++;
}
export function rainTo(
  rain: RainData,
  program: RainProgram,
  dials: ArrayLike<number>,
  tau: number,
  most: number,
  time = tau,
): void {
  "worklet";
  const target = Math.floor(time * STEPS + 1e-3);
  if (
    (program.rain.enabled !== undefined && dials[program.rain.enabled]! < 0.5) ||
    (dials[program.rain.amount]! <= 0 && dials[program.rain.density]! <= 0 && !rain.dynamic)
  ) {
    if (!rain.paused) rain.pausedAt = rain.time;
    rain.done = target;
    rain.time = time;
    rain.tau = tau;
    rain.frac = 1;
    rain.paused = true;
    return;
  }
  if (rain.paused) {
    for (let i = 0; i < RAIN_DROPS; i++) {
      if (rain.pair[i]! >= 0) rain.started[i]! += rain.time - rain.pausedAt;
      rain.px[i] = rain.x[i]!;
      rain.py[i] = rain.y[i]!;
      rain.pr[i] = rain.r[i]!;
      rain.pphase[i] = rain.phase[i]!;
      rain.pstretch[i] = rain.stretch[i]!;
      rain.pheading[i] = rain.heading[i]!;
    }
    rain.paused = false;
  }
  if (target - rain.done > most) rain.done = target - most;
  const elapsed = time - rain.time;
  const advanced = tau - rain.tau;
  const motion = elapsed > 0 ? Math.max(0, advanced / elapsed) : 0;
  while (rain.done < target) {
    stepRain(rain, program, dials, (rain.done + 1) / STEPS, motion);
  }
  rain.time = time;
  rain.tau = tau;
  rain.frac = Math.min(1, Math.max(0, time * STEPS + 1e-3 - target));
}
function pack(x: number, y: number): number {
  "worklet";
  const qx = Math.round(Math.min(1, Math.max(0, (x + 1.2) / 2.4)) * 4095);
  const qy = Math.round(Math.min(1, Math.max(0, (y + 1.2) / 2.4)) * 4095);
  return qx * 4096 + qy;
}
export function writeRain(
  rain: RainData,
  program: RainProgram,
  out: { [i: number]: number },
  snow?: { x: number[]; y: number[]; px: number[]; py: number[]; frac: number },
  drops = true,
  trails = true,
): void {
  "worklet";
  for (let i = 0; i < (drops ? RAIN_DROPS : 0); i++) {
    const at = (program.rain.pool + i * 2) * 4;
    const t = rain.frac;
    const x = rain.px[i]! + (rain.x[i]! - rain.px[i]!) * t;
    const y = rain.py[i]! + (rain.y[i]! - rain.py[i]!) * t;
    const r = rain.pr[i]! + (rain.r[i]! - rain.pr[i]!) * t;
    const drive = rain.pstretch[i]! + (rain.stretch[i]! - rain.pstretch[i]!) * t;
    const heading = rain.pheading[i]! + (rain.heading[i]! - rain.pheading[i]!) * t;
    const angle = Math.atan2(Math.sin(heading), Math.cos(heading));
    // Each lobe gets its own exact 24-bit float integer: 12 bits each for heading and drive.
    // The sign alone marks a donor; the shader no longer needs a partner index here.
    const shape =
      Math.round(((angle + Math.PI) / (2 * Math.PI)) * 4095) + 4096 * Math.round(drive * 4095);
    out[at] = pack(x, y);
    out[at + 1] = rain.live[i]! > 0 ? r : 0;
    const j = rain.pair[i]!;
    out[at + 2] = (shape + 1) * (rain.live[i] === 2 ? -1 : 1);
    const p = rain.pphase[i]! + (rain.phase[i]! - rain.pphase[i]!) * t;
    out[at + 3] =
      j < 0 || rain.live[i] !== 1
        ? 0
        : Math.min(rain.radius0[i]!, rain.radius0[j]!) *
          (0.08 + 0.62 * ease(0, 0.25, p)) *
          (1 - ease(0.6, 1, p));
  }
  // Cache the partner's interpolated geometry beside each lobe. SkSL uniform indices must be
  // compile-time constants; a loop over these adjacent slots works in all three shader dialects.
  for (let i = 0; i < (drops ? RAIN_DROPS : 0); i++) {
    const at = (program.rain.pool + i * 2) * 4;
    const j = rain.pair[i]!;
    const partner = j < 0 ? at : (program.rain.pool + j * 2) * 4;
    out[at + 4] = out[partner]!;
    out[at + 5] = j < 0 ? 0 : out[partner + 1]!;
    out[at + 6] = j < 0 ? -1 : rain.own[j]!;
    out[at + 7] = j < 0 ? 0 : Math.abs(out[partner + 2]!) - 1;
  }
  for (let i = 0; i < (trails ? RAIN_TRAILS : 0); i++) {
    const at = (program.rain.trails + i * RAIN_TRAIL_SLOTS) * 4;
    const owner = rain.owner[i]!;
    const n = rain.count[i]!;
    if (n <= 0 || (owner < 0 && rain.time - rain.stamp[i * PATH]! >= DRY)) {
      out[at + 24] = 0;
      continue;
    }
    let loX = 2,
      loY = 2,
      hiX = -2,
      hiY = -2;
    for (let k = 0; k < PATH; k++) {
      const p = Math.max(0, Math.min(owner >= 0 ? k - 1 : k, n - 1));
      let x = rain.path[(i * PATH + p) * 2]!;
      let y = rain.path[(i * PATH + p) * 2 + 1]!;
      let stamp = rain.stamp[i * PATH + p]!;
      if (k === 0 && owner >= 0) {
        const drop = owner < RAIN_DROPS ? rain : snow;
        const index = owner < RAIN_DROPS ? owner : owner - RAIN_DROPS;
        if (drop) {
          x = drop.px[index]! + (drop.x[index]! - drop.px[index]!) * drop.frac;
          y = drop.py[index]! + (drop.y[index]! - drop.py[index]!) * drop.frac;
        }
        stamp = rain.time;
      }
      out[at + k] = pack(x, y);
      out[at + PATH + k] = stamp;
      loX = Math.min(loX, x);
      loY = Math.min(loY, y);
      hiX = Math.max(hiX, x);
      hiY = Math.max(hiY, y);
    }
    out[at + 24] = n > 0 ? rain.width[i]! : 0;
    out[at + 25] = rain.source[i]!;
    out[at + 26] = Math.min(PATH, n + (owner >= 0 ? 1 : 0));
    out[at + 27] = 0;
    out[at + 28] = loX;
    out[at + 29] = loY;
    out[at + 30] = hiX;
    out[at + 31] = hiY;
  }
}
export function copyRain(rain: RainData): RainData {
  "worklet";
  return {
    contacts: createContacts(RAIN_DROPS),
    done: rain.done,
    frac: rain.frac,
    seed: rain.seed,
    time: rain.time,
    tau: rain.tau,
    paused: rain.paused,
    pausedAt: rain.pausedAt,
    dynamic: rain.dynamic,
    film: rain.film,
    live: [...rain.live],
    x: [...rain.x],
    y: [...rain.y],
    z: [...rain.z],
    r: [...rain.r],
    stretch: [...rain.stretch],
    pstretch: [...rain.pstretch],
    heading: [...rain.heading],
    pheading: [...rain.pheading],
    px: [...rain.px],
    py: [...rain.py],
    pr: [...rain.pr],
    goal: [...rain.goal],
    vx: [...rain.vx],
    vy: [...rain.vy],
    vz: [...rain.vz],
    stick: [...rain.stick],
    last: [...rain.last],
    shed: [...rain.shed],
    age: [...rain.age],
    travel: [...rain.travel],
    hold: [...rain.hold],
    pair: [...rain.pair],
    started: [...rain.started],
    phase: [...rain.phase],
    pphase: [...rain.pphase],
    mass: [...rain.mass],
    radius0: [...rain.radius0],
    render0: [...rain.render0],
    joinx: [...rain.joinx],
    joiny: [...rain.joiny],
    joinz: [...rain.joinz],
    own: [...rain.own],
    untouched: [...rain.untouched],
    owner: [...rain.owner],
    source: [...rain.source],
    path: [...rain.path],
    count: [...rain.count],
    width: [...rain.width],
    stamp: [...rain.stamp],
  };
}
