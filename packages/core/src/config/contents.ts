import { normalizeFill, skyFill, skyColorAliases, type ColorValue } from "./fill";
// What sits inside the glass. An orb's `contents` is one of these, picked by `type`; the glass round
// it is the same whatever it holds. Each kind declares its dials (what a state can move), the rates
// its clocks integrate, its defaults, and how its structure is checked. The shader that draws each
// kind lives in program/, so this stays light enough for the shell to import.
import { normalizeColor, parseHex } from "../util/color";
import { clamp, color, finite, isPlainObject, num, tuple, type Dial } from "./dials";
import { SUNSET_BANKS, SUNSET_CLOUDS, SUNSET_SKY, SUNSET_WISPS } from "./sunset";
import type { Bank, Cloud, Puff, Wisp } from "./types";

/** An empty glass: the room round the orb shows through it, upside down, as through a real ball. */
export interface ClearContents {
  type: "none";
}

/** Colour drifting through colour: four pools of light swirling in a base, the whole turning. */
export interface GradientContents {
  type: "gradient";
  /** The four colours that drift through each other. */
  colors: [ColorValue, ColorValue, ColorValue, ColorValue];
  /** The colour they float in. */
  base: ColorValue;
  /** How fast the colours flow. */
  flow: number;
  /** Degrees a second the whole turns; negative turns the other way. */
  spin: number;
  /** How large each colour's pool is. */
  scale: number;
  /** How much the colours swirl into each other. */
  warp: number;
  /** How much brighter the middle glows. */
  core: number;
  /** How much the level swells the pools and stirs them faster. */
  pulse: number;
}

/** A picture or a clip inside the glass. */
export interface MediaContents {
  type: "image" | "video";
  /** A URL on the web and in React Native; on Swift and Android, an asset name or a URL. */
  src: string;
  /** `"cover"` fills the glass; `"contain"` shows all of it, with the room round it. */
  fit: "cover" | "contain";
  /** 1 is the fit; more zooms in. */
  zoom: number;
  /** Where the middle of the picture sits, -1 to 1 of the glass. */
  x: number;
  y: number;
  /** Degrees the picture is turned. */
  angle: number;
  /** Degrees a second it turns. */
  spin: number;
  /** How much the level zooms it in. */
  pulse: number;
}

export interface ImageContents extends MediaContents {
  type: "image";
}

export interface VideoContents extends MediaContents {
  type: "video";
}

/** Your own shader. */
export interface ShaderContents {
  type: "shader";
  /**
   * GLSL that defines `vec4 contents(vec2 p, float time, float level, vec4 knobs, vec3 color1,
   * vec3 color2)`: the colour and alpha at `p`, a point of the glass from -1 to 1, y up. It runs on
   * every platform, so it keeps to what GLSL ES 1.0, SkSL and Metal share: loops with constant
   * bounds, no textures, no derivatives.
   */
  code: string;
  /** Four numbers, 0 to 1, handed to `contents` as `knobs`: dials, so a state can move them. */
  knobs: [number, number, number, number];
  color1: ColorValue;
  color2: ColorValue;
}

export interface SkyConfig {
  /** One solid, stop gradient or editable mesh field for the sky. */
  color: ColorValue;
  /** Exactly six `[offset, colour]` stops from the horizon's glow (0) to the zenith (1). */
  stops: [number, string][];
  /** Scene height where the gradient starts. */
  horizon: number;
  /** Scene height the gradient spans. */
  height: number;
}

export interface SunConfig {
  x: number;
  y: number;
  radius: number;
  color: ColorValue;
  /** Opacity of the glow round the sun, 0 to 3. */
  glow: number;
  /** The glow's radius on the orb's face. */
  glowRadius: number;
  glowCore: ColorValue;
  glowMid: ColorValue;
  glowEdge: ColorValue;
}

export interface WispsConfig {
  color: ColorValue;
  opacity: number;
  items: Wisp[];
}

export interface CloudsConfig {
  /** Scene units per second the clouds drift; negative drifts left. */
  drift: number;
  /** How much the puffs swell and settle, 0 to 1. */
  billow: number;
  items: Cloud[];
}

