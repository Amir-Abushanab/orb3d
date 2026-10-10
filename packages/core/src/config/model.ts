import {
  outdoorDefaults,
  OUTDOOR_DIALS,
  type OutdoorWeather,
  type OutdoorOverride,
} from "./weather";
export type { OutdoorWeather, OutdoorOverride } from "./weather";
import { SUNSET_SKY } from "./sunset";
import { normalizeFill, sampleFill, skyFill, skyColorAliases, type ColorValue } from "./fill";
export {
  gradientColor,
  normalizeFill,
  sampleFill,
  skyFill,
  skyColorAliases,
  fillHex,
} from "./fill";
export type { ColorValue, GradientColor, ColorStop, MeshPoint, GradientType } from "./fill";
export { COLOR_POINTS } from "./fill";
// The config model: one plain JSON object drives the renderer, the studio panel and every export.
// Framework-free and engine-free, so the shell, the studio and tests can all import it without
// pulling in WebGL.
//
// An orb is a ball of glass with something inside it. The GLASS is the same whatever it holds: how
// hard it bends and fringes what is inside, its tint and frosting, what it mirrors of the room round
// it, its highlight, rim and edge, the rain on it, its halo and shadow. The CONTENTS are one of a few
// kinds (see contents.ts): nothing at all, a gradient, a picture or a clip, a shader of your own, or
// a scene.
//
// Two kinds of value live in a config. STRUCTURE is the layout: which contents, which picture,
// which drops on the glass. DIALS are the numbers and colours a state can move: how frosted the
// glass is, how fast the room turns, whether the rain runs. A state is a named set of dial
// overrides, and the orb springs between states channel by channel, so a state can never change the
// layout, only how it looks and moves.
import { normalizeColor } from "../util/color";
import {
  CONTENTS,
  contentsModel,
  skyStops,
  isContentsType,
  type ContentsOverride,
  type ContentsType,
  type OrbContents,
} from "./contents";
import {
  channels,
  canonicalDialKey,
  clamp,
  clearDialValue,
  color,
  finite,
  getDialValue,
  isPlainObject,
  num,
  setDialValue,
  tuple,
  toggle,
  type Dial,
} from "./dials";
import { SUNSET_BEADS, SUNSET_DROPS } from "./sunset";
import type { Bead, Drop } from "./types";

export type { Bank, Bead, Cloud, Drop, Puff, Wisp } from "./types";
export * from "./contents";
export type { Dial, DialGroup } from "./dials";
export { getDialValue } from "./dials";

export interface GlassConfig {
  /** How far the glass bends what is inside: 0 is flat, 0.9 close to a full hemisphere. */
  bend: number;
  /** The index of refraction: how hard the glass bends the room seen through it (with nothing
   *  inside, upside down, as a real ball does) and how much it mirrors at the rim. */
  ior: number;
  /** Colour fringing: red and blue bent a little apart, most toward the rim. */
  dispersion: number;
  /** Frosting: everything seen through the glass blurs, and the glass takes a fine grain. */
  frost: number;
  /** The glass's own colour; white is clear. The middle, where the glass is thickest, takes most. */
  tint: ColorValue;
  /** How much of what is inside shows: below 1, the page behind shows through. */
  opacity: number;
  /** How much of the room the glass mirrors, its light included, strongest at the rim. */
  reflection: number;
  /** A painted highlight where the light is, as in an illustration. */
  highlight: number;
  /** A small sharp glint beside the highlight. */
  glint: number;
  /** Darkening toward the edge of the glass, 0 to 1. */
  edge: number;
  edgeColor: ColorValue;
  /** The bright ring at the rim. */
  rim: number;
  /** Light bounced up along the bottom of the glass. */
  bounce: number;
  bounceColor: ColorValue;
  /** The fine line round the glass that keeps the orb's shape on a white page. */
  outline: number;
  outlineColor: ColorValue;
}

/** The light the glass catches. */
export interface LightConfig {
  /** Source position in orb-radius units, y up. Values beyond 1 place it outside the glass. */
  x: number;
  y: number;
  /** Offset to the incoming light's elevation, in degrees. Zero follows its source position. */
  elevation: number;
  color: ColorValue;
  /** The highlight's size. */
  size: number;
}

/** The room round the orb: what the glass mirrors and, with nothing inside, what shows through. */
export interface EnvironmentConfig {
  /** Above the horizon, at it, and below it. */
  sky: ColorValue;
  horizon: ColorValue;
  ground: ColorValue;
  /** Degrees a second the room turns round the orb. */
  spin: number;
}

