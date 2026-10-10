// Where everything the shader reads sits in its one uniform array.
//
// Every platform hands the shader the same flat array of vec4 slots: WebGL as a std140 buffer, Metal as a buffer, Skia as a `float4[]` uniform. So the layout is defined here, once
// for each kind of contents, and a platform's runtime only copies floats; it never needs to know
// what any of them mean.
import {
  CONTENTS,
  LIMITS,
  SUNSET_LIMITS,
  dialLayout,
  type ContentsShader,
  type ContentsType,
  type DialLayout,
} from "../config/model";
import { RAIN_DROPS, RAIN_TRAILS, RAIN_TRAIL_SLOTS } from "./rain";
import { SNOW_PARTICLES } from "./snow";

/**
 * Slot 0: width, height, level, pixels per unit. Slot 1: the glass's clocks (time, rain, the
 * room's turn, the fog's drift). Slot 2: the contents' four clocks. Slot 3: the picture or clip's width
 * and height in pixels, and whether it has loaded.
 */
const HEADER_SLOTS = 4;

/** The clocks: eight, two slots' worth. Clock 0 is time; each other integrates a rate. */
export const CLOCKS = 8;

/** The first of the contents' clocks. */
export const CONTENTS_CLOCK = 4;

/** Slots per sunset cloud: box (left, right, base, depth), span (first puff, puffs, top), 3
 *  colours. */
export const CLOUD_STRIDE = 5;
/** Slots per bank: (y, tallest puff, first puff, puffs), (period), top, foot and crest colours. */
export const BANK_STRIDE = 5;

/** The structure every orb has: the canvas, and the drops and beads on the glass; and, written
 *  each frame by the rain's simulation (rain.ts), the simulated water on the sphere, its timestamped curved trails. */
const GLASS_BLOCKS = {
  /** (size), (background rgb, alpha). */
  canvas: 2,
  /** (drops, beads). */
  counts: 1,
  drops: LIMITS.drops,
  /** Beads three floats each, four to three slots. */
  beads: (LIMITS.beads * 3) / 4,
  /** Two slots: own position/radius/signed shape/neck, then cached partner position/radius/source/shape. */
  pool: RAIN_DROPS * 2,
  trails: RAIN_TRAILS * RAIN_TRAIL_SLOTS,
  snow: SNOW_PARTICLES,
};

/** The structure each kind of contents adds after the glass's. */
const CONTENTS_BLOCKS: Record<ContentsShader, Record<string, number>> = {
  none: {},
  gradient: {},
  /** (contain). */
  media: { media: 1 },
  custom: {},
  sunset: {
    /** (wisps, clouds, banks). */
    scene: 1,
    clouds: SUNSET_LIMITS.clouds * CLOUD_STRIDE,
    /** Puffs three floats each (x, y, radius), four to three slots. */
    cloudPuffs: (SUNSET_LIMITS.cloudPuffs * 3) / 4,
    banks: SUNSET_LIMITS.banks * BANK_STRIDE,
    bankPuffs: (SUNSET_LIMITS.bankPuffs * 3) / 4,
    wisps: SUNSET_LIMITS.wisps,
  },
  landscape: {},
  celestial: {},
};

/** The caps a shader loops to, by name. */
export const SHADER_LIMITS: Readonly<Record<string, number>> = {
  ...LIMITS,
  ...SUNSET_LIMITS,
  pool: RAIN_DROPS,
  trails: RAIN_TRAILS,
  trailSlots: RAIN_TRAIL_SLOTS,
  snow: SNOW_PARTICLES,
};

export interface ProgramLayout {
  type: ContentsType;
  shader: ContentsShader;
  dials: DialLayout;
  /** The first dial slot, and the first of the contents' own. */
  dialSlot: number;
  contentsSlot: number;
  /** The structure, written once per config, after the dials. */
  staticSlot: number;
  /** Each structure block's first slot. */
  slot: Readonly<Record<string, number>>;
  /** The whole array. */
  slots: number;
}

/** WebGL2 and GLES 3.0 guarantee a 16 KiB uniform block: 1024 std140 vec4 slots. */
export const UNIFORM_PAGE = 1024;
export const MAX_SLOTS = 2048;

const cache = new Map<ContentsType, ProgramLayout>();

/** The uniform layout of an orb holding `type`. */
export function programLayout(type: ContentsType): ProgramLayout {
  let layout = cache.get(type);
  if (layout) return layout;
  const shader = CONTENTS[type].shader;
  const dials = dialLayout(type);
  const dialSlot = HEADER_SLOTS;
  const staticSlot = dialSlot + Math.ceil(dials.channels / 4);
  const slot: Record<string, number> = {};
  let at = staticSlot;
  for (const [name, size] of Object.entries({ ...GLASS_BLOCKS, ...CONTENTS_BLOCKS[shader] })) {
    slot[name] = at;
    at += size;
  }
  if (at > MAX_SLOTS) {
    throw new Error(`[orb3d] uniform layout for ${type} out of budget: ${at} slots`);
  }
  layout = {
    type,
    shader,
    dials,
    dialSlot,
    contentsSlot: dialSlot + dials.contentsOffset / 4,
    staticSlot,
    slot,
    slots: at,
  };
  cache.set(type, layout);
  return layout;
}