export interface SeaConfig {
  /** Scene units per second the banks drift, the near ones faster. */
  drift: number;
  /** How high the swell runs along the banks, 0 to 1. */
  swell: number;
  banks: Bank[];
}

/** A sunset over a sea of cloud, drawn flat and seen through the glass: the Plovent mark. */
export interface SunsetContents {
  type: "sunset";
  sky: SkyConfig;
  sun: SunConfig;
  wisps: WispsConfig;
  clouds: CloudsConfig;
  sea: SeaConfig;
  /** How strongly the level adds to the sun's glow and to the clouds' billow. */
  react: { glow: number; billow: number };
}

/** Hills round a lake under a wide sky, in 3D: you glide over the water toward the sun. */
export interface LandscapeContents {
  type: "landscape";
  sky: {
    /** Overhead, and at the horizon, where the haze takes its colour from. */
    zenith: ColorValue;
    horizon: ColorValue;
    /** How much of the sky the clouds cover, 0 to 1, and their colour where the sun lights them. */
    clouds: number;
    cloudColor: ColorValue;
  };
  sun: {
    /** Degrees left (negative) or right of straight ahead. */
    azimuth: number;
    /** Degrees above the horizon; below zero it has set. */
    elevation: number;
    color: ColorValue;
    /** The glow round it. */
    glow: number;
  };
  land: {
    /** How high the hills rise. */
    height: number;
    grass: ColorValue;
    rock: ColorValue;
    snow: ColorValue;
    /** Where the snow starts, as a share of the tallest hills. */
    snowline: number;
  };
  water: {
    color: ColorValue;
    /** How rough the water is. */
    waves: number;
  };
  /** How thick the air is: how fast the distance fades into the horizon's colour. */
  haze: number;
  /** How fast you glide over the water; negative backs away. */
  speed: number;
  /** How fast the clouds go by. */
  wind: number;
  /** How high above the water you are. */
  altitude: number;
  /** How strongly the level stirs the water and brightens the sun. */
  react: { waves: number; sun: number };
}

/** Day, twilight and night are contents; weather is layered over this scene. */
export interface CelestialContents {
  type: "celestial";
  elevation: number;
  sky: { day: ColorValue; night: ColorValue; twilight: ColorValue };
  sun: { radius: number; glow: number; color: ColorValue };
  moon: { x: number; y: number; radius: number; phase: number; amount: number; color: ColorValue };
  stars: { amount: number; color: ColorValue };
}

export type OrbContents =
  | ClearContents
  | GradientContents
  | ImageContents
  | VideoContents
  | ShaderContents
  | SunsetContents
  | LandscapeContents
  | CelestialContents;

export type ContentsType = OrbContents["type"];

/**
 * A block as a config input takes it: every key optional, nested blocks too, since what is left
 * out comes from the defaults (or the config it is merged over). Arrays and colours are values,
 * replaced whole, so they stay complete.
 */
export type ConfigPatch<T> = { [K in keyof T]?: PatchValue<T[K]> };
type PatchValue<V> = V extends readonly unknown[]
  ? V
  : V extends ColorValue
    ? V
    : V extends object
      ? ConfigPatch<V>
      : V;

/**
 * Contents as a config input takes them: `{ type: "image", src: "/avatar.jpg" }`, with the rest
 * from that kind's defaults. Without a `type`, the keys merge into the contents already there.
 */
export type OrbContentsInput = PatchEach<OrbContents>;
type PatchEach<C> = C extends unknown ? ConfigPatch<C> : never;

/** The shader each kind is drawn with; a picture and a clip share one. */
export type ContentsShader =
  | "none"
  | "gradient"
  | "media"
  | "custom"
  | "sunset"
  | "landscape"
  | "celestial";

/** A state's overrides for the contents: any of its dials, nested as in the contents. */
export type ContentsOverride = {
  [key: string]: unknown;
};