export interface RainConfig {
  enabled?: boolean;
  /** Input-level contribution to the runoff speed. */
  react?: number;
  /** The share of `drops` on the glass, 0 to 1, the first ones first. */
  amount: number;
  /** The share of `beads` on the glass, 0 to 1. */
  mist: number;
  /** A downpour added to the authored drops: 0 is none, 1 is heavy rain. New drops share the
   *  simulated water pool; spawn controls where they arrive. */
  density: number;
  /** How fast the running drops go, 0 for still. They stick and slip, so it is their pace on
   *  average. */
  run: number;
  /** New arrivals: 0 scatters them across the glass; 1 concentrates them at the incoming edge. */
  spawn: number;
  /** Incoming drop size: small for drizzle, larger for heavy rain. */
  size?: number;
  /** Gravity angle on the glass: 0 down, 90 right, -90 left, and ±180 up. */
  direction: number;
  /** Wind-driven incoming rain: 0 vertical, positive slants right, negative slants left. */
  angle: number;
  /** How wide a patch of what is inside each drop gathers, upside down. */
  lens: number;
  /** The dark of a drop's rim and the shadow it casts on the glass. */
  shade: ColorValue;
  drops: Drop[];
  beads: Bead[];
}

/** Snow crystals, their surface deposits and meltwater. */
export interface SnowConfig {
  enabled: boolean;
  react: number;
  amount: number;
  density: number;
  /** 0 at the incoming edge, 1 scattered over the glass. */
  dispersion: number;
  /** Incoming wind angle, positive to the right. Gravity remains independent. */
  angle: number;
  fall: number;
  size: number;
  stick: number;
  /** Heat driving ice into water; zero keeps snow frozen. */
  melt: number;
  color: ColorValue;
}

/** Fog on the glass: condensation developing over fixed patches, thickest toward the rim. It blurs what is
 *  behind it, and running drops wipe paths through it. */
export interface FogConfig {
  enabled: boolean;
  react: number;
  /** How much of the glass it covers, 0 to 1. */
  amount: number;
  color: ColorValue;
  /** How fast local condensation coverage develops; negative runs that cycle backward. */
  drift: number;
}

/** Sunshine on the glass, from where the light is: a glare, rays, sparkles and flare. */
export interface SunnyConfig {
  enabled: boolean;
  react: number;
  /** How strongly it shines, 0 to 1. */
  amount: number;
  color: ColorValue;
  /** The rays fanning from the light, 0 to 1. */
  rays: number;
  /** Glints that follow the light and the glass/water surface, 0 to 1. */
  sparkle: number;
  /** Ghosts of the light strung across the glass, as a lens flares, 0 to 1. */
  flare: number;
}

/** Shared surface physics followed by individually switchable weather patterns. */
export interface WeatherConfig extends OutdoorWeather {
  /** Surface gravity in degrees: 0 down, 90 right, -90 left, ±180 up. */
  gravity: number;
  /** Common incoming wind angle; rain and snow can add their own angle offsets. */
  wind: number;
  water: { lens: number; shade: ColorValue };
  rain: Omit<RainConfig, "direction" | "lens" | "shade"> & {
    enabled: boolean;
    react: number;
    size: number;
  };
  snow: SnowConfig;
  fog: FogConfig;
  sunny: SunnyConfig;
}
export interface WeatherOverride extends Omit<OutdoorOverride, "view"> {
  gravity?: number;
  wind?: number;
  water?: Partial<WeatherConfig["water"]>;
  rain?: Partial<Omit<WeatherConfig["rain"], "drops" | "beads">>;
  snow?: Partial<SnowConfig>;
  fog?: Partial<FogConfig>;
  sunny?: Partial<SunnyConfig>;
}
export type WeatherInput = Omit<WeatherOverride, "rain"> & {
  view?: OutdoorWeather["view"];
  /** Legacy scene settings migrate to contents.type=celestial when enabled. */
  celestial?: {
    enabled?: boolean;
    elevation?: number;
    moonX?: number;
    moonY?: number;
    moonPhase?: number;
    moon?: number;
    stars?: number;
    color?: ColorValue;
  };
  rain?: Partial<WeatherConfig["rain"]>;
};

export interface HaloConfig {
  /** A soft glow outside the orb, 0 to 1. Needs `size` below 1 to have room to show. */
  amount: number;
  color: ColorValue;
  /** How far the halo reaches, as a share of the orb's radius. */
  radius: number;
}

export interface ShadowConfig {
  /** A soft shadow under the orb, 0 to 1. Needs `size` below 1 to have room to show. */
  amount: number;
  color: ColorValue;
  /** Light the glass gathers into the middle of its shadow. */
  caustic: number;
}

export interface PostConfig {
  saturation: number;
  exposure: number;
}

/** How strongly the input level (see `setLevel`) adds to a dial. Zero ignores the level. The
 *  contents have their own (`contents.react`, `contents.pulse`). */
export interface ReactConfig {
  /** Brightens the whole orb. */
  exposure: number;
  halo: number;
  rain: number;
  snow: number;
  /** Breathes fog onto the glass. */
  fog: number;
  /** Lets the sun out. */
  sunny: number;
  wobble: number;
}

export interface LevelConfig {
  /** Seconds the level takes to rise toward a louder input. */
  attack: number;
  /** Seconds the level takes to fall back. */
  release: number;
}

export interface TransitionConfig {
  /** Seconds a change of state takes to settle, unless the state says otherwise. */
  duration: number;
}

