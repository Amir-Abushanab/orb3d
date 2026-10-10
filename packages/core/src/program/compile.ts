import { compilePaint, type PaintProgram } from "./paint";
// A config, compiled: the shader's uniform array with the structure already written, plus each
// state's dials as a plain vector. Plain JSON, so it travels to Swift, Kotlin or a worklet as is,
// and a platform runs an orb without reimplementing the config model.
import {
  contentsModel,
  ensureOrbConfig,
  stateDuration,
  stateNames,
  writeStateDials,
  type ContentsShader,
  type ContentsType,
  type OrbConfigInput,
  type SunsetContents,
} from "../config/model";
import { parseHex } from "../util/color";
import {
  BANK_STRIDE,
  CLOCKS,
  CLOUD_STRIDE,
  CONTENTS_CLOCK,
  programLayout,
  type ProgramLayout,
} from "./layout";
import { type RainLayout } from "./rain";
import { type SnowLayout } from "./snow";
import { orbShader, type ShaderDialect } from "./shader";
import { programFeatures } from "./features";

export interface OrbProgramState {
  /** The dials this state resolves to, `dialCount` floats. */
  dials: number[];
  /** Seconds a move into this state takes to settle. */
  duration: number;
}

export interface OrbProgram {
  format: "orb3d-program";
  version: 12;
  paint?: PaintProgram;
  /** Capabilities used by any state; the shader can omit everything else. */
  features: number;
  /** Boolean weather switches, cut immediately rather than interpolated. */
  switches: number[];
  /** What the orb holds, and the shader that draws it (a picture and a clip share one). */
  contents: ContentsType;
  shader: ContentsShader;
  /** A picture or clip for the platform to load and bind: where from, and which it is. */
  media?: { src: string; kind: "image" | "video" };
  /** The custom shader's code, which the platform's shader is built round. */
  code?: string;
  /** The shader, expanded for each dialect asked for (see {@link CompileOptions.shaders}). */
  shaders?: Partial<Record<ShaderDialect, string>>;
  /** Length of the uniform array in vec4 slots. */
  slots: number;
  /** First slot of the dials, and how many floats they take. */
  dialSlot: number;
  dialCount: number;
  /** First slot of the structure, and its floats, written once. */
  staticSlot: number;
  static: number[];
  /** The dial channel of the speed every clock runs at. */
  speed: number;
  /** Where the rain's simulation (rain.ts) finds the authored drops and writes the simulated water. */
  rain: RainLayout;
  snow: SnowLayout;
  weather: {
    view: number;
    canvas: number;
    windSpeed: number;
    gusts: number;
    turbulence: number;
    reducedMotion: number;
    hailEnabled: number;
    hailAmount: number;
    hailDensity: number;
    hailSize: number;
    hailBounce: number;
    hailMelt: number;
    iceEnabled: number;
    iceAmount: number;
    iceMelt: number;
  };
  /**
   * Clocks 1 to 7, in order: the dial channel each integrates as its rate, and the channel of the
   * level's share in that rate; -1 for none. Clock 0 is time.
   */
  clocks: [rate: number, react: number][];
  level: { attack: number; release: number };
  quality: number;
  dprMax: number;
  paused: boolean;
  /** The state the orb opens in. */
  state: string;
  states: Record<string, OrbProgramState>;
}

export interface CompileOptions {
  /**
   * Carry the shader in these dialects, for a platform that cannot build it itself: Swift needs
   * `"msl"`, Android `"glsl"`. The web and React Native build theirs from the program.
   */
  shaders?: readonly ShaderDialect[];
}

/** Five significant decimals: invisible in a colour or a position, and half the JSON. */
const round = (value: number): number => Math.round(value * 1e5) / 1e5;

function rgb(hex: string): [number, number, number] {
  return parseHex(hex) ?? [0, 0, 0];
}

type Put = (slot: number, values: readonly number[]) => void;
/** Write values at a float offset into a block: puffs and beads are packed three floats apart. */
type PutFloats = (slot: number, offset: number, values: readonly number[]) => void;