export interface ContentsModel<T extends OrbContents = OrbContents> {
  type: T["type"];
  /** For menus. */
  label: string;
  shader: ContentsShader;
  /** In panel order. A dial kept slot-aligned by the shader (the sunset's sky stops) comes first. */
  dials: readonly Dial[];
  /** Up to four clocks: the dial each integrates as its rate, and an optional dial that adds the
   *  level to that rate. */
  clocks: readonly (readonly [rate: string, react?: string])[];
  defaults(): T;
  /** The five standard states' overrides for these contents. */
  states(): Record<string, ContentsOverride>;
  /** Check what is not a dial (sources, code, layouts) from `source`, falling back to `fallback`. */
  structure(source: Record<string, unknown>, fallback: T): Partial<T>;
}

/** Hard caps for the sunset's layout: every array lands in a fixed-size uniform array. */
export const SUNSET_LIMITS = {
  clouds: 6,
  cloudPuffs: 24,
  banks: 4,
  bankPuffs: 32,
  wisps: 4,
} as const;

/** Sky stops are springed channel by channel, so every sunset carries the same number. */
export const SKY_STOPS = 6;

/** The custom shader's code is a string in every config and program: keep it bounded. */
export const SHADER_CODE_LIMIT = 24_000;

const STANDARD_STATES = ["idle", "listening", "thinking", "speaking", "muted"] as const;

function emptyStates(): Record<string, ContentsOverride> {
  return Object.fromEntries(STANDARD_STATES.map((name) => [name, {}]));
}

const clear: ContentsModel<ClearContents> = {
  type: "none",
  label: "Clear glass",
  shader: "none",
  dials: [],
  clocks: [],
  defaults: () => ({ type: "none" }),
  states: emptyStates,
  structure: () => ({}),
};

const gradient: ContentsModel<GradientContents> = {
  type: "gradient",
  label: "Gradient",
  shader: "gradient",
  dials: [
    ...[0, 1, 2, 3].map((i) => color(`contents.colors.${i}`, "Colours", `Colour ${i + 1}`)),
    color("contents.base", "Colours", "Base"),
    num("contents.flow", "Flow", "Flow", 0, 3),
    num("contents.spin", "Flow", "Spin", -180, 180, 1),
    num("contents.scale", "Flow", "Scale", 0.2, 1.5),
    num("contents.warp", "Flow", "Swirl", 0, 2),
    num("contents.core", "Flow", "Core", 0, 1),
    num("contents.pulse", "React", "Pulse", 0, 2),
  ],
  clocks: [["contents.flow", "contents.pulse"], ["contents.spin"]],
  defaults: () => ({
    type: "gradient",
    colors: ["#3b5bff", "#00c8ff", "#a246ff", "#ff5fb4"],
    base: "#0b1240",
    flow: 0.35,
    spin: 6,
    scale: 0.62,
    warp: 0.8,
    core: 0.25,
    pulse: 0,
  }),
  states: () => ({
    idle: {},
    listening: { flow: 0.5, scale: 0.72, core: 0.45 },
    thinking: { flow: 1.4, spin: 40, warp: 1.5 },
    speaking: { flow: 0.6, pulse: 1.2 },
    muted: { flow: 0.12, spin: 2, core: 0.1 },
  }),
  structure: () => ({}),
};

function media<T extends ImageContents | VideoContents>(
  type: T["type"],
  label: string,
): ContentsModel<T> {
  return {
    type,
    label,
    shader: "media",
    dials: [
      num("contents.zoom", "Picture", "Zoom", 0.25, 4),
      num("contents.x", "Picture", "X", -1, 1),
      num("contents.y", "Picture", "Y", -1, 1),
      num("contents.angle", "Picture", "Angle", -180, 180, 1),
      num("contents.spin", "Picture", "Spin", -180, 180, 1),
      num("contents.pulse", "React", "Zoom", 0, 1),
    ],
    clocks: [["contents.spin"]],
    defaults: () =>
      ({
        type,
        src: "",
        fit: "cover",
        zoom: 1,
        x: 0,
        y: 0,
        angle: 0,
        spin: 0,
        pulse: 0,
      }) as T,
    states: () => ({
      idle: {},
      listening: { zoom: 1.06 },
      thinking: { zoom: 1.12, spin: 12 },
      speaking: { zoom: 1.03, pulse: 0.25 },
      muted: {},
    }),
    structure: (source, fallback) =>
      ({
        src: typeof source.src === "string" ? source.src : fallback.src,
        fit: source.fit === "contain" ? "contain" : source.fit === "cover" ? "cover" : fallback.fit,
      }) as Partial<T>,
  };
}