/** A state: overrides for the dials only, each block merged over the base config. */
export interface OrbStateOverride {
  weather?: WeatherOverride;
  /** Seconds to settle INTO this state; overrides `transition.duration`. */
  duration?: number;
  speed?: number;
  wobble?: number;
  contents?: ContentsOverride;
  glass?: Partial<GlassConfig>;
  light?: Partial<LightConfig>;
  environment?: Partial<EnvironmentConfig>;
  rain?: Partial<
    Pick<
      RainConfig,
      | "enabled"
      | "react"
      | "amount"
      | "mist"
      | "density"
      | "run"
      | "spawn"
      | "direction"
      | "angle"
      | "lens"
      | "shade"
    >
  >;
  snow?: Partial<SnowConfig>;
  fog?: Partial<FogConfig>;
  sunny?: Partial<SunnyConfig>;
  halo?: Partial<HaloConfig>;
  shadow?: Partial<ShadowConfig>;
  post?: Partial<PostConfig>;
  react?: Partial<ReactConfig>;
}

export interface OrbConfig {
  /** What is inside the glass. Structure: a state can move its dials but not change its kind. */
  contents: OrbContents;
  /** The orb's diameter as a share of the container's shorter side. */
  size: number;
  /** `"transparent"` composites over the page; a colour fills the canvas behind the orb. */
  background: string;
  /** Scales every motion at once. */
  speed: number;
  /** How much the orb breathes, as a share of its radius. */
  wobble: number;
  glass: GlassConfig;
  light: LightConfig;
  environment: EnvironmentConfig;
  weather: WeatherConfig;
  /** @deprecated Use weather.rain and weather's shared fields. Not serialized. */
  rain: RainConfig;
  /** @deprecated Use weather.snow. Not serialized. */
  snow: SnowConfig;
  /** @deprecated Use weather.fog. Not serialized. */
  fog: FogConfig;
  /** @deprecated Use weather.sunny. Not serialized. */
  sunny: SunnyConfig;
  halo: HaloConfig;
  shadow: ShadowConfig;
  post: PostConfig;
  react: ReactConfig;
  /** The state the orb opens in. */
  state: string;
  states: Record<string, OrbStateOverride>;
  transition: TransitionConfig;
  level: LevelConfig;
  /** Device-pixel-ratio cap. */
  dprMax: number;
  /** Render scale, 0.25 to 1, applied on top of the DPR. */
  quality: number;
  paused: boolean;
}

export type OrbConfigInput = Omit<Partial<OrbConfig>, "weather"> & { weather?: WeatherInput };

/**
 * Hard caps on the glass's structure, because every array lands in a fixed-size uniform array.
 * Authored layouts share the portable 16 KiB uniform block with the simulated water and
 * timestamped trails.
 */
export const LIMITS = {
  /** Authored drops; incoming rain and shed beads live in the simulated pool. */
  drops: 16,
  beads: 32,
} as const;

