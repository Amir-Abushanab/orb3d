// Built-in looks. Each is a function returning a complete config, so an unused preset tree-shakes
// out. The default, clear, is the glass on its own. Aura holds a gradient, the familiar agent orb;
// landscape a 3D scene; sunset is the Plovent mark, and dawn, storm and night repaint its layout.
// Every one keeps the same five states: idle, listening, thinking, speaking and muted.
import {
  CONTENTS,
  createContentsConfig,
  createDefaultConfig,
  ensureOrbConfig,
  mergeStates,
  type OrbConfig,
  type SunsetContents,
} from "./config/model";
import { SUNSET_BEADS, SUNSET_DROPS } from "./config/sunset";

type Triple = [string, string, string];

/** Clear glass, nothing inside: the room round it mirrored at the rim and seen through it. */
function clear(): OrbConfig {
  return createDefaultConfig();
}

/** Colour swirling in a ball of glass: blue, cyan, violet and pink in deep indigo. */
function aura(): OrbConfig {
  const base = createContentsConfig("gradient");
  return ensureOrbConfig({
    ...base,
    glass: {
      ...base.glass,
      dispersion: 0.15,
      reflection: 0.45,
      highlight: 0.5,
      glint: 0.9,
      edge: 0.4,
      edgeColor: "#060a26",
      rim: 0.7,
      bounce: 0.5,
      bounceColor: "#9fe8ff",
      outline: 0.2,
      outlineColor: "#0c1240",
    },
    environment: { ...base.environment, sky: "#e9eeff", horizon: "#9aa3c8", ground: "#1b1f3a" },
    halo: { ...base.halo, color: "#6f8bff" },
  });
}

/** Hills round a lake at golden hour, in 3D; you glide down the water toward the sun. */
function landscape(): OrbConfig {
  const base = createContentsConfig("landscape");
  return ensureOrbConfig({
    ...base,
    glass: {
      ...base.glass,
      dispersion: 0.1,
      reflection: 0.35,
      highlight: 0.45,
      glint: 0.9,
      edge: 0.42,
      edgeColor: "#0d1522",
      rim: 0.8,
      bounce: 0.45,
      bounceColor: "#ffe2bd",
      outline: 0.22,
      outlineColor: "#1a2433",
    },
    environment: { ...base.environment, sky: "#f6efe6", horizon: "#c9b9a6", ground: "#2f3a2c" },
    halo: { ...base.halo, color: "#ffcf96" },
  });
}

/** The Plovent mark: a sunset over a sea of cloud, rain beaded on the glass. */
function sunset(): OrbConfig {
  return ensureOrbConfig({
    ...createDefaultConfig(),
    contents: CONTENTS.sunset.defaults(),
    glass: {
      bend: 0.7,
      ior: 1.45,
      dispersion: 0,
      frost: 0,
      tint: "#ffffff",
      opacity: 1,
      reflection: 0,
      highlight: 1,
      glint: 1,
      edge: 0.45,
      edgeColor: "#1a0410",
      rim: 1,
      bounce: 0.55,
      bounceColor: "#ffd2a8",
      outline: 0.28,
      outlineColor: "#3a0a1e",
    },
    environment: { sky: "#ffe9cf", horizon: "#f29a6b", ground: "#3a0a1e", spin: 0 },
    rain: {
      amount: 1,
      mist: 1,
      density: 0,
      run: 0,
      spawn: 0,
      direction: 0,
      angle: 0,
      lens: 0.36,
      shade: "#2a0618",
      drops: structuredClone(SUNSET_DROPS),
      beads: structuredClone(SUNSET_BEADS),
    },
    halo: { amount: 0, color: "#ff8a46", radius: 0.3 },
    shadow: { amount: 0, color: "#3a0a1e", caustic: 0 },
    states: {
      idle: {},
      // Attentive: the sun lifts to the crest and brightens, and the rim catches more light.
      listening: {
        duration: 0.7,
        contents: {
          sun: { y: -0.15, radius: 0.142, glow: 1.3 },
          clouds: { drift: 0.03 },
          react: { glow: 0.7 },
        },
        glass: { rim: 1.15 },
        post: { exposure: 1.03 },
        react: { wobble: 0.02 },
      },
      // Busy: the weather turns over. Clouds churn, the sea swells and the sun dips behind it.
      thinking: {
        duration: 0.9,
        contents: {
          sun: { y: -0.3, glow: 0.75 },
          clouds: { drift: 0.09, billow: 0.85 },
          sea: { drift: 0.06, swell: 0.8 },
        },
        rain: { run: 0.12 },
        post: { saturation: 1.08 },
      },
      // Talking: the rain runs, and the level drives the glow, the billow and the rain.
      speaking: {
        duration: 0.6,
        contents: {
          sun: { glow: 1.2 },
          clouds: { drift: 0.04, billow: 0.35 },
          sea: { swell: 0.4 },
          react: { glow: 0.9, billow: 0.6 },
        },
        rain: { run: 0.45 },
        react: { rain: 1.4, wobble: 0.03 },
      },
      // Off: the sun has set and the colour has drained out of the sky.
      muted: {
        duration: 1.4,
        contents: {
          sun: { y: -0.45, glow: 0.35 },
          clouds: { drift: 0.005 },
          sea: { drift: 0.003, swell: 0.1 },
        },
        rain: { mist: 0.5 },
        post: { saturation: 0.3, exposure: 0.82 },
      },
    },
  });
}