/** The custom shader a fresh one starts from: light pooling and rippling between two colours. */
export const DEFAULT_SHADER_CODE = `// p: a point of the glass, -1 to 1, y up. time: seconds, scaled by the speed dial.
// level: the input level, 0 to 1. knobs and the two colours are dials a state can move.
vec4 contents(vec2 p, float time, float level, vec4 knobs, vec3 color1, vec3 color2) {
  // Waves crossing the glass: knobs.x sets how fine, knobs.y how fast, knobs.z the shine.
  float scale = 2.0 + 6.0 * knobs.x;
  float t = time * (0.3 + 1.5 * knobs.y);
  float v = sin(p.x * scale + t) + sin(p.y * scale * 0.8 - t * 1.3)
    + sin((p.x + p.y) * scale * 0.6 + t * 0.7) + sin(length(p) * scale * 1.4 - t * 1.6);
  float k = 0.5 + 0.125 * v;
  vec3 col = mix(color1, color2, smoothstep(0.2, 0.8, k));
  col += knobs.z * 0.6 * pow(k, 6.0) + 0.3 * level * k;
  return vec4(col, 1.0);
}
`;

const custom: ContentsModel<ShaderContents> = {
  type: "shader",
  label: "Shader",
  shader: "custom",
  dials: [
    ...[0, 1, 2, 3].map((i) => num(`contents.knobs.${i}`, "Knobs", `Knob ${i + 1}`, 0, 1)),
    color("contents.color1", "Knobs", "Colour 1"),
    color("contents.color2", "Knobs", "Colour 2"),
  ],
  clocks: [],
  defaults: () => ({
    type: "shader",
    code: DEFAULT_SHADER_CODE,
    knobs: [0.35, 0.3, 0.5, 0],
    color1: "#141a5c",
    color2: "#6fe3ff",
  }),
  states: () => ({
    idle: {},
    listening: { knobs: [0.35, 0.4, 0.8] },
    thinking: { knobs: [0.7, 1, 0.6] },
    speaking: { knobs: [0.45, 0.5, 0.7] },
    muted: { knobs: [0.2, 0.05, 0.1] },
  }),
  structure: (source, fallback) => ({
    code:
      typeof source.code === "string" && source.code.length <= SHADER_CODE_LIMIT
        ? source.code
        : fallback.code,
  }),
};

function puffs(value: unknown, room: number): Puff[] {
  if (!Array.isArray(value)) return [];
  const out: Puff[] = [];
  for (const entry of value) {
    if (out.length >= room) break;
    const t = tuple(entry, 3);
    if (t && t[2]! > 0) out.push([t[0]!, t[1]!, t[2]!]);
  }
  return out;
}

/** Six sorted stops, padded with copies of the last (which leaves the gradient unchanged). */
export function skyStops(value: unknown, fallback: [number, string][]): [number, string][] {
  if (!Array.isArray(value)) return structuredClone(fallback);
  const stops: [number, string][] = [];
  for (const entry of value) {
    if (!Array.isArray(entry)) continue;
    const at = Number(entry[0]);
    if (!Number.isFinite(at) || typeof entry[1] !== "string" || !parseHex(entry[1])) continue;
    stops.push([clamp(at, 0, 1), normalizeColor(entry[1], "#000000")]);
  }
  if (stops.length === 0) return structuredClone(fallback);
  stops.sort((a, b) => a[0] - b[0]);
  if (stops.length > SKY_STOPS) stops.splice(SKY_STOPS - 1, stops.length - SKY_STOPS);
  while (stops.length < SKY_STOPS) stops.push([...stops.at(-1)!]);
  return stops;
}