/** The glass's dials, the same whatever is inside, in panel order. */
export const GLASS_DIALS: readonly Dial[] = [
  num("speed", "Motion", "Speed", 0, 4),
  num("wobble", "Motion", "Wobble", 0, 0.1, 0.001),
  num("glass.bend", "Glass", "Bend", 0, 0.9),
  num("glass.ior", "Glass", "Refraction", 1, 2.4),
  num("glass.dispersion", "Glass", "Dispersion", 0, 1),
  num("glass.frost", "Glass", "Frost", 0, 1),
  color("glass.tint", "Glass", "Tint"),
  num("glass.opacity", "Glass", "Opacity", 0, 1),
  num("glass.reflection", "Light", "Reflection", 0, 1),
  num("glass.highlight", "Light", "Highlight", 0, 2),
  num("glass.glint", "Light", "Glint", 0, 2),
  num("light.x", "Light", "X", -3, 3),
  num("light.y", "Light", "Y", -3, 3),
  color("light.color", "Light", "Colour"),
  num("light.size", "Light", "Size", 0.2, 3),
  num("glass.edge", "Edge", "Edge", 0, 1),
  color("glass.edgeColor", "Edge", "Edge colour"),
  num("glass.rim", "Edge", "Rim", 0, 2),
  num("glass.bounce", "Edge", "Bounce", 0, 1),
  color("glass.bounceColor", "Edge", "Bounce colour"),
  num("glass.outline", "Edge", "Outline", 0, 1),
  color("glass.outlineColor", "Edge", "Outline colour"),
  color("environment.sky", "Room", "Sky"),
  color("environment.horizon", "Room", "Horizon"),
  color("environment.ground", "Room", "Ground"),
  num("environment.spin", "Room", "Spin", -180, 180, 1),
  num("weather.rain.amount", "Rain", "Seeded drops", 0, 1),
  num("weather.rain.mist", "Rain", "Mist", 0, 1),
  num("weather.rain.density", "Rain", "Rain", 0, 1),
  num("weather.rain.run", "Rain", "Runoff speed", 0, 3),
  {
    ...num("weather.rain.spawn", "Rain", "Spawn distribution", 0, 1),
    hint: "0: scattered across the glass · 1: concentrated at the incoming edge",
  },
  {
    ...num("weather.gravity", "Weather", "Glass tilt (°)", -180, 180, 1),
    hint: "Surface gravity: 0° down · 90° right · −90° left · ±180° up",
  },
  num("weather.water.lens", "Weather", "Lens", 0, 1),
  color("weather.water.shade", "Weather", "Shade"),
  num("weather.fog.amount", "Fog", "Fog", 0, 1),
  color("weather.fog.color", "Fog", "Colour"),
  num("weather.fog.drift", "Fog", "Drift", -1, 1),
  num("weather.sunny.amount", "Sunny", "Sun", 0, 1),
  color("weather.sunny.color", "Sunny", "Colour"),
  num("weather.sunny.rays", "Sunny", "Rays", 0, 1),
  num("weather.sunny.sparkle", "Sunny", "Sparkle", 0, 1),
  num("weather.sunny.flare", "Sunny", "Flare", 0, 1),
  num("halo.amount", "Halo", "Amount", 0, 1),
  color("halo.color", "Halo", "Colour"),
  num("halo.radius", "Halo", "Radius", 0.02, 1),
  num("shadow.amount", "Shadow", "Amount", 0, 1),
  color("shadow.color", "Shadow", "Colour"),
  num("shadow.caustic", "Shadow", "Caustic", 0, 1),
  num("post.saturation", "Post", "Saturation", 0, 2),
  num("post.exposure", "Post", "Exposure", 0, 2),
  num("react.exposure", "React", "Exposure", 0, 1),
  num("react.halo", "React", "Halo", 0, 1),
  num("weather.rain.react", "Rain", "Input response", 0, 3),
  num("weather.fog.react", "Fog", "Input response", 0, 1),
  num("weather.sunny.react", "Sunny", "Input response", 0, 1),
  num("react.wobble", "React", "Wobble", 0, 0.1, 0.001),
  // Consume a reserved channel so format 7's existing dial offsets and slots stay unchanged.
  {
    ...num("weather.rain.angle", "Rain", "Angle offset (°)", -80, 80, 1),
    hint: "Added to shared wind: 0° no offset · positive slants right · negative slants left",
  },
  // The final reserved format-7 channel: existing contents offsets and slots still align.
  {
    ...num("light.elevation", "Sunny", "Elevation offset (°)", -90, 90, 1),
    hint: "Incoming light angle: 0° follows position · positive turns toward the viewer · negative turns away",
  },
  num("weather.snow.amount", "Snow", "Snow", 0, 1),
  num("weather.snow.density", "Snow", "Snowfall", 0, 1),
  {
    ...num("weather.snow.dispersion", "Snow", "Landing spread", 0, 1),
    hint: "0: incoming edge · 1: scattered over the glass",
  },
  {
    ...num("weather.snow.angle", "Snow", "Angle offset (°)", -80, 80, 1),
    hint: "Added to shared wind: 0° no offset · positive slants right · negative slants left",
  },
  num("weather.snow.fall", "Snow", "Fall speed", 0, 3),
  num("weather.snow.size", "Snow", "Flake size", 0.3, 2),
  num("weather.snow.stick", "Snow", "Adhesion", 0, 1),
  {
    ...num("weather.snow.melt", "Snow", "Melt", 0, 1),
    hint: "Heat at the glass: 0 keeps snow frozen · melting continues when fall speed is zero",
  },
  color("weather.snow.color", "Snow", "Colour"),
  num("weather.snow.react", "Snow", "Input response", 0, 1),
  num("weather.wind", "Weather", "Wind angle (°)", -80, 80, 1),
  num("weather.rain.size", "Rain", "Incoming drop size", 0.15, 2),
  toggle("weather.rain.enabled", "Rain", "Enabled"),
  toggle("weather.snow.enabled", "Snow", "Enabled"),
  toggle("weather.fog.enabled", "Fog", "Enabled"),
  toggle("weather.sunny.enabled", "Sunny", "Enabled"),
  ...OUTDOOR_DIALS,
];

/** Where each dial sits in a packed dial vector, for one kind of contents. */
export interface DialLayout {
  dials: readonly Dial[];
  /** Each dial's first channel; a colour takes three. */
  offset: Readonly<Record<string, number>>;
  /** The contents' first channel: a slot boundary, so the shader can loop over aligned dials. */
  contentsOffset: number;
  /** The length of a packed dial vector. */
  channels: number;
}

const layouts = new Map<ContentsType, DialLayout>();

/** The dials an orb holding `type` has (the glass's, then the contents'), and where each sits. */
export function dialLayout(type: ContentsType): DialLayout {
  let layout = layouts.get(type);
  if (!layout) {
    const contents = CONTENTS[type].dials;
    const offset: Record<string, number> = {};
    let at = 0;
    for (const dial of GLASS_DIALS) {
      offset[dial.key] = at;
      at += channels(dial);
    }
    for (const old of [
      "rain.direction",
      "rain.lens",
      "rain.shade",
      ...["rain", "snow", "fog", "sunny"].flatMap((effect) => [
        "react." + effect,
        ...GLASS_DIALS.filter((d) => d.key.startsWith("weather." + effect + ".")).map((d) =>
          d.key.slice(8),
        ),
      ]),
    ]) {
      offset[old] = offset[canonicalDialKey(old)]!;
    }
    const contentsOffset = Math.ceil(at / 4) * 4;
    at = contentsOffset;
    for (const dial of contents) {
      offset[dial.key] = at;
      at += channels(dial);
    }
    layout = { dials: [...GLASS_DIALS, ...contents], offset, contentsOffset, channels: at };
    layouts.set(type, layout);
  }
  return layout;
}

