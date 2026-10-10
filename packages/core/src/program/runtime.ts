// The part of an orb that runs on the CPU, the same on every platform: a critically damped spring
// per dial toward the current state, the input level's smoothing, the clocks rates are integrated
// into, and the rain running down the glass (rain.ts), stepped with the rain clock. Everything
// else (where each cloud has drifted, how the drops look) the shader works out from these, so a
// port to another platform is this file and rain.ts, a draw call and, for a picture or clip, a
// texture.
//
// Written as plain functions over plain data, each marked as a worklet, so React Native can run
// them on its UI thread through react-native-worklets. Anywhere else the directive is an inert
// string. `OrbRuntime` wraps them for everyone who wants an object.
import type { OrbProgram } from "./compile";
import { copyRain, createRain, rainTo, writeRain, type RainData } from "./rain";
import { copySnow, createSnow, snowTo, writeSnow, type SnowData } from "./snow";
import { FEATURES } from "./features";

type Floats = number[] | Float32Array;

/** The runtime's state as plain data: what a worklet can hold between frames. */
export interface RuntimeData {
  state: string;
  x: Floats;
  v: Floats;
  target: Floats;
  omega: number;
  level: number;
  levelTarget: number;
  /** Time, then the other seven clocks, each integrated from its rate. */
  clock: number[];
  /** The picture or clip's width and height in pixels, and 1 once it has loaded. */
  media: number[];
  /** The rain running down the glass (rain.ts), stepped with the rain clock. */
  rain: RainData;
  snow: SnowData;
  ice: number;
  paintX: number[];
  paintV: number[];
  paintTarget: number[];
}

/** Steps of rain a frame may take before the rest is skipped unseen, and a seek may take. */
const RAIN_FRAME = 120;
const RAIN_SEEK = 60 * 600;

/** The stiffness that settles within 2% of a move after `duration` seconds from rest. */
export function omegaFor(duration: number): number {
  "worklet";
  return 5.84 / Math.max(duration, 1e-3);
}

/**
 * One exact step of a critically damped spring per channel: the closed-form solution of
 * y'' + 2ωy' + ω²y = 0, stable at any frame time. It starts from rest, carries its velocity into a
 * new target when the state changes mid-move, and never overshoots.
 */
export function springStep(
  x: Floats,
  v: Floats,
  target: ArrayLike<number>,
  dt: number,
  omega: number,
): void {
  "worklet";
  const decay = Math.exp(-omega * dt);
  for (let i = 0; i < x.length; i++) {
    const y = x[i]! - target[i]!;
    const k = v[i]! + omega * y;
    x[i] = target[i]! + (y + k * dt) * decay;
    v[i] = (v[i]! - omega * k * dt) * decay;
  }
}

function resolveState(program: OrbProgram, name: string): string {
  "worklet";
  if (name in program.states) return name;
  return program.state in program.states ? program.state : Object.keys(program.states)[0]!;
}

/** Fresh state for `program`, settled in `state` (or the program's opening state). */
export function createRuntimeData(program: OrbProgram, state = program.state): RuntimeData {
  "worklet";
  if (program.version !== 12)
    throw new Error("[orb3d] re-export this program with the matching format-12 library");
  const name = resolveState(program, state);
  const target = program.states[name]!;
  return {
    paintX: (program.paint?.states ?? []).map((stateName) => Number(stateName === name)),
    paintV: (program.paint?.states ?? []).map(() => 0),
    paintTarget: (program.paint?.states ?? []).map((stateName) => Number(stateName === name)),
    state: name,
    x: [...target.dials],
    v: Array.from({ length: target.dials.length }, () => 0),
    target: target.dials,
    omega: omegaFor(target.duration),
    level: 0,
    levelTarget: 0,
    clock: Array.from({ length: 8 }, () => 0),
    media: [1, 1, 0],
    rain: createRain(program),
    snow: createSnow(),
    ice: 0,
  };
}

/** Cut every dial to the current state's value. */
export function settleRuntime(data: RuntimeData): void {
  "worklet";
  for (let i = 0; i < data.paintX.length; i++) {
    data.paintX[i] = data.paintTarget[i]!;
    data.paintV[i] = 0;
  }
  for (let i = 0; i < data.x.length; i++) {
    data.x[i] = data.target[i]!;
    data.v[i] = 0;
  }
}

/** Spring toward a state (or cut to it). An unknown name falls back to the opening state. */
export function setRuntimeState(
  data: RuntimeData,
  program: OrbProgram,
  name: string,
  immediate = false,
): void {
  "worklet";
  data.state = resolveState(program, name);
  const state = program.states[data.state]!;
  data.target = state.dials;
  data.paintTarget = (program.paint?.states ?? []).map((stateName) =>
    Number(stateName === data.state),
  );
  data.omega = omegaFor(state.duration);
  for (const at of program.switches) {
    data.x[at] = data.target[at]!;
    data.v[at] = 0;
  }
  if (immediate) settleRuntime(data);
}