function sunsetStructure(
  source: Record<string, unknown>,
  fallback: SunsetContents,
): Partial<SunsetContents> {
  const pick = (block: string): Record<string, unknown> =>
    isPlainObject(source[block]) ? source[block] : {};
  const sky = pick("sky");
  const wisps = pick("wisps");
  const clouds = pick("clouds");
  const sea = pick("sea");

  const wispItems = (Array.isArray(wisps.items) ? wisps.items : [])
    .map((w) => tuple(w, 4))
    .filter((w): w is number[] => w !== null && w[2]! > 0 && w[3]! > 0)
    .slice(0, SUNSET_LIMITS.wisps)
    .map((w) => [w[0]!, w[1]!, w[2]!, w[3]!] as Wisp);

  let cloudRoom: number = SUNSET_LIMITS.cloudPuffs;
  const cloudItems: Cloud[] = [];
  for (const cloud of Array.isArray(clouds.items) ? clouds.items : []) {
    if (cloudItems.length >= SUNSET_LIMITS.clouds || cloudRoom <= 0) break;
    if (!isPlainObject(cloud)) continue;
    const p = puffs(cloud.puffs, cloudRoom);
    if (p.length === 0) continue;
    cloudRoom -= p.length;
    cloudItems.push({
      puffs: p,
      base: finite(cloud.base, Math.min(...p.map((q) => q[1]))),
      shade: normalizeColor(cloud.shade, "#e8607e"),
      body: normalizeColor(cloud.body, "#ffcaa5"),
      crown: normalizeColor(cloud.crown, "#fff3e2"),
    });
  }

  let bankRoom: number = SUNSET_LIMITS.bankPuffs;
  const banks: Bank[] = [];
  for (const bank of Array.isArray(sea.banks) ? sea.banks : []) {
    if (banks.length >= SUNSET_LIMITS.banks || bankRoom <= 0) break;
    if (!isPlainObject(bank)) continue;
    const p = puffs(bank.puffs, bankRoom);
    if (p.length === 0) continue;
    bankRoom -= p.length;
    banks.push({
      y: finite(bank.y, Math.max(...p.map((q) => q[1]))),
      puffs: p,
      top: normalizeColor(bank.top, "#ffe0b5"),
      foot: normalizeColor(bank.foot, "#f7a080"),
      crest: normalizeColor(bank.crest, "#fff4dd"),
    });
  }

  // The dials inside these blocks are written separately; this fills in the structure round them.
  return {
    sky: skyColorAliases({
      ...fallback.sky,
      color: normalizeFill(sky.color ?? fallback.sky.color, fallback.sky.color),
      stops: skyStops(sky.stops, fallback.sky.stops),
    }),
    wisps: { ...fallback.wisps, items: wispItems },
    clouds: { ...fallback.clouds, items: cloudItems },
    sea: { ...fallback.sea, banks },
  };
}