/** The dials of an orb holding `type`, in panel order. */
export function dialsFor(type: ContentsType): readonly Dial[] {
  return dialLayout(type).dials;
}

/** The dial with this key in an orb holding `type`, if there is one. */
export function dialFor(type: ContentsType, key: string): Dial | undefined {
  return dialsFor(type).find((dial) => dial.key === canonicalDialKey(key));
}

/**
 * Write a dial's value into a config or a state override (`target`), keeping a whole array (see
 * `Dial.whole`) whole by copying it from `base` first.
 */
export function setDial(
  target: Record<string, unknown>,
  dial: Dial,
  value: unknown,
  base: OrbConfig,
): void {
  setDialValue(target, dial.key, value, base, dial.whole);
}

/** Hand a dial in a state override back to the base, pruning the blocks that leaves empty. */
export function clearDial(override: Record<string, unknown>, dial: Dial): void {
  clearDialValue(override, dial.key, dial.whole);
}

/** The glass on its own: clear, with the room round it mirrored at the rim and seen through it. */
function clearGlass(): Omit<OrbConfig, "contents" | "rain" | "snow" | "fog" | "sunny" | "react"> & {
  react: Omit<ReactConfig, "rain" | "snow" | "fog" | "sunny">;
} {
  return {
    size: 1,
    background: "transparent",
    speed: 1,
    wobble: 0,
    glass: {
      bend: 0.7,
      ior: 1.5,
      dispersion: 0.3,
      frost: 0,
      tint: "#ffffff",
      opacity: 1,
      reflection: 0.75,
      highlight: 0,
      glint: 0.8,
      edge: 0.3,
      edgeColor: "#1c2430",
      rim: 0.55,
      bounce: 0.45,
      bounceColor: "#ffffff",
      outline: 0.18,
      outlineColor: "#2b3340",
    },
    light: { x: -0.36, y: 0.5, elevation: 0, color: "#ffffff", size: 1 },
    environment: { sky: "#f5f7fb", horizon: "#c6ccd6", ground: "#4b525d", spin: 4 },
    weather: {
      ...outdoorDefaults(),
      gravity: 0,
      wind: 0,
      water: { lens: 0.36, shade: "#1a2230" },
      rain: {
        enabled: true,
        react: 0,
        amount: 0,
        mist: 0,
        density: 0,
        run: 0,
        spawn: 0,
        size: 1,
        angle: 0,
        drops: structuredClone(SUNSET_DROPS),
        beads: structuredClone(SUNSET_BEADS),
      },
      snow: {
        enabled: true,
        react: 0,
        amount: 0,
        density: 0.55,
        dispersion: 0.85,
        angle: 0,
        fall: 1,
        size: 1,
        stick: 0.9,
        melt: 0.25,
        color: "#f1f6ff",
      },
      fog: { enabled: true, react: 0, amount: 0, color: "#eef2f6", drift: 0.15 },
      sunny: {
        enabled: true,
        react: 0,
        amount: 0,
        color: "#ffe1a6",
        rays: 0.6,
        sparkle: 0.5,
        flare: 0.35,
      },
    },
    halo: { amount: 0, color: "#9fc4ff", radius: 0.3 },
    shadow: { amount: 0, color: "#1b2230", caustic: 0 },
    post: { saturation: 1, exposure: 1 },
    react: { exposure: 0, halo: 0, wobble: 0 },
    state: "idle",
    states: {
      idle: {},
      // Attentive: the glass catches more light.
      listening: {
        duration: 0.7,
        glass: { reflection: 0.9, rim: 0.8 },
        light: { y: 0.55 },
        post: { exposure: 1.04 },
        react: { wobble: 0.02 },
      },
      // Busy: the room turns round the orb, and the colours split at the rim.
      thinking: {
        duration: 0.9,
        environment: { spin: 70 },
        glass: { dispersion: 0.8 },
      },
      // Talking: the orb breathes and brightens with the level.
      speaking: {
        duration: 0.6,
        environment: { spin: 12 },
        react: { exposure: 0.3, wobble: 0.03 },
      },
      // Off: the glass frosts over and the colour drains out.
      muted: {
        duration: 1.4,
        environment: { spin: 0 },
        glass: { frost: 0.7, reflection: 0.45 },
        post: { saturation: 0.3, exposure: 0.92 },
      },
    },
    transition: { duration: 1.1 },
    level: { attack: 0.06, release: 0.3 },
    dprMax: 2,
    quality: 1,
    paused: false,
  };
}

/** A fresh orb: clear glass, nothing inside. */
export function createDefaultConfig(): OrbConfig {
  return weatherAliases({ contents: { type: "none" }, ...clearGlass() } as OrbConfig);
}

/**
 * The default glass holding `type`'s default contents, with the contents' own overrides for the
 * five standard states merged into the glass's.
 */