export function setRuntimeLevel(data: RuntimeData, value: number): void {
  "worklet";
  data.levelTarget = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

/** Rates integrate into clocks, so a speed change moves things on from where they are. */
function integrate(data: RuntimeData, program: OrbProgram, dt: number): void {
  "worklet";
  const { x, clock } = data;
  const step = dt * x[program.speed]!;
  clock[0]! += step;
  for (let i = 0; i < program.clocks.length; i++) {
    const [rate, react] = program.clocks[i]!;
    if (rate < 0) continue;
    const windMean =
      i === 5
        ? Math.max(0, x[program.weather.gusts]! - x[rate]!) * 0.5 * x[program.weather.turbulence]!
        : 0;
    clock[i + 1]! += step * (x[rate]! + windMean + (react < 0 ? 0 : x[react]! * data.level));
  }
}

/** The picture or clip's size in pixels, once it has loaded; zero width for none. */
export function setRuntimeMedia(data: RuntimeData, width: number, height: number): void {
  "worklet";
  const ready = width > 0 && height > 0;
  data.media[0] = ready ? width : 1;
  data.media[1] = ready ? height : 1;
  data.media[2] = ready ? 1 : 0;
}

export function advanceRuntime(data: RuntimeData, program: OrbProgram, dt: number): void {
  "worklet";
  const { attack, release } = program.level;
  const tau = data.levelTarget > data.level ? attack : release;
  data.level += (data.levelTarget - data.level) * (1 - Math.exp(-dt / tau));
  springStep(data.x, data.v, data.target, dt, data.omega);
  springStep(data.paintX, data.paintV, data.paintTarget, dt, data.omega);
  for (const at of program.switches) {
    data.x[at] = data.target[at]!;
    data.v[at] = 0;
  }
  integrate(data, program, dt);
  if (data.x[program.weather.iceEnabled]! >= 0.5) {
    const deposit = data.x[program.weather.iceAmount]!;
    const thaw = data.x[program.weather.iceMelt]! * 0.16;
    const rate = deposit * 0.45 + thaw;
    if (rate > 0) {
      const target = (deposit * 0.45) / rate;
      data.ice = target + (data.ice - target) * Math.exp(-rate * dt * data.x[program.speed]!);
    }
  }
  if (program.weather.view === 0) {
    rainTo(data.rain, program, data.x, data.clock[1]!, RAIN_FRAME, data.clock[0]!);
    snowTo(data.snow, program.snow, data.x, data.clock[0]!, RAIN_FRAME, data.level, data.rain);
  }
}

/** The settled frame `time` seconds after opening in the current state. */
export function seekRuntime(data: RuntimeData, program: OrbProgram, time: number): void {
  "worklet";
  settleRuntime(data);
  data.level = data.levelTarget;
  data.clock = Array.from({ length: 8 }, () => 0);
  integrate(data, program, time);
  const deposit =
    data.x[program.weather.iceEnabled]! >= 0.5 ? data.x[program.weather.iceAmount]! * 0.45 : 0;
  const rate = deposit + data.x[program.weather.iceMelt]! * 0.16;
  data.ice =
    rate > 0 ? (deposit / rate) * (1 - Math.exp(-rate * time * data.x[program.speed]!)) : 0;
  data.rain = createRain(program);
  if (program.weather.view === 0)
    rainTo(data.rain, program, data.x, data.clock[1]!, RAIN_SEEK, data.clock[0]!);
  data.snow = createSnow();
  if (program.weather.view === 0)
    snowTo(data.snow, program.snow, data.x, data.clock[0]!, RAIN_SEEK, data.level, data.rain);
}

/**
 * Fill `out` (the shader's uniform array, `slots` vec4s, with the program's structure already in
 * it) for a canvas `width` × `height`, in units of `pixelRatio` device pixels.
 */
export function writeRuntime(
  data: RuntimeData,
  program: OrbProgram,
  out: Floats,
  width: number,
  height: number,
  pixelRatio = 1,
): void {
  "worklet";
  out[0] = width;
  out[1] = height;
  out[2] = data.level;
  out[3] = pixelRatio;
  for (let i = 0; i < 8; i++) out[4 + i] = data.clock[i]!;
  out[12] = data.media[0]!;
  out[13] = data.media[1]!;
  out[14] = data.media[2]!;
  let flags = program.features;
  const rainEnabled = data.x[program.rain.enabled!]! >= 0.5;
  const snowEnabled = data.x[program.snow.enabled]! >= 0.5;
  const hailEnabled = data.x[program.weather.hailEnabled]! >= 0.5;
  const frozenEnabled = snowEnabled || hailEnabled;
  let wetRain = false,
    wetSnow = false;
  if (rainEnabled || frozenEnabled) {
    for (let i = 0; i < data.rain.count.length; i++) {
      if (data.rain.count[i]! <= 0) continue;
      const snow = data.rain.source[i]! <= -2;
      const allowed = data.rain.source[i] === -3 ? hailEnabled : snow ? snowEnabled : rainEnabled;
      if (!allowed) continue;
      if (data.rain.owner[i]! < 0 && data.clock[0]! - data.rain.stamp[i * 12]! >= 8) continue;
      if (snow) wetSnow = true;
      else wetRain = true;
    }
  }
  const drops =
    rainEnabled &&
    (data.x[program.rain.amount]! > 0 || data.x[program.rain.density]! > 0 || data.rain.dynamic);
  const flakes = data.snow.live.some(
    (live, i) => live > 0 && (data.snow.kind[i] ? hailEnabled : snowEnabled),
  );
  if (!drops && !wetRain) flags &= ~FEATURES.rain;
  if (!flakes && !wetSnow) flags &= ~(FEATURES.snow | FEATURES.hail);
  if (!drops) flags &= ~FEATURES.rainDrops;
  if (!flakes) flags &= ~FEATURES.snowFlakes;
  if (!rainEnabled || data.x[program.rain.mist!]! <= 0) flags &= ~FEATURES.mist;
  if (data.x[program.switches[2]!]! < 0.5) flags &= ~FEATURES.fog;
  if (data.x[program.switches[3]!]! < 0.5) flags &= ~FEATURES.sunny;
  const incoming =
    (rainEnabled && data.x[program.rain.density]! > 0) ||
    (snowEnabled &&
      data.x[program.snow.density]! > 0 &&
      data.x[program.snow.amount]! + data.x[program.snow.react]! * data.level > 0) ||
    (hailEnabled &&
      data.x[program.snow.hailAmount!]! > 0 &&
      data.x[program.snow.hailDensity!]! > 0);
  if (!incoming) flags &= ~FEATURES.air;
  out[15] = flags % 1048576;
  out[program.weather.canvas * 4 + 2] = Math.floor(flags / 1048576);
  out[program.weather.canvas * 4 + 3] = data.ice;
  const at = program.dialSlot * 4;
  for (let i = 0; i < data.x.length; i++) out[at + i] = data.x[i]!;
  writeRain(data.rain, program, out, data.snow, drops, wetRain || wetSnow);
  if (flakes) writeSnow(data.snow, program.snow, out);
}

/** The separate colour buffers: no gradient work or allocation for a solid-only program. */
export function createPaintUniforms(program: OrbProgram): number[] {
  "worklet";
  return program.paint ? [...program.paint.static] : [];
}
export function writePaintRuntime(data: RuntimeData, out: Floats): void {
  "worklet";
  for (let i = 0; i < data.paintX.length; i++) out[i] = data.paintX[i]!;
}

/** A uniform array for `program`, with its structure written in. */
export function createUniforms(program: OrbProgram): number[] {
  "worklet";
  const out = Array.from({ length: program.slots * 4 }, () => 0);
  for (let i = 0; i < program.static.length; i++)
    out[program.staticSlot * 4 + i] = program.static[i]!;
  return out;
}

/** Named uniform blocks for native shader bindings. Allocate only when the program changes. */
export function createUniformBindings(program: OrbProgram): Record<string, number[]> {
  "worklet";
  const out: Record<string, number[]> = { uData: createUniforms(program) };
  for (let i = 0; i < (program.paint?.pages.length ?? 0); i++) {
    out[`uPaint${i}`] = program.paint!.static.slice(
      i * 4096,
      i * 4096 + program.paint!.pages[i]! * 4,
    );
  }
  return out;
}

/** Update existing blocks in place; spatial-colour definitions are immutable during playback. */
export function writeUniformBindings(
  data: RuntimeData,
  program: OrbProgram,
  out: Record<string, number[]>,
  width: number,
  height: number,
  pixelRatio = 1,
): void {
  "worklet";
  writeRuntime(data, program, out.uData!, width, height, pixelRatio);
  if (out.uPaint0) writePaintRuntime(data, out.uPaint0);
}

export interface RuntimeSnapshot {
  x: Float32Array;
  v: Float32Array;
  paintX?: number[];
  paintV?: number[];
  clock: number[];
  level: number;
  rain: RainData;
  snow: SnowData;
  ice: number;
}

/** The authored water layout, excluding reserved simulation pools. */
function authoredRain(orb: OrbProgram): number[] {
  const start = (orb.rain.counts - orb.staticSlot) * 4;
  const end = (orb.rain.pool - orb.staticSlot) * 4;
  return orb.static.slice(start, end);
}

/** The runtime as an object, over the same functions. */
export class OrbRuntime {
  /** The shader's uniform array, `slots` vec4s. {@link write} brings it up to date; a new
   *  program of another size replaces it. */
  data: Float32Array;
  paintData: Float32Array;
  #program: OrbProgram;
  #state: RuntimeData;

  constructor(program: OrbProgram, state = program.state) {
    this.#program = program;
    this.data = new Float32Array(createUniforms(program));
    this.paintData = new Float32Array(createPaintUniforms(program));
    this.#state = this.#fresh(program, state);
  }

  get program(): OrbProgram {
    return this.#program;
  }

  get state(): string {
    return this.#state.state;
  }

  get level(): number {
    return this.#state.level;
  }

  /** Swap in a recompiled program: the structure is rewritten and the dials cut to their values. */
  setProgram(program: OrbProgram, state = this.#state.state, transition = false): void {
    const previous = this.snapshot();
    const { level, levelTarget, clock, media, rain, snow, ice } = this.#state;
    const old = this.#program;
    const oldDrops = authoredRain(old),
      newDrops = authoredRain(program);
    const keepRain =
      oldDrops.length === newDrops.length && oldDrops.every((value, i) => value === newDrops[i]);
    this.#program = program;
    if (this.data.length !== program.slots * 4) this.data = new Float32Array(program.slots * 4);
    this.data.set(createUniforms(program));
    this.paintData = new Float32Array(createPaintUniforms(program));
    this.#state = { ...this.#fresh(program, state), level, levelTarget, clock, media, snow, ice };
    if (keepRain) this.#state.rain = rain;
    if (transition && previous.x.length === this.#state.x.length) {
      this.#state.x = Float32Array.from(previous.x);
      this.#state.v = Float32Array.from(previous.v);
      setRuntimeState(this.#state, program, state);
    }
    // The rain starts over with the new drops, as it would have been a little while running.
    if (!keepRain)
      if (program.weather.view === 0)
        rainTo(this.#state.rain, program, this.#state.x, clock[1]!, RAIN_FRAME * 5, clock[0]!);
  }

  /** The picture or clip's size in pixels once it has loaded, or 0 × 0 while there is none. */
  setMedia(width: number, height: number): void {
    setRuntimeMedia(this.#state, width, height);
  }

  setState(name: string, immediate = false): void {
    setRuntimeState(this.#state, this.#program, name, immediate);
  }

  setLevel(value: number): void {
    setRuntimeLevel(this.#state, value);
  }

  settle(): void {
    settleRuntime(this.#state);
  }

  advance(dt: number): void {
    advanceRuntime(this.#state, this.#program, dt);
  }

  seek(time: number): void {
    seekRuntime(this.#state, this.#program, time);
  }

  write(width: number, height: number, pixelRatio = 1): Float32Array {
    writeRuntime(this.#state, this.#program, this.data, width, height, pixelRatio);
    writePaintRuntime(this.#state, this.paintData);
    return this.data;
  }

  snapshot(): RuntimeSnapshot {
    const { x, v, clock, level, rain, snow, ice } = this.#state;
    return {
      paintX: [...this.#state.paintX],
      paintV: [...this.#state.paintV],
      x: Float32Array.from(x),
      v: Float32Array.from(v),
      clock: [...clock],
      level,
      rain: copyRain(rain),
      snow: copySnow(snow),
      ice,
    };
  }

  restore(snapshot: RuntimeSnapshot): void {
    if (snapshot.paintX) this.#state.paintX = [...snapshot.paintX];
    if (snapshot.paintV) this.#state.paintV = [...snapshot.paintV];
    this.#state.x = Float32Array.from(snapshot.x);
    this.#state.v = Float32Array.from(snapshot.v);
    this.#state.clock = [...snapshot.clock];
    this.#state.level = snapshot.level;
    this.#state.rain = copyRain(snapshot.rain);
    this.#state.snow = copySnow(snapshot.snow);
    this.#state.ice = snapshot.ice;
  }

  /** Float32Array springs on the web: the same arithmetic, and no per-frame boxing. */
  #fresh(program: OrbProgram, state: string): RuntimeData {
    const data = createRuntimeData(program, state);
    data.x = Float32Array.from(data.x);
    data.v = Float32Array.from(data.v);
    return data;
  }
}