function writeSunset(
  contents: SunsetContents,
  layout: ProgramLayout,
  put: Put,
  putFloats: PutFloats,
): void {
  const { slot } = layout;
  const { clouds, sea, wisps } = contents;
  put(slot.scene!, [wisps.items.length, clouds.items.length, sea.banks.length, 0]);
  wisps.items.forEach((wisp, i) => put(slot.wisps! + i, wisp));

  let first = 0;
  clouds.items.forEach((cloud, c) => {
    const left = Math.min(...cloud.puffs.map(([x, , r]) => x - r)) + 0.04;
    const right = Math.max(...cloud.puffs.map(([x, , r]) => x + r)) - 0.04;
    const depth = 0.7 * Math.max(...cloud.puffs.map(([, , r]) => r));
    const top = Math.max(...cloud.puffs.map(([, y, r]) => y + r));
    const at = slot.clouds! + c * CLOUD_STRIDE;
    put(at, [left, right, cloud.base, depth]);
    put(at + 1, [first, cloud.puffs.length, top + 0.03, 0]);
    put(at + 2, [...rgb(cloud.shade), 0]);
    put(at + 3, [...rgb(cloud.body), 0]);
    put(at + 4, [...rgb(cloud.crown), 0]);
    for (const puff of cloud.puffs) putFloats(slot.cloudPuffs!, 3 * first++, puff);
  });

  first = 0;
  sea.banks.forEach((bank, b) => {
    // A bank is a row of evenly spaced puffs, so it repeats every row's width: puffs drifting off
    // one end come back on at the other, well outside the glass, and the row never shows a seam.
    const xs = bank.puffs.map(([x]) => x);
    const n = xs.length;
    const period = n > 1 ? ((Math.max(...xs) - Math.min(...xs)) * n) / (n - 1) : 3;
    const at = slot.banks! + b * BANK_STRIDE;
    put(at, [bank.y, Math.max(...bank.puffs.map(([, , r]) => r)), first, n]);
    put(at + 1, [period, 0, 0, 0]);
    put(at + 2, [...rgb(bank.top), 0]);
    put(at + 3, [...rgb(bank.foot), 0]);
    put(at + 4, [...rgb(bank.crest), 0]);
    for (const puff of bank.puffs) putFloats(slot.bankPuffs!, 3 * first++, puff);
  });
}