export function createContentsConfig(type: ContentsType): OrbConfig {
  const model = contentsModel(type);
  const config: OrbConfig = { ...createDefaultConfig(), contents: model.defaults() };
  config.states = withContentsStates(config.states, model.states());
  return weatherAliases(config);
}

/** Each state with its contents overrides replaced by `contents`' (dropped where it has none). */
export function withContentsStates(
  states: Record<string, OrbStateOverride>,
  contents: Record<string, ContentsOverride>,
): Record<string, OrbStateOverride> {
  const out: Record<string, OrbStateOverride> = {};
  for (const [name, state] of Object.entries(states)) {
    const { contents: _previous, ...rest } = state;
    const next = contents[name];
    out[name] = next && Object.keys(next).length > 0 ? { ...rest, contents: next } : rest;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Merging and validation
// ---------------------------------------------------------------------------------------------

/** Objects merge key by key, all the way down; arrays and values replace. */
function deepMerge<T extends object>(base: T, next: object): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    const prev = out[key];
    out[key] = isPlainObject(prev) && isPlainObject(value) ? deepMerge(prev, value) : value;
  }
  return out as T;
}

/** Migrate old weather blocks without mutating the input. Explicit legacy patches still work
 * when spread over a modern config; serialized output contains only the canonical weather tree. */
function migrateWeather(source: object): Record<string, unknown> {
  const out = { ...source } as Record<string, unknown>;
  const weather: Record<string, unknown> = isPlainObject(out.weather)
    ? deepMerge({}, out.weather)
    : {};
  let changed = isPlainObject(out.weather);
  if (isPlainObject(weather.celestial)) {
    const legacy = weather.celestial;
    const ownContents = isPlainObject(out.contents) ? out.contents : {};
    if (legacy.enabled !== false) {
      const moon = Object.fromEntries(
        [
          ["x", legacy.moonX],
          ["y", legacy.moonY],
          ["phase", legacy.moonPhase],
          ["amount", legacy.moon],
          ["color", legacy.color],
        ].filter(([, v]) => v !== undefined),
      );
      const stars = Object.fromEntries(
        [
          ["amount", legacy.stars],
          ["color", legacy.color],
        ].filter(([, v]) => v !== undefined),
      );
      out.contents = deepMerge(
        {
          ...(legacy.enabled === true ? { type: "celestial" } : {}),
          elevation: legacy.elevation,
          moon,
          stars,
        },
        ownContents.type === "celestial" ? ownContents : {},
      );
    }
    delete weather.celestial;
  }

  for (const name of ["rain", "snow", "fog", "sunny"] as const) {
    if (!Object.prototype.propertyIsEnumerable.call(source, name)) continue;
    const legacy = out[name];
    delete out[name];
    if (!isPlainObject(legacy)) continue;
    const leaf = { ...legacy };
    if (name === "rain") {
      if (leaf.direction !== undefined) weather.gravity = leaf.direction;
      const optics: Record<string, unknown> = {};
      if (leaf.lens !== undefined) optics.lens = leaf.lens;
      if (leaf.shade !== undefined) optics.shade = leaf.shade;
      if (Object.keys(optics).length)
        weather.water = deepMerge(isPlainObject(weather.water) ? weather.water : {}, optics);
      delete leaf.direction;
      delete leaf.lens;
      delete leaf.shade;
    }
    weather[name] = deepMerge(isPlainObject(weather[name]) ? weather[name] : {}, leaf);
    changed = true;
  }
  if (isPlainObject(out.react)) {
    const react = { ...out.react };
    for (const name of ["rain", "snow", "fog", "sunny"] as const) {
      if (react[name] === undefined) continue;
      weather[name] = deepMerge(isPlainObject(weather[name]) ? weather[name] : {}, {
        react: react[name],
      });
      delete react[name];
      changed = true;
    }
    out.react = react;
  }
  if (changed) out.weather = weather;
  if (
    isPlainObject(out.contents) &&
    isPlainObject(out.contents.sky) &&
    Object.prototype.propertyIsEnumerable.call(out.contents.sky, "stops")
  ) {
    const sky = { ...out.contents.sky };
    sky.color = skyFill(skyStops(sky.stops, SUNSET_SKY));
    delete sky.stops;
    out.contents = { ...out.contents, sky };
  }
  return out;
}

/** Non-enumerable compatibility accessors keep the former API working without duplicating JSON. */
function weatherAliases(config: OrbConfig): OrbConfig {
  if (config.contents?.type === "sunset") skyColorAliases(config.contents.sky);
  for (const name of ["rain", "snow", "fog", "sunny"] as const) {
    Object.defineProperty(config, name, {
      configurable: true,
      get: () => config.weather[name],
      set: (value: unknown) => {
        const patch = migrateWeather({ [name]: value });
        if (isPlainObject(patch.weather)) config.weather = deepMerge(config.weather, patch.weather);
        weatherAliases(config);
      },
    });
    Object.defineProperty(config.react, name, {
      configurable: true,
      get: () => config.weather[name].react,
      set: (value: number) => {
        config.weather[name].react = value;
      },
    });
  }
  for (const [key, shared] of [
    ["direction", "gravity"],
    ["lens", "lens"],
    ["shade", "shade"],
  ] as const) {
    Object.defineProperty(config.weather.rain, key, {
      configurable: true,
      get: () => (shared === "gravity" ? config.weather.gravity : config.weather.water[shared]),
      set: (value: never) => {
        if (shared === "gravity") config.weather.gravity = value;
        else config.weather.water[shared] = value;
      },
    });
  }
  return config;
}