/** Repaint the sunset's layout: one [shade, body, crown] per cloud, one [top, foot, crest] per
 *  bank. */
function repaint(contents: SunsetContents, clouds: Triple[], banks: Triple[]): SunsetContents {
  return {
    ...contents,
    clouds: {
      ...contents.clouds,
      items: contents.clouds.items.map((cloud, i) => {
        const [shade, body, crown] = clouds[Math.min(i, clouds.length - 1)]!;
        return { ...cloud, shade, body, crown };
      }),
    },
    sea: {
      ...contents.sea,
      banks: contents.sea.banks.map((bank, i) => {
        const [top, foot, crest] = banks[Math.min(i, banks.length - 1)]!;
        return { ...bank, top, foot, crest };
      }),
    },
  };
}

/** Morning: a pale sun just over the sea of cloud, lilac to blue overhead. */
function dawn(): OrbConfig {
  const base = sunset();
  const contents = base.contents as SunsetContents;
  return ensureOrbConfig({
    ...base,
    contents: {
      ...repaint(
        contents,
        [
          ["#c9a3d6", "#fff0f2", "#ffffff"],
          ["#c9a3d6", "#fff0f2", "#ffffff"],
          ["#b48ccb", "#ffe4ea", "#ffffff"],
        ],
        [
          ["#fff3ee", "#e9d2f1", "#ffffff"],
          ["#e4d0f1", "#b8a5e2", "#fff6ff"],
          ["#a798d9", "#5c59a9", "#d8cdf5"],
        ],
      ),
      sky: {
        ...contents.sky,
        stops: [
          [0, "#fff7e3"],
          [0.16, "#ffe2b6"],
          [0.36, "#ffc4c4"],
          [0.56, "#dab9e9"],
          [0.8, "#a1b5ed"],
          [1, "#6e8ed8"],
        ],
      },
      sun: {
        ...contents.sun,
        y: -0.14,
        color: "#fffbf2",
        glowCore: "#fffaf0",
        glowMid: "#ffe1b4",
        glowEdge: "#ffb3b8",
      },
      wisps: { ...contents.wisps, color: "#fff1e6" },
    },
    rain: { ...base.rain, shade: "#2b2153" },
    glass: {
      ...base.glass,
      edgeColor: "#1d1642",
      bounceColor: "#e2e8ff",
      outlineColor: "#2a2352",
    },
    halo: { ...base.halo, color: "#ffc9d6" },
    states: mergeStates(base.states, {
      listening: { contents: { sun: { y: -0.08 } } },
      thinking: { contents: { sun: { y: -0.2 } } },
      muted: { contents: { sun: { y: -0.36 } } },
    }),
  });
}

