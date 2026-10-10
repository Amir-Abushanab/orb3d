import { windAt } from "./wind";
// Persistent snow on the front hemisphere. Ice and meltwater have separate conserved volumes.
// Keep dry crystals anchored; contact compacts gradually, and only wet deposits become mobile.
// One packed vec4 per flake keeps the particles compact within portable uniform pages.
import { RAIN_DROPS, releaseRainTrail, traceRainTrail, type RainData } from "./rain";

export const SNOW_PARTICLES = 64;
const STEP = 1 / 60;

export interface SnowLayout {
  pool: number;
  amount: number;
  density: number;
  dispersion: number;
  angle: number;
  fall: number;
  size: number;
  stick: number;
  melt: number;
  gravity: number;
  react: number;
  enabled: number;
  wind: number;
  windSpeed?: number;
  gusts?: number;
  turbulence?: number;
  hailEnabled?: number;
  hailAmount?: number;
  hailDensity?: number;
  hailSize?: number;
  hailBounce?: number;
  hailMelt?: number;
}
export interface SnowData {
  done: number;
  frac: number;
  seed: number;
  serial: number;
  arrivals: number;
  hailArrivals: number;
  kind: number[];
  supplied: number;
  escaped: number;
  evaporated: number;
  /** Meltwater left in the shared wet film, in the same r³ units as ice and water. */
  film: number;
  paused: boolean;
  /** 0 free, 1 incoming, 2 on glass, 3 gradually joining a contacting aggregate. */
  live: number[];
  x: number[];
  y: number[];
  px: number[];
  py: number[];
  radius: number[];
  pradius: number[];
  ice: number[];
  water: number[];
  phase: number[];
  pphase: number[];
  id: number[];
  age: number[];
  flight: number[];
  targetX: number[];
  targetY: number[];
  incomingX: number[];
  incomingY: number[];
  vx: number[];
  vy: number[];
  pair: number[];
  compact: number[];
  transfer: number[];
}
export function createSnow(): SnowData {
  "worklet";
  const zeros = (): number[] => Array.from({ length: SNOW_PARTICLES }, () => 0);
  return {
    done: 0,
    frac: 0,
    seed: 0x73a92c41,
    serial: 0,
    arrivals: 0,
    hailArrivals: 0,
    kind: zeros(),
    supplied: 0,
    escaped: 0,
    evaporated: 0,
    film: 0,
    paused: false,
    live: zeros(),
    x: zeros(),
    y: zeros(),
    px: zeros(),
    py: zeros(),
    radius: zeros(),
    pradius: zeros(),
    ice: zeros(),
    water: zeros(),
    phase: zeros(),
    pphase: zeros(),
    id: zeros(),
    age: zeros(),
    flight: zeros(),
    targetX: zeros(),
    targetY: zeros(),
    incomingX: zeros(),
    incomingY: zeros(),
    vx: zeros(),
    vy: zeros(),
    pair: Array.from({ length: SNOW_PARTICLES }, () => -1),
    compact: zeros(),
    transfer: zeros(),
  };
}
function random(snow: SnowData): number {
  "worklet";
  snow.seed = (Math.imul(snow.seed, 1664525) + 1013904223) | 0;
  return (snow.seed >>> 0) / 4294967296;
}
function root(value: number): number {
  "worklet";
  if (value <= 0) return 0;
  let r = 0.2;
  for (let i = 0; i < 16; i++) r = (2 * r + value / (r * r)) / 3;
  return r;
}
function spawn(
  s: SnowData,
  i: number,
  spread: number,
  angle: number,
  size: number,
  kind = 0,
): void {
  "worklet";
  const ax = Math.sin(angle),
    ay = -Math.cos(angle);
  let x = 0,
    y = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    const side = random(s) * 1.9 - 0.95;
    const scattered = random(s) * 1.9 - 0.95;
    const edge = 0.77 + 0.16 * random(s);
    const along = edge * (1 - spread) + scattered * spread;
    const across = side * Math.sqrt(Math.max(0, 1 - along * along * (1 - spread)));
    x = -across * ay - along * ax;
    y = across * ax - along * ay;
    if (x * x + y * y < 0.91) break;
  }
  const radius = size * (kind ? 0.014 + 0.022 * random(s) : 0.024 + 0.032 * random(s));
  s.kind[i] = kind;
  s.serial = (s.serial + 1) % 16777216;
  s.id[i] = s.serial;
  s.live[i] = 1;
  s.targetX[i] = x;
  s.targetY[i] = y;
  s.incomingX[i] = ax;
  s.incomingY[i] = ay;
  s.flight[i] = 0.18 + 0.42 * random(s);
  s.x[i] = x - ax * s.flight[i]!;
  s.y[i] = y - ay * s.flight[i]!;
  s.px[i] = s.x[i]!;
  s.py[i] = s.y[i]!;
  s.radius[i] = radius;
  s.pradius[i] = radius;
  s.ice[i] = radius * radius * radius;
  s.water[i] = 0;
  s.phase[i] = 1 + s.flight[i]!;
  s.pphase[i] = s.phase[i]!;
  s.age[i] = 0;
  s.vx[i] = 0;
  s.vy[i] = 0;
  s.pair[i] = -1;
  s.compact[i] = 0;
  s.supplied += s.ice[i]!;
}
/** A melted deposit becomes a wet surface patch, freeing a landing slot without losing water. */
function retireMelt(s: SnowData, i: number, rain: RainData | undefined, time: number): boolean {
  "worklet";
  if (s.live[i] !== 2 || s.ice[i]! > 0) return false;
  const radius = root(s.water[i]!) * 0.34;
  if (rain && radius > 0) {
    traceRainTrail(
      rain,
      RAIN_DROPS + i,
      s.kind[i] ? -3 : -2,
      s.x[i]!,
      s.y[i]!,
      s.x[i]!,
      s.y[i]!,
      radius,
      time,
    );
    releaseRainTrail(rain, RAIN_DROPS + i, s.x[i]!, s.y[i]!, time);
  }
  s.film += s.water[i]!;
  s.water[i] = 0;
  s.live[i] = 0;
  s.radius[i] = 0;
  return true;
}
function tick(
  s: SnowData,
  layout: SnowLayout,
  dials: ArrayLike<number>,
  level: number,
  rain?: RainData,
): void {
  "worklet";
  const read = (at: number): number => Math.fround(dials[at]!);
  const amount =
    read(layout.enabled) < 0.5
      ? 0
      : Math.min(1, Math.max(0, read(layout.amount) + read(layout.react) * level));
  const hail =
    layout.hailEnabled === undefined || read(layout.hailEnabled) < 0.5
      ? 0
      : read(layout.hailAmount!);
  const now = (s.done + 1) / 60;
  const strength =
    layout.windSpeed === undefined
      ? 0
      : windAt(now, read(layout.windSpeed), read(layout.gusts!), read(layout.turbulence!));
  const fall = Math.max(0, read(layout.fall));
  const stick = Math.min(1, Math.max(0, read(layout.stick)));
  const melt = Math.max(0, read(layout.melt));
  const angle =
    (Math.max(
      -80,
      Math.min(80, read(layout.angle) + read(layout.wind) + strength * 0.45 * Math.sin(now * 0.81)),
    ) *
      Math.PI) /
    180;
  const gravity = (read(layout.gravity) * Math.PI) / 180;
  const gx = Math.sin(gravity),
    gy = -Math.cos(gravity);
  const time = Math.round(((s.done + 1) / 60) * 1000) / 1000;
  for (let i = 0; i < SNOW_PARTICLES; i++) {
    s.px[i] = s.x[i]!;
    s.py[i] = s.y[i]!;
    s.pradius[i] = s.radius[i]!;
    s.pphase[i] = s.phase[i]!;
  }
  s.arrivals += amount * read(layout.density) * (2 + 25 * read(layout.density)) * fall * STEP;
  for (let i = 0; i < SNOW_PARTICLES && s.arrivals >= 1; i++) {
    if (
      s.live[i] !== 0 &&
      ((s.kind[i] ? read(layout.hailEnabled!) : read(layout.enabled)) < 0.5 ||
        !retireMelt(s, i, rain, time))
    )
      continue;
    spawn(s, i, read(layout.dispersion), angle, read(layout.size));
    s.arrivals--;
  }
  // Do not bank a burst while the surface pool is full or snowfall is disabled.
  s.arrivals = Math.min(s.arrivals, 1);
  const hailDensity = layout.hailDensity === undefined ? 0 : read(layout.hailDensity);
  s.hailArrivals += hail * hailDensity * (2 + 18 * hailDensity) * STEP;
  for (let i = 0; i < SNOW_PARTICLES && s.hailArrivals >= 1; i++) {
    if (
      s.live[i] !== 0 &&
      ((s.kind[i] ? read(layout.hailEnabled!) : read(layout.enabled)) < 0.5 ||
        !retireMelt(s, i, rain, time))
    )
      continue;
    spawn(s, i, 0.8, angle, read(layout.hailSize!), 1);
    s.hailArrivals--;
  }
  s.hailArrivals = Math.min(s.hailArrivals, 1);
  for (let i = 0; i < SNOW_PARTICLES; i++) {
    if (s.live[i] === 0) continue;
    if (
      s.kind[i]
        ? layout.hailEnabled !== undefined && read(layout.hailEnabled) < 0.5
        : read(layout.enabled) < 0.5
    )
      continue;
    if (s.live[i] === 4) {
      s.age[i]! += STEP;
      const bounce = read(layout.hailBounce!);
      const h = Math.max(0, bounce * s.age[i]! * 0.9 - s.age[i]! * s.age[i]! * 1.6);
      s.x[i] = s.targetX[i]! - s.incomingX[i]! * h;
      s.y[i] = s.targetY[i]! - s.incomingY[i]! * h;
      s.phase[i] = 1 + h;
      if (h <= 0) {
        s.live[i] = 2;
        s.phase[i] = 1;
        s.age[i] = 0;
      }
      continue;
    }
    if (s.live[i] === 1) {
      const h = Math.max(
        0,
        s.flight[i]! -
          (0.18 + (0.08 * (s.id[i]! % 7)) / 7) *
            (s.kind[i] ? 4 : fall * (1 + strength * 0.015)) *
            STEP,
      );
      s.flight[i] = h;
      const flutter = (s.kind[i] ? 0 : 0.018) * h * Math.sin(h * 9 + s.id[i]! * 0.7);
      s.x[i] = s.targetX[i]! - s.incomingX[i]! * h - s.incomingY[i]! * flutter;
      s.y[i] = s.targetY[i]! - s.incomingY[i]! * h + s.incomingX[i]! * flutter;
      s.phase[i] = 1 + h;
      if (h <= 0) {
        s.live[i] = s.kind[i] && read(layout.hailBounce!) > 0 ? 4 : 2;
        s.vx[i] = s.incomingX[i]! * 0.0025 * fall;
        s.vy[i] = s.incomingY[i]! * 0.0025 * fall;
      }
      continue;
    }
    s.age[i]! += STEP;
    const total = s.ice[i]! + s.water[i]!;
    if (total <= 1e-12) {
      s.live[i] = 0;
      s.radius[i] = 0;
      continue;
    }
    const radius = root(total);
    const heat = 0.75 + (0.5 * ((s.id[i]! * 37) % 101)) / 100;
    const thaw = Math.min(
      s.ice[i]!,
      0.009 * (s.kind[i] ? read(layout.hailMelt!) : melt) * heat * radius * radius * STEP,
    );
    s.ice[i]! -= thaw;
    s.water[i]! += thaw;
    const ice = s.ice[i]! / total;
    const wetRadius = 0.34 * root(s.water[i]!);
    const mobility =
      (1 - (s.kind[i] ? 0.65 : stick)) * 0.15 * ice +
      (1 - ice) * (1 - ice) * Math.max(0, wetRadius - 0.008) * 20;
    // Tangential gravity on the same hemisphere as the renderer; damp impact before runoff.
    const projection = s.x[i]! * gx + s.y[i]! * gy;
    s.vx[i] =
      s.vx[i]! * (0.84 + 0.08 * (1 - ice)) + 0.00065 * mobility * (gx - projection * s.x[i]!);
    s.vy[i] =
      s.vy[i]! * (0.84 + 0.08 * (1 - ice)) + 0.00065 * mobility * (gy - projection * s.y[i]!);
    if (s.live[i] === 2) {
      s.x[i]! += s.vx[i]!;
      s.y[i]! += s.vy[i]!;
      const distance = Math.hypot(s.x[i]! - s.px[i]!, s.y[i]! - s.py[i]!);
      if (distance > 0.0001 && wetRadius > 0.006 && ice < 0.8) {
        if (rain)
          traceRainTrail(
            rain,
            RAIN_DROPS + i,
            s.kind[i] ? -3 : -2,
            s.x[i]!,
            s.y[i]!,
            s.px[i]!,
            s.py[i]!,
            wetRadius,
            time,
          );
        const z = Math.sqrt(Math.max(0.02, 1 - s.x[i]! * s.x[i]! - s.y[i]! * s.y[i]!));
        const patch = s.x[i]! * 17 + s.y[i]! * 11 + z * 5 + s.id[i]! * 0.01;
        const triangle = 2 * Math.abs(patch - Math.floor(patch) - 0.5);
        const loss = s.water[i]! * Math.min(0.02, distance * (0.1 + 0.55 * triangle * triangle));
        s.water[i]! -= loss;
        s.film += loss;
      }
    }
    s.radius[i] = root(s.ice[i]! + s.water[i]!);
    s.phase[i] = ice > 0 ? ice : -Math.min(1, Math.hypot(s.vx[i]!, s.vy[i]!) * 250 + 0.00001);
    if (s.age[i]! > 20 && ice === 0) {
      const evaporate = Math.min(s.water[i]!, 0.00006 * radius * radius * STEP);
      s.water[i]! -= evaporate;
      s.evaporated += evaporate;
    }
    if (s.x[i]! * s.x[i]! + s.y[i]! * s.y[i]! > 1.06 * 1.06) {
      s.escaped += s.ice[i]! + s.water[i]!;
      s.ice[i] = 0;
      s.water[i] = 0;
      s.live[i] = 0;
      s.radius[i] = 0;
    }
  }
  // Transfer over time at contact, never pull a remote flake into a neighbour.
  for (let i = 0; i < SNOW_PARTICLES; i++) {
    if (
      s.live[i] !== 3 ||
      (s.kind[i] ? read(layout.hailEnabled!) < 0.5 : read(layout.enabled) < 0.5)
    )
      continue;
    const j = s.pair[i]!;
    if (j >= 0 && (s.kind[j] ? read(layout.hailEnabled!) < 0.5 : read(layout.enabled) < 0.5))
      continue;
    if (j < 0 || s.live[j] !== 2) {
      s.live[i] = 2;
      s.pair[i] = -1;
      continue;
    }
    const total = s.ice[i]! + s.water[i]!;
    const moved = Math.min(total, s.transfer[i]! * STEP);
    const dx = s.x[j]! - s.x[i]!,
      dy = s.y[j]! - s.y[i]!;
    const zi = Math.sqrt(Math.max(0.02, 1 - s.x[i]! * s.x[i]! - s.y[i]! * s.y[i]!));
    const zj = Math.sqrt(Math.max(0.02, 1 - s.x[j]! * s.x[j]! - s.y[j]! * s.y[j]!));
    const reach = 0.34 * (root(s.water[i]!) + root(s.water[j]!));
    const connected = dx * dx + dy * dy + (zi - zj) * (zi - zj) <= reach * reach;
    const water = connected
      ? Math.min(s.water[i]!, (moved * s.water[i]!) / Math.max(total, 1e-20))
      : 0;
    const ice = Math.min(s.ice[i]!, moved - water);
    s.ice[i]! -= ice;
    s.water[i]! -= water;
    s.ice[j]! += ice;
    s.water[j]! += water;
    s.compact[j] = Math.min(
      1,
      s.compact[j]! + ((ice + water) / Math.max(s.ice[j]! + s.water[j]!, 1e-20)) * 0.33,
    );
    s.vx[j]! *= 0.85;
    s.vy[j]! *= 0.85;
    s.radius[i] = root(s.ice[i]! + s.water[i]!);
    s.radius[j] = root(s.ice[j]! + s.water[j]!);
    if (s.ice[i]! + s.water[i]! <= 1e-15) {
      s.live[i] = 0;
      s.radius[i] = 0;
      s.pair[i] = -1;
    } else if (s.ice[i] === 0 && !connected) {
      s.live[i] = 2;
      s.pair[i] = -1;
    }
  }
  for (let i = 0; i < SNOW_PARTICLES; i++) {
    if (
      s.live[i] !== 2 ||
      s.age[i]! < 0.3 ||
      (s.kind[i] ? read(layout.hailEnabled!) < 0.5 : read(layout.enabled) < 0.5)
    )
      continue;
    for (let j = i + 1; j < SNOW_PARTICLES; j++) {
      if (
        s.live[j] !== 2 ||
        s.age[j]! < 0.3 ||
        (s.kind[j] ? read(layout.hailEnabled!) < 0.5 : read(layout.enabled) < 0.5)
      )
        continue;
      const mi = s.ice[i]! + s.water[i]!,
        mj = s.ice[j]! + s.water[j]!;
      const wi = s.water[i]! / mi,
        wj = s.water[j]! / mj;
      // Dry branches interlock first; compaction takes several seconds. Wet caps meet later,
      // at their smaller water footprint, then coalesce more quickly.
      const ri = wi > 0.8 ? 0.34 * root(s.water[i]!) : s.radius[i]! * (0.55 + 0.4 * s.compact[i]!);
      const rj = wj > 0.8 ? 0.34 * root(s.water[j]!) : s.radius[j]! * (0.55 + 0.4 * s.compact[j]!);
      const dx = s.x[j]! - s.x[i]!,
        dy = s.y[j]! - s.y[i]!;
      const zi = Math.sqrt(Math.max(0.02, 1 - s.x[i]! * s.x[i]! - s.y[i]! * s.y[i]!));
      const zj = Math.sqrt(Math.max(0.02, 1 - s.x[j]! * s.x[j]! - s.y[j]! * s.y[j]!));
      if (dx * dx + dy * dy + (zi - zj) * (zi - zj) > (ri + rj) * (ri + rj)) continue;
      // Collect downhill, rather than making a larger upper deposit draw material uphill.
      const flow = dx * gx + dy * gy;
      const head = Math.abs(flow) > 0.000001 ? (flow > 0 ? j : i) : mi >= mj ? i : j;
      const donor = head === i ? j : i;
      if (s.radius[head]! > 0.14) continue;
      s.live[donor] = 3;
      s.pair[donor] = head;
      s.transfer[donor] = (s.ice[donor]! + s.water[donor]!) / (wi > 0.8 && wj > 0.8 ? 0.7 : 5.5);
      // Impact/contact dissipates motion and transfers a small sideways impulse, not position.
      s.vx[head] = s.vx[head]! * 0.3 + s.vx[donor]! * 0.15;
      s.vy[head]! *= 0.3;
      break;
    }
  }
  if (rain) {
    for (const owner of rain.owner) {
      const i = owner - RAIN_DROPS;
      if (i >= 0 && s.live[i] !== 2) releaseRainTrail(rain, owner, s.x[i]!, s.y[i]!, time);
    }
  }
  s.done++;
}
export function snowTo(
  s: SnowData,
  layout: SnowLayout,
  dials: ArrayLike<number>,
  time: number,
  most: number,
  level = 0,
  rain?: RainData,
): void {
  "worklet";
  const target = Math.floor(time * 60 + 1e-3);
  const hailOn = layout.hailEnabled !== undefined && dials[layout.hailEnabled]! >= 0.5;
  if (
    dials[layout.enabled]! < 0.5 &&
    (!hailOn ||
      (dials[layout.hailAmount!]! <= 0 && !s.live.some((v, i) => v > 0 && s.kind[i] === 1)))
  ) {
    s.done = target;
    s.frac = 1;
    s.paused = true;
    return;
  }
  if (s.paused) {
    for (let i = 0; i < SNOW_PARTICLES; i++) {
      s.px[i] = s.x[i]!;
      s.py[i] = s.y[i]!;
      s.pradius[i] = s.radius[i]!;
      s.pphase[i] = s.phase[i]!;
    }
    s.paused = false;
  }
  if (
    dials[layout.amount]! + dials[layout.react]! * level <= 0 &&
    (!hailOn || dials[layout.hailAmount!]! <= 0) &&
    s.live.every((v) => v === 0)
  ) {
    s.done = target;
    s.frac = Math.min(1, Math.max(0, time * 60 + 1e-3 - target));
    return;
  }
  if (target - s.done > most) s.done = target - most;
  while (s.done < target) tick(s, layout, dials, level, rain);
  s.frac = Math.min(1, Math.max(0, time * 60 + 1e-3 - target));
}
export function writeSnow(s: SnowData, layout: SnowLayout, out: { [i: number]: number }): void {
  "worklet";
  for (let i = 0; i < SNOW_PARTICLES; i++) {
    const at = (layout.pool + i) * 4,
      t = s.frac;
    const x = s.px[i]! + (s.x[i]! - s.px[i]!) * t,
      y = s.py[i]! + (s.y[i]! - s.py[i]!) * t;
    const qx = Math.round(Math.min(1, Math.max(0, (x + 1.2) / 2.4)) * 4095);
    const qy = Math.round(Math.min(1, Math.max(0, (y + 1.2) / 2.4)) * 4095);
    out[at] = qx * 4096 + qy;
    const r = s.pradius[i]! + (s.radius[i]! - s.pradius[i]!) * t;
    out[at + 1] = s.live[i]! > 0 ? r : 0;
    out[at + 2] = s.kind[i] ? -s.id[i]! : s.id[i]!;
    const phase = s.pphase[i]! + (s.phase[i]! - s.pphase[i]!) * t;
    const ice = Math.round(Math.min(1, Math.max(0, phase)) * 1023);
    const compact = Math.round(s.compact[i]! * 255);
    const drive = Math.round(Math.min(1, Math.max(0, -phase)) * 63);
    out[at + 3] =
      s.live[i] === 1 || s.live[i] === 4 ? phase : -(1 + ice + compact * 1024 + drive * 262144);
  }
}
export function copySnow(s: SnowData): SnowData {
  "worklet";
  return {
    ...s,
    live: [...s.live],
    kind: [...s.kind],
    x: [...s.x],
    y: [...s.y],
    px: [...s.px],
    py: [...s.py],
    radius: [...s.radius],
    pradius: [...s.pradius],
    ice: [...s.ice],
    water: [...s.water],
    phase: [...s.phase],
    pphase: [...s.pphase],
    id: [...s.id],
    age: [...s.age],
    flight: [...s.flight],
    targetX: [...s.targetX],
    targetY: [...s.targetY],
    incomingX: [...s.incomingX],
    incomingY: [...s.incomingY],
    vx: [...s.vx],
    vy: [...s.vy],
    pair: [...s.pair],
    compact: [...s.compact],
    transfer: [...s.transfer],
  };
}