const sunset: ContentsModel<SunsetContents> = {
  type: "sunset",
  label: "Sunset",
  shader: "sunset",
  dials: [
    // The sky stops come first: each is an offset and a colour, four channels, so the six of them
    // fill the first six vec4 slots of the contents' dials exactly and the shader loops over them.
    ...Array.from({ length: SKY_STOPS }, (_, i) => [
      {
        ...num(`contents.sky.stops.${i}.0`, "Sky", `Stop ${i + 1}`, 0, 1),
        whole: "contents.sky.stops",
      },
      {
        ...color(`contents.sky.stops.${i}.1`, "Sky", `Stop ${i + 1} colour`),
        whole: "contents.sky.stops",
      },
    ]).flat(),
    color("contents.sky.color", "Sky", "Colour"),
    num("contents.sky.horizon", "Sky", "Horizon", -1.5, 0.5),
    num("contents.sky.height", "Sky", "Height", 0.3, 4),
    num("contents.sun.x", "Sun", "X", -1, 1),
    num("contents.sun.y", "Sun", "Y", -1, 1),
    num("contents.sun.radius", "Sun", "Radius", 0, 0.4, 0.005),
    color("contents.sun.color", "Sun", "Colour"),
    num("contents.sun.glow", "Sun", "Glow", 0, 3),
    num("contents.sun.glowRadius", "Sun", "Glow radius", 0.05, 1.5),
    color("contents.sun.glowCore", "Sun", "Glow core"),
    color("contents.sun.glowMid", "Sun", "Glow middle"),
    color("contents.sun.glowEdge", "Sun", "Glow edge"),
    color("contents.wisps.color", "Clouds", "Wisp colour"),
    num("contents.wisps.opacity", "Clouds", "Wisp opacity", 0, 1),
    num("contents.clouds.drift", "Clouds", "Drift", -0.3, 0.3, 0.001),
    num("contents.clouds.billow", "Clouds", "Billow", 0, 1),
    num("contents.sea.drift", "Sea", "Drift", -0.3, 0.3, 0.001),
    num("contents.sea.swell", "Sea", "Swell", 0, 1),
    num("contents.react.glow", "React", "Sun glow", 0, 3),
    num("contents.react.billow", "React", "Billow", 0, 1),
  ],
  clocks: [["contents.clouds.drift"], ["contents.sea.drift"]],
  defaults: () => ({
    type: "sunset",
    sky: skyColorAliases({
      color: skyFill(SUNSET_SKY),
      stops: structuredClone(SUNSET_SKY),
      horizon: -0.5,
      height: 1.7,
    }),
    sun: {
      x: 0.18,
      y: -0.22,
      radius: 0.13,
      color: "#fff6dc",
      glow: 1,
      glowRadius: 0.7,
      glowCore: "#fff4cf",
      glowMid: "#ffc65c",
      glowEdge: "#ff5e1f",
    },
    wisps: { color: "#ffdc9e", opacity: 0.8, items: structuredClone(SUNSET_WISPS) },
    clouds: { drift: 0.012, billow: 0.2, items: structuredClone(SUNSET_CLOUDS) },
    sea: { drift: 0.008, swell: 0.25, banks: structuredClone(SUNSET_BANKS) },
    react: { glow: 0, billow: 0 },
  }),
  states: () => ({
    idle: {},
    // Attentive: the sun lifts to the crest and brightens.
    listening: {
      sun: { y: -0.15, radius: 0.142, glow: 1.3 },
      clouds: { drift: 0.03 },
      react: { glow: 0.7 },
    },
    // Busy: the weather turns over. Clouds churn, the sea swells and the sun dips behind it.
    thinking: {
      sun: { y: -0.3, glow: 0.75 },
      clouds: { drift: 0.09, billow: 0.85 },
      sea: { drift: 0.06, swell: 0.8 },
    },
    // Talking: the level drives the glow and the billow.
    speaking: {
      sun: { glow: 1.2 },
      clouds: { drift: 0.04, billow: 0.35 },
      sea: { swell: 0.4 },
      react: { glow: 0.9, billow: 0.6 },
    },
    // Off: the sun has set.
    muted: {
      sun: { y: -0.45, glow: 0.35 },
      clouds: { drift: 0.005 },
      sea: { drift: 0.003, swell: 0.1 },
    },
  }),
  structure: sunsetStructure,
};