/** Weather: a grey sky that never quite clears, and rain that always runs. */
function storm(): OrbConfig {
  const base = sunset();
  const contents = repaint(
    base.contents as SunsetContents,
    [
      ["#454e63", "#a8b2c3", "#dde3ec"],
      ["#454e63", "#a8b2c3", "#dde3ec"],
      ["#3b4357", "#97a2b5", "#d5dce7"],
    ],
    [
      ["#9aa5b8", "#6b7891", "#c9d1de"],
      ["#717e96", "#465169", "#a3aec0"],
      ["#4b5670", "#232a3d", "#7a869c"],
    ],
  );
  return ensureOrbConfig({
    ...base,
    contents: {
      ...contents,
      clouds: { ...contents.clouds, drift: 0.03 },
      sky: {
        ...contents.sky,
        stops: [
          [0, "#dfe4ea"],
          [0.2, "#bcc6d3"],
          [0.4, "#929fb3"],
          [0.6, "#6e7b93"],
          [0.8, "#4c5771"],
          [1, "#2e3750"],
        ],
      },
      sun: {
        ...contents.sun,
        glow: 0.35,
        color: "#eef1f6",
        glowCore: "#f1f3f7",
        glowMid: "#c6cdd9",
        glowEdge: "#8995a9",
      },
      wisps: { ...contents.wisps, color: "#cfd6e2", opacity: 0.6 },
    },
    rain: { ...base.rain, run: 0.22, shade: "#0d1322" },
    glass: {
      ...base.glass,
      edgeColor: "#0a0f1c",
      bounceColor: "#cbd4e2",
      outlineColor: "#151b2b",
    },
    halo: { ...base.halo, color: "#a9b8d6" },
    states: mergeStates(base.states, {
      listening: { contents: { sun: { glow: 0.55 } }, rain: { run: 0.3 } },
      // Busy, the rain comes down hard; talking, it pours with the voice.
      thinking: { contents: { sun: { glow: 0.25 } }, rain: { run: 0.9, density: 0.7 } },
      speaking: { contents: { sun: { glow: 0.45 } }, rain: { run: 0.8, density: 0.35 } },
      muted: { contents: { sun: { glow: 0.15 } }, rain: { run: 0.1 }, fog: { amount: 0.55 } },
    }),
  });
}

/** After dark: a moon over an indigo sea of cloud, the clouds lit silver at the crown. */
function night(): OrbConfig {
  const base = sunset();
  const contents = base.contents as SunsetContents;
  return ensureOrbConfig({
    ...base,
    contents: {
      ...repaint(
        contents,
        [
          ["#1c1d46", "#4b5090", "#a6abea"],
          ["#1c1d46", "#4b5090", "#a6abea"],
          ["#17183d", "#40457f", "#9aa0e2"],
        ],
        [
          ["#5a5ea6", "#2f3170", "#9da2e6"],
          ["#3b3e86", "#1d1f52", "#6f74c4"],
          ["#24265f", "#0c0d2a", "#4a4e9e"],
        ],
      ),
      sky: {
        ...contents.sky,
        stops: [
          [0, "#40457f"],
          [0.15, "#2e3169"],
          [0.35, "#212355"],
          [0.55, "#181943"],
          [0.78, "#101132"],
          [1, "#0a0b21"],
        ],
      },
      sun: {
        ...contents.sun,
        x: 0.6,
        y: 0.42,
        radius: 0.085,
        color: "#f5f3ff",
        glow: 0.8,
        glowRadius: 0.5,
        glowCore: "#e9e7ff",
        glowMid: "#8a8fd9",
        glowEdge: "#2c2f67",
      },
      wisps: { ...contents.wisps, color: "#8c91d6", opacity: 0.55 },
    },
    rain: { ...base.rain, shade: "#05061a" },
    glass: {
      ...base.glass,
      edgeColor: "#05061a",
      bounceColor: "#9ba1ff",
      outlineColor: "#0b0c27",
    },
    halo: { ...base.halo, color: "#8a8fff" },
    states: mergeStates(base.states, {
      listening: { contents: { sun: { y: 0.46, glow: 1.15 } } },
      thinking: { contents: { sun: { y: 0.4, glow: 0.6 } } },
      speaking: { contents: { sun: { y: 0.42, glow: 1 } } },
      muted: { contents: { sun: { y: 0.36, glow: 0.3 } } },
    }),
  });
}

export const PRESETS = {
  clear,
  aura,
  landscape,
  sunset,
  dawn,
  storm,
  night,
} as const satisfies Record<string, () => OrbConfig>;

export type PresetName = keyof typeof PRESETS;

/** The preset names, in menu order. */
export const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

export function isPresetName(name: string): name is PresetName {
  return Object.hasOwn(PRESETS, name);
}