/** Compile a config (any partial one; it is filled and validated first). */
export function compileOrb(partial: OrbConfigInput, options: CompileOptions = {}): OrbProgram {
  const config = ensureOrbConfig(partial);
  const { contents } = config;
  const layout = programLayout(contents.type);
  const { slot, staticSlot } = layout;
  const offset = layout.dials.offset;
  const data = new Float32Array((layout.slots - staticSlot) * 4);
  const put: Put = (at, values) => data.set(values, (at - staticSlot) * 4);
  const putFloats: PutFloats = (at, floatOffset, values) =>
    data.set(values, (at - staticSlot) * 4 + floatOffset);

  put(slot.canvas!, [config.size, ["orb", "sky", "overlay"].indexOf(config.weather.view), 0, 0]);
  const background = config.background === "transparent" ? null : rgb(config.background);
  put(slot.canvas! + 1, [...(background ?? [0, 0, 0]), background ? 1 : 0]);
  const { rain } = config;
  put(slot.counts!, [rain.drops.length, rain.beads.length, 0, 0]);
  rain.drops.forEach((drop, i) => put(slot.drops! + i, drop));
  rain.beads.forEach((bead, i) => putFloats(slot.beads!, 3 * i, bead));

  if (contents.type === "sunset") writeSunset(contents, layout, put, putFloats);
  if (contents.type === "image" || contents.type === "video") {
    put(slot.media!, [contents.fit === "contain" ? 1 : 0, 0, 0, 0]);
  }

  const states: Record<string, OrbProgramState> = {};
  for (const name of stateNames(config)) {
    states[name] = {
      dials: Array.from(writeStateDials(config, name), round),
      duration: stateDuration(config, name),
    };
  }

  const channel = (key?: string): number => (key === undefined ? -1 : (offset[key] ?? -1));
  const clocks: [number, number][] = Array.from({ length: CLOCKS - 1 }, () => [-1, -1]);
  clocks[0] = [channel("rain.run"), channel("react.rain")];
  clocks[1] = [channel("environment.spin"), -1];
  clocks[2] = [channel("fog.drift"), -1];
  contentsModel(contents.type).clocks.forEach(([rate, react], i) => {
    clocks[CONTENTS_CLOCK - 1 + i] = [channel(rate), channel(react)];
  });

  clocks[5] = [channel("weather.windSpeed"), -1];
  clocks[6] = [channel("weather.clouds.speed"), -1];
  const paint = compilePaint(config, Object.keys(states));
  const program: OrbProgram = {
    format: "orb3d-program",
    version: 12,
    ...(paint ? { paint } : {}),
    features: programFeatures(config, states),
    switches: layout.dials.dials
      .filter((dial) => dial.kind === "boolean")
      .map((dial) => channel(dial.key)),
    contents: contents.type,
    shader: layout.shader,
    slots: layout.slots,
    dialSlot: layout.dialSlot,
    dialCount: layout.dials.channels,
    staticSlot,
    static: Array.from(data, round),
    speed: channel("speed"),
    rain: {
      counts: slot.counts!,
      drops: slot.drops!,
      pool: slot.pool!,
      trails: slot.trails!,
      amount: channel("rain.amount"),
      density: channel("rain.density"),
      spawn: channel("rain.spawn"),
      direction: channel("rain.direction"),
      angle: channel("rain.angle"),
      enabled: channel("weather.rain.enabled"),
      wind: channel("weather.wind"),
      mist: channel("rain.mist"),
      size: channel("weather.rain.size"),
      windSpeed: channel("weather.windSpeed"),
      gusts: channel("weather.gusts"),
      turbulence: channel("weather.turbulence"),
    },
    snow: {
      pool: slot.snow!,
      hailEnabled: channel("weather.hail.enabled"),
      hailAmount: channel("weather.hail.amount"),
      hailDensity: channel("weather.hail.density"),
      hailSize: channel("weather.hail.size"),
      hailBounce: channel("weather.hail.bounce"),
      hailMelt: channel("weather.hail.melt"),
      windSpeed: channel("weather.windSpeed"),
      gusts: channel("weather.gusts"),
      turbulence: channel("weather.turbulence"),
      amount: channel("snow.amount"),
      density: channel("snow.density"),
      dispersion: channel("snow.dispersion"),
      angle: channel("snow.angle"),
      fall: channel("snow.fall"),
      size: channel("snow.size"),
      stick: channel("snow.stick"),
      melt: channel("snow.melt"),
      gravity: channel("rain.direction"),
      react: channel("react.snow"),
      enabled: channel("weather.snow.enabled"),
      wind: channel("weather.wind"),
    },
    weather: Object.fromEntries(
      Object.entries({
        view: ["orb", "sky", "overlay"].indexOf(config.weather.view),
        canvas: slot.canvas!,
        windSpeed: channel("weather.windSpeed"),
        gusts: channel("weather.gusts"),
        turbulence: channel("weather.turbulence"),
        reducedMotion: channel("weather.reducedMotion"),
        hailEnabled: channel("weather.hail.enabled"),
        hailAmount: channel("weather.hail.amount"),
        hailDensity: channel("weather.hail.density"),
        hailSize: channel("weather.hail.size"),
        hailBounce: channel("weather.hail.bounce"),
        hailMelt: channel("weather.hail.melt"),
        iceEnabled: channel("weather.ice.enabled"),
        iceAmount: channel("weather.ice.amount"),
        iceMelt: channel("weather.ice.melt"),
      }),
    ) as OrbProgram["weather"],
    clocks,
    level: { ...config.level },
    quality: config.quality,
    dprMax: config.dprMax,
    paused: config.paused,
    state: config.state,
    states,
  };
  if (contents.type === "image" || contents.type === "video") {
    program.media = { src: contents.src, kind: contents.type };
  }
  if (contents.type === "shader") program.code = contents.code;
  const dialects = options.shaders ?? (paint ? (["glsl", "msl"] as const) : []);
  if (dialects.length) {
    program.shaders = Object.fromEntries(
      dialects.map((dialect) => [dialect, orbShader(dialect, program)]),
    );
  }
  return program;
}