const landscape: ContentsModel<LandscapeContents> = {
  type: "landscape",
  label: "Landscape",
  shader: "landscape",
  dials: [
    color("contents.sky.zenith", "Sky", "Overhead"),
    color("contents.sky.horizon", "Sky", "Horizon"),
    num("contents.sky.clouds", "Sky", "Clouds", 0, 1),
    color("contents.sky.cloudColor", "Sky", "Cloud colour"),
    num("contents.sun.azimuth", "Sun", "Bearing", -90, 90, 1),
    num("contents.sun.elevation", "Sun", "Height", -12, 60, 0.5),
    color("contents.sun.color", "Sun", "Colour"),
    num("contents.sun.glow", "Sun", "Glow", 0, 3),
    num("contents.land.height", "Land", "Hills", 0, 2),
    color("contents.land.grass", "Land", "Grass"),
    color("contents.land.rock", "Land", "Rock"),
    color("contents.land.snow", "Land", "Snow"),
    num("contents.land.snowline", "Land", "Snow line", 0, 1.5),
    color("contents.water.color", "Water", "Colour"),
    num("contents.water.waves", "Water", "Waves", 0, 1),
    num("contents.haze", "Air", "Haze", 0, 3),
    num("contents.speed", "Air", "Glide", -1, 3),
    num("contents.wind", "Air", "Wind", -1, 1),
    num("contents.altitude", "Air", "Altitude", 0.05, 1.5),
    num("contents.react.waves", "React", "Waves", 0, 2),
    num("contents.react.sun", "React", "Sun", 0, 2),
  ],
  clocks: [["contents.speed"], ["contents.wind"]],
  defaults: () => ({
    type: "landscape",
    sky: { zenith: "#3a78d0", horizon: "#f6d8b2", clouds: 0.4, cloudColor: "#f4ede6" },
    sun: { azimuth: -6, elevation: 8, color: "#ffd9a3", glow: 1 },
    land: {
      height: 1,
      grass: "#56703a",
      rock: "#6d6052",
      snow: "#f2efe9",
      snowline: 0.8,
    },
    water: { color: "#25505e", waves: 0.3 },
    haze: 1,
    speed: 0.25,
    wind: 0.15,
    altitude: 0.35,
    react: { waves: 0, sun: 0 },
  }),
  states: () => ({
    idle: {},
    // Attentive: the sun lifts and brightens, the clouds part.
    listening: { sun: { elevation: 10, glow: 1.4 }, sky: { clouds: 0.3 }, react: { sun: 0.6 } },
    // Busy: you speed up, and the weather comes in.
    thinking: { speed: 1.4, wind: 0.6, sky: { clouds: 0.75 }, water: { waves: 0.6 } },
    // Talking: the water dances with the level.
    speaking: { speed: 0.4, react: { waves: 1.2, sun: 0.5 } },
    // Off: dusk. The sun sets and you drift to a stop.
    muted: { speed: 0.04, wind: 0.05, sun: { elevation: -4, glow: 0.5 } },
  }),
  structure: () => ({}),
};

const celestial: ContentsModel<CelestialContents> = {
  type: "celestial",
  label: "Celestial",
  shader: "celestial",
  dials: [
    num("contents.elevation", "Sky", "Day / night elevation (°)", -90, 90, 0.5),
    color("contents.sky.day", "Sky", "Day"),
    color("contents.sky.night", "Sky", "Night"),
    color("contents.sky.twilight", "Sky", "Twilight"),
    num("contents.sun.radius", "Sun", "Radius", 0, 0.3, 0.005),
    num("contents.sun.glow", "Sun", "Glow", 0, 2),
    color("contents.sun.color", "Sun", "Colour"),
    num("contents.moon.x", "Moon", "X", -2, 2),
    num("contents.moon.y", "Moon", "Y", -2, 2),
    num("contents.moon.radius", "Moon", "Radius", 0.01, 0.3, 0.005),
    num("contents.moon.phase", "Moon", "Phase", 0, 1),
    num("contents.moon.amount", "Moon", "Brightness", 0, 1),
    color("contents.moon.color", "Moon", "Colour"),
    num("contents.stars.amount", "Stars", "Stars", 0, 1),
    color("contents.stars.color", "Stars", "Colour"),
  ],
  clocks: [],
  defaults: () => ({
    type: "celestial",
    elevation: 35,
    sky: { day: "#3d85cc", night: "#02040b", twilight: "#e67542" },
    sun: { radius: 0.075, glow: 0.12, color: "#fff4dc" },
    moon: { x: -0.45, y: 0.55, radius: 0.1, phase: 0.5, amount: 0.7, color: "#e0eaff" },
    stars: { amount: 0.65, color: "#e0eaff" },
  }),
  states: emptyStates,
  structure: () => ({}),
};

/** Every kind of contents, by type, in menu order. */
export const CONTENTS = {
  none: clear,
  gradient,
  image: media<ImageContents>("image", "Image"),
  video: media<VideoContents>("video", "Video"),
  shader: custom,
  sunset,
  landscape,
  celestial,
} as const satisfies { [K in ContentsType]: ContentsModel<Extract<OrbContents, { type: K }>> };

export const CONTENTS_TYPES = Object.keys(CONTENTS) as ContentsType[];

export function isContentsType(value: unknown): value is ContentsType {
  return typeof value === "string" && Object.hasOwn(CONTENTS, value);
}

/** The model for a kind of contents. */
export function contentsModel(type: ContentsType): ContentsModel {
  return CONTENTS[type] as unknown as ContentsModel;
}