/**
 * Merge a partial config over another: blocks merge key by key all the way down, so
 * `{ glass: { rim: 2 } }` keeps the rest of the glass, while arrays (`rain.drops`,
 * `contents.colors`) replace wholesale. Contents of a different `type` replace the old contents
 * outright. `states` merges by name, and each named state REPLACES the one it names, so a state
 * means exactly what it says wherever it is read; a state set to `null` is removed. To change part
 * of a state instead, see {@link mergeStates}.
 */
export function mergeOrbConfig(
  base: OrbConfigInput,
  next: OrbConfigInput | Record<string, unknown>,
): OrbConfigInput {
  const { states, contents, ...rest } = migrateWeather(next) as Partial<OrbConfig>;
  const migrated = migrateWeather(base) as Partial<OrbConfig>;
  const out = deepMerge(migrated, rest);
  const change: unknown = contents;
  if (isPlainObject(change)) {
    const same = change.type === undefined || change.type === migrated.contents?.type;
    const merged =
      same && isPlainObject(migrated.contents) ? deepMerge(migrated.contents, change) : change;
    out.contents = merged as unknown as OrbContents;
  }
  if (isPlainObject(states)) {
    const merged: Record<string, OrbStateOverride> = { ...migrated.states };
    for (const [name, override] of Object.entries(states)) {
      if (override === null) delete merged[name];
      else if (isPlainObject(override)) merged[name] = override;
    }
    out.states = merged;
  }
  // Partial results also expose compatibility reads, when they contain a complete weather tree.
  if (out.weather?.rain && out.weather.snow && out.weather.fog && out.weather.sunny && out.react)
    weatherAliases(out as OrbConfig);
  return out;
}

/**
 * Change part of some states: each named state is merged over the existing one, all the way down,
 * so `{ thinking: { glass: { frost: 1 } } }` keeps the rest of thinking, and of its glass.
 */
export function mergeStates(
  states: Record<string, OrbStateOverride>,
  changes: Record<string, OrbStateOverride>,
): Record<string, OrbStateOverride> {
  const out = { ...states };
  for (const [name, change] of Object.entries(changes)) {
    out[name] = deepMerge(out[name] ?? {}, change);
  }
  return out;
}

/** Clamp and normalise every dial present in `source` into `out`. Absent dials stay absent. */
function sanitizeDials(
  dials: readonly Dial[],
  source: unknown,
  out: Record<string, unknown>,
  base: OrbConfig,
): void {
  for (const dial of dials) {
    if (dial.whole) continue; // a whole array is the contents' structure to check
    const value = getDialValue(source, dial.key);
    if (value === undefined) continue;
    const fallback = getDialValue(base, dial.key);
    const clean =
      dial.kind === "boolean"
        ? typeof value === "boolean"
          ? value
          : fallback
        : dial.kind === "color"
          ? normalizeFill(value, fallback as ColorValue)
          : clamp(finite(value, fallback as number), dial.min!, dial.max!);
    setDialValue(out, dial.key, clean);
  }
}

/** A whole array in a state override (see `Dial.whole`), checked as its contents check it. */
function wholeArray(path: string, value: unknown, base: OrbConfig): unknown {
  const inner = path.split(".").slice(1);
  const source: Record<string, unknown> = {};
  let at = source;
  for (const part of inner.slice(0, -1)) at = (at[part] = {}) as Record<string, unknown>;
  at[inner.at(-1)!] = value;
  const checked = contentsModel(base.contents.type).structure(source, base.contents);
  return getDialValue(checked, inner.join(".")) ?? getDialValue(base, path);
}

function sanitizeOverride(source: unknown, base: OrbConfig): OrbStateOverride {
  if (!isPlainObject(source)) return {};
  const migrated = migrateWeather(source);
  source = migrated;
  const dials = dialsFor(base.contents.type);
  const out: Record<string, unknown> = {};
  sanitizeDials(dials, source, out, base);
  for (const path of new Set(dials.flatMap((dial) => (dial.whole ? [dial.whole] : [])))) {
    const value = getDialValue(source, path);
    if (value !== undefined) setDialValue(out, path, wholeArray(path, value, base));
  }
  if (migrated.duration !== undefined) out.duration = clamp(finite(migrated.duration, 1), 0.05, 10);
  return out as OrbStateOverride;
}

function sanitizeDrops(value: unknown): Drop[] {
  const out: Drop[] = [];
  for (const drop of Array.isArray(value) ? value : []) {
    if (out.length >= LIMITS.drops) break;
    const t = tuple(drop, 3);
    if (!t || t[2]! <= 0) continue;
    const runs: unknown = (drop as unknown[])[3];
    out.push([t[0]!, t[1]!, t[2]!, runs === 1 || runs === true ? 1 : 0]);
  }
  return out;
}

function sanitizeBeads(value: unknown): Bead[] {
  const out: Bead[] = [];
  for (const bead of Array.isArray(value) ? value : []) {
    if (out.length >= LIMITS.beads) break;
    const t = tuple(bead, 3);
    if (t && t[2]! > 0) out.push([t[0]!, t[1]!, t[2]!]);
  }
  return out;
}

/**
 * Fill a partial config out to a complete, valid one: missing values come from the default glass
 * and the defaults of the contents it holds (merged as {@link mergeOrbConfig} merges), numbers are
 * clamped to their dial's range, colours normalised to `#rrggbb`, structure arrays capped to their
 * limits, and `state` made to name a state that exists. A config's `states` are exactly the ones it
 * lists; only a config that lists none gets the default five. Never throws; anything unusable falls
 * back to the default.
 */
export function ensureOrbConfig(partial: OrbConfigInput = {}): OrbConfig {
  const source = migrateWeather(isPlainObject(partial) ? partial : {}) as Partial<OrbConfig>;
  const contentsSource: Record<string, unknown> = isPlainObject(source.contents)
    ? source.contents
    : {};
  const type: ContentsType = isContentsType(contentsSource.type) ? contentsSource.type : "none";
  const model = contentsModel(type);
  const defaults: OrbConfig = { ...createDefaultConfig(), contents: model.defaults() };
  const merged = mergeOrbConfig(defaults, {
    ...source,
    contents: { ...contentsSource, type },
  }) as OrbConfig;
  if (isPlainObject(source.states)) {
    merged.states = Object.fromEntries(
      Object.entries(source.states).filter(([, override]) => override !== null),
    );
  }

  const out: OrbConfig = { ...createDefaultConfig(), contents: model.defaults() };
  out.weather.view = ["orb", "sky", "overlay"].includes(merged.weather.view)
    ? merged.weather.view
    : "orb";
  // The contents' structure first, then every dial over it, clamped against the defaults.
  Object.assign(
    out.contents,
    model.structure(merged.contents as unknown as Record<string, unknown>, defaults.contents),
  );
  sanitizeDials(dialsFor(type), merged, out as unknown as Record<string, unknown>, defaults);

  out.size = clamp(finite(merged.size, 1), 0.1, 1);
  out.background =
    merged.background === "transparent"
      ? "transparent"
      : normalizeColor(merged.background, "transparent");
  out.dprMax = clamp(finite(merged.dprMax, 2), 0.5, 4);
  out.quality = clamp(finite(merged.quality, 1), 0.25, 1);
  out.paused = merged.paused === true;
  out.transition = { duration: clamp(finite(merged.transition?.duration, 1.1), 0.05, 10) };
  out.level = {
    attack: clamp(finite(merged.level?.attack, 0.06), 0.005, 5),
    release: clamp(finite(merged.level?.release, 0.3), 0.005, 5),
  };
  out.weather.rain.drops = sanitizeDrops(merged.weather?.rain?.drops);
  out.weather.rain.beads = sanitizeBeads(merged.weather?.rain?.beads);

  // States: each override sanitised, and the opening state made to exist.
  out.states = {};
  for (const [name, override] of Object.entries(
    isPlainObject(merged.states) ? merged.states : {},
  )) {
    if (name) out.states[name] = sanitizeOverride(override, out);
  }
  if (Object.keys(out.states).length === 0) out.states.idle = {};
  out.state = resolveStateName(out, merged.state);
  return weatherAliases(out);
}

/** The state names in authored order. */
export function stateNames(config: Pick<OrbConfig, "states">): string[] {
  return Object.keys(config.states);
}

/** `name` if the config has that state, otherwise its opening state, otherwise its first. */
export function resolveStateName(config: Pick<OrbConfig, "states">, name: unknown): string {
  const names = stateNames(config);
  if (typeof name === "string" && names.includes(name)) return name;
  return names.includes("idle") ? "idle" : (names[0] ?? "idle");
}

/** Seconds a move into `name` takes to settle. */
export function stateDuration(config: OrbConfig, name: string): number {
  return config.states[name]?.duration ?? config.transition.duration;
}

/**
 * Pack the dials a state resolves to (its overrides over the base config) into `out`, colours as
 * three 0–1 channels, in the layout {@link dialLayout} gives the config's contents. The renderer
 * springs its live dials toward this vector.
 */
export function writeStateDials(config: OrbConfig, name: string, out?: Float32Array): Float32Array {
  const layout = dialLayout(config.contents.type);
  const vector = out ?? new Float32Array(layout.channels);
  const override = config.states[name] ?? {};
  for (const dial of layout.dials) {
    const value = getDialValue(override, dial.key) ?? getDialValue(config, dial.key);
    const at = layout.offset[dial.key]!;
    if (dial.kind === "color") {
      const rgb = sampleFill(value as ColorValue);
      vector[at] = rgb[0];
      vector[at + 1] = rgb[1];
      vector[at + 2] = rgb[2];
    } else {
      vector[at] = Number(value);
    }
  }
  return vector;
}
