import { describe, expect, it } from "vitest";
import {
  CONTENTS,
  CONTENTS_TYPES,
  GLASS_DIALS,
  LIMITS,
  SHADER_CODE_LIMIT,
  SKY_STOPS,
  clearDial,
  createContentsConfig,
  createDefaultConfig,
  dialFor,
  dialLayout,
  dialsFor,
  ensureOrbConfig,
  getDialValue,
  mergeOrbConfig,
  mergeStates,
  resolveStateName,
  setDial,
  stateDuration,
  writeStateDials,
  type GradientContents,
  type OrbConfig,
  type SunsetContents,
} from "./model";

const sunset = (): OrbConfig => createContentsConfig("sunset");

describe("ensureOrbConfig", () => {
  it("leaves the default config exactly as it is", () => {
    expect(ensureOrbConfig(createDefaultConfig())).toEqual(createDefaultConfig());
  });

  it("fills an empty or unusable config out to the default", () => {
    expect(ensureOrbConfig({})).toEqual(createDefaultConfig());
    expect(ensureOrbConfig(null as unknown as Partial<OrbConfig>)).toEqual(createDefaultConfig());
  });

  it.each(CONTENTS_TYPES)("fills %s contents out to their defaults", (type) => {
    const config = ensureOrbConfig({ contents: { type } });
    expect(config.contents).toEqual(CONTENTS[type].defaults());
    expect(ensureOrbConfig(createContentsConfig(type))).toEqual(createContentsConfig(type));
  });

  it("treats an unknown kind of contents as clear glass", () => {
    const config = ensureOrbConfig({ contents: { type: "hologram" } as never });
    expect(config.contents).toEqual({ type: "none" });
  });

  it("clamps dials to their range and normalises colours", () => {
    const config = ensureOrbConfig({
      contents: { type: "sunset", sun: { glow: 99, color: "#abc" } },
      glass: { bend: -1, edgeColor: "not a colour" },
    });
    const contents = config.contents as SunsetContents;
    expect(contents.sun.glow).toBe(3);
    expect(contents.sun.color).toBe("#aabbcc");
    expect(contents.sun.radius).toBe(CONTENTS.sunset.defaults().sun.radius);
    expect(config.glass.bend).toBe(0);
    expect(config.glass.edgeColor).toBe(createDefaultConfig().glass.edgeColor);
  });

  it("sorts sky stops and pads them to six without changing the gradient", () => {
    const config = ensureOrbConfig({
      contents: {
        type: "sunset",
        sky: {
          stops: [
            [1, "#000000"],
            [0, "#ffffff"],
          ],
        },
      },
    });
    const { stops } = (config.contents as SunsetContents).sky;
    expect(stops).toHaveLength(SKY_STOPS);
    expect(stops[0]).toEqual([0, "#ffffff"]);
    expect(stops.slice(1)).toEqual(Array.from({ length: SKY_STOPS - 1 }, () => [1, "#000000"]));
  });

  it("caps structure at the renderer's limits", () => {
    const drops = Array.from({ length: 40 }, (_, i) => [i / 40, 0, 0.05, 0]);
    const config = ensureOrbConfig({ rain: { drops } as unknown as OrbConfig["rain"] });
    expect(config.rain.drops).toHaveLength(LIMITS.drops);
  });

  it("drops malformed structure entries rather than failing", () => {
    const config = ensureOrbConfig({
      contents: {
        type: "sunset",
        clouds: {
          items: [
            {
              puffs: [
                [0, 0, -1],
                ["x", 0, 1],
              ],
            },
            { puffs: [[0, 0.5, 0.1]] },
          ],
        },
      } as never,
    });
    const { clouds } = config.contents as SunsetContents;
    expect(clouds.items).toHaveLength(1);
    expect(clouds.items[0]!.puffs).toEqual([[0, 0.5, 0.1]]);
  });

  it("keeps a picture's source and fit, and a shader's code within bounds", () => {
    const image = ensureOrbConfig({
      contents: { type: "image", src: "a.jpg", fit: "contain" },
    });
    expect(image.contents).toMatchObject({ type: "image", src: "a.jpg", fit: "contain" });
    const shader = ensureOrbConfig({ contents: { type: "shader", code: "vec4 x;" } });
    expect(shader.contents).toMatchObject({ code: "vec4 x;" });
    const long = ensureOrbConfig({
      contents: { type: "shader", code: "x".repeat(SHADER_CODE_LIMIT + 1) },
    });
    expect(long.contents).toMatchObject({ code: CONTENTS.shader.defaults().code });
  });

  it("opens in a state that exists", () => {
    expect(ensureOrbConfig({ state: "nope" }).state).toBe("idle");
    expect(ensureOrbConfig({ state: "thinking" }).state).toBe("thinking");
    const custom = ensureOrbConfig({ states: { calm: {}, busy: { speed: 2 } } });
    expect(Object.keys(custom.states)).toEqual(["calm", "busy"]);
    expect(custom.state).toBe("calm");
    expect(Object.keys(ensureOrbConfig({ states: {} }).states)).toEqual(["idle"]);
  });

  it("sanitises state overrides like the base", () => {
    const config = ensureOrbConfig({
      contents: { type: "sunset" },
      states: { thinking: { contents: { sun: { glow: -5 } }, duration: 0 } },
    });
    expect(config.states).toEqual({ thinking: { contents: { sun: { glow: 0 } }, duration: 0.05 } });
  });

  it("drops a state's overrides for contents the orb does not hold", () => {
    const config = ensureOrbConfig({
      states: { idle: { contents: { sun: { y: 1 } }, glass: { frost: 0.5 } } },
    });
    expect(config.states).toEqual({ idle: { glass: { frost: 0.5 } } });
  });
});

describe("mergeOrbConfig", () => {
  it("merges blocks all the way down and replaces arrays", () => {
    const base = sunset();
    const merged = mergeOrbConfig(base, { contents: { sun: { glow: 2 } } });
    const contents = merged.contents as SunsetContents;
    expect(contents.sun).toEqual({ ...(base.contents as SunsetContents).sun, glow: 2 });
    expect(contents.sky).toEqual((base.contents as SunsetContents).sky);
    const drops = mergeOrbConfig(base, { rain: { drops: [] } });
    expect(drops.rain!.drops).toEqual([]);
    expect(drops.rain!.amount).toBe(base.rain.amount);
  });

  it("replaces contents of another kind outright", () => {
    const merged = mergeOrbConfig(sunset(), { contents: { type: "image", src: "a.jpg" } });
    expect(merged.contents).toEqual({ type: "image", src: "a.jpg" });
    // As the components do: what the partial contents leave out comes from the image defaults.
    expect(ensureOrbConfig(merged).contents).toEqual({
      ...CONTENTS.image.defaults(),
      src: "a.jpg",
    });
  });

  it("replaces states by name and removes a state set to null", () => {
    const base = createDefaultConfig();
    const merged = mergeOrbConfig(base, {
      states: { thinking: { glass: { frost: 1 } }, muted: null, busy: { speed: 2 } },
    });
    expect(merged.states!.thinking).toEqual({ glass: { frost: 1 } });
    expect(merged.states!.muted).toBeUndefined();
    expect(merged.states!.busy).toEqual({ speed: 2 });
    expect(merged.states!.idle).toEqual(base.states.idle);
  });
});

describe("mergeStates", () => {
  it("changes part of a state, all the way down", () => {
    const base = sunset();
    const states = mergeStates(base.states, { thinking: { contents: { sun: { glow: 2 } } } });
    const before = base.states.thinking!.contents as { sun: Record<string, number> };
    expect(states.thinking!.contents).toEqual({ ...before, sun: { ...before.sun, glow: 2 } });
    expect(before.sun.glow).not.toBe(2); // the input is not touched
  });
});

describe("contents configs", () => {
  it("carries each kind's own state overrides in the five states", () => {
    const config = createContentsConfig("gradient");
    expect(Object.keys(config.states)).toEqual([
      "idle",
      "listening",
      "thinking",
      "speaking",
      "muted",
    ]);
    expect(config.states.thinking!.contents).toEqual(CONTENTS.gradient.states().thinking);
    expect(config.states.thinking!.environment).toEqual(
      createDefaultConfig().states.thinking!.environment,
    );
  });
});

describe("states", () => {
  it("resolves unknown names to the opening state", () => {
    const config = createDefaultConfig();
    expect(resolveStateName(config, "speaking")).toBe("speaking");
    expect(resolveStateName(config, "nope")).toBe("idle");
    expect(resolveStateName({ states: { a: {}, b: {} } }, "nope")).toBe("a");
  });

  it("takes a state's own duration over the transition's", () => {
    const config = createDefaultConfig();
    expect(stateDuration(config, "speaking")).toBe(config.states.speaking!.duration);
    expect(stateDuration(config, "idle")).toBe(config.transition.duration);
  });

  it("packs a state's dials over the base", () => {
    const config = sunset();
    const { offset, channels } = dialLayout("sunset");
    const dials = writeStateDials(config, "thinking");
    expect(dials).toHaveLength(channels);
    const thinking = config.states.thinking!.contents as { sun: { y: number } };
    expect(dials[offset["contents.sun.y"]!]).toBeCloseTo(thinking.sun.y);
    expect(dials[offset["contents.sun.x"]!]).toBeCloseTo((config.contents as SunsetContents).sun.x);
    const colour = offset["contents.sun.color"]!;
    expect([...dials.subarray(colour, colour + 3)].map((c) => Math.round(c * 255))).toEqual([
      0xff, 0xf6, 0xdc,
    ]);
  });
});

describe("dials", () => {
  it("keeps legacy light incidence and packs elevation in the final reserved channel", () => {
    const config = ensureOrbConfig({
      light: { x: -2, y: 1.6 },
      states: { elevated: { light: { x: 8, elevation: 120 } } },
    });
    expect(config.light).toMatchObject({ x: -2, y: 1.6, elevation: 0 });
    expect(config.states.elevated!.light).toEqual({ x: 3, elevation: 90 });
    for (const type of CONTENTS_TYPES) {
      const layout = dialLayout(type);
      expect(layout.offset["light.elevation"]).toBe(83);
      expect(layout.contentsOffset).toBe(156);
    }
    const data = writeStateDials(config, "elevated");
    expect(data[83]).toBe(90);
    expect(data[dialLayout("none").offset["light.y"]!]).toBeCloseTo(1.6);
  });
  it("defaults to scattered downward rain and keeps both controls in state overrides", () => {
    const base = ensureOrbConfig({});
    expect(base.rain.spawn).toBe(0);
    expect(base.rain.direction).toBe(0);
    expect(base.rain.angle).toBe(0);
    const config = ensureOrbConfig({
      rain: { ...base.rain, spawn: 2, direction: -240, angle: 100 },
      states: { tilted: { rain: { spawn: 0.7, direction: 90, angle: -45 } } },
    });
    expect(config.rain.spawn).toBe(1);
    expect(config.rain.direction).toBe(-180);
    expect(config.rain.angle).toBe(80);
    expect(config.states.tilted!.weather).toEqual({
      gravity: 90,
      rain: { spawn: 0.7, angle: -45 },
    });
  });
  it("lays the contents' dials out from a slot boundary, the sunset's stops first", () => {
    for (const type of CONTENTS_TYPES) {
      expect(dialLayout(type).contentsOffset % 4).toBe(0);
    }
    const { offset, contentsOffset } = dialLayout("sunset");
    for (let i = 0; i < SKY_STOPS; i++) {
      expect(offset[`contents.sky.stops.${i}.0`]).toBe(contentsOffset + 4 * i);
    }
  });

  it("reads through arrays, and moves one sky stop in a state without losing the others", () => {
    const config = sunset();
    const { stops } = (config.contents as SunsetContents).sky;
    expect(getDialValue(config, "contents.sky.stops.2.1")).toBe(stops[2]![1]);
    const override: Record<string, unknown> = {};
    setDial(override, dialFor("sunset", "contents.sky.stops.2.1")!, "#000000", config);
    const written = getDialValue(override, "contents.sky.stops") as [number, string][];
    expect(written).toHaveLength(SKY_STOPS);
    expect(written[2]![1]).toBe("#000000");
    expect(written[3]).toEqual(stops[3]);
  });

  it("hands a dial back to the base, pruning the blocks it empties", () => {
    const override: Record<string, unknown> = { contents: { sun: { glow: 2 } }, speed: 2 };
    clearDial(override, dialFor("sunset", "contents.sun.glow")!);
    expect(override).toEqual({ speed: 2 });
    const stops: Record<string, unknown> = { contents: { sky: { stops: [] } } };
    clearDial(stops, dialFor("sunset", "contents.sky.stops.1.0")!);
    expect(stops).toEqual({});
  });

  it.each(CONTENTS_TYPES)("keeps every %s default inside its dial's range", (type) => {
    const config = createContentsConfig(type);
    for (const dial of dialsFor(type)) {
      if (dial.kind !== "number") continue;
      const value = getDialValue(config, dial.key) as number;
      expect(value, dial.key).toBeGreaterThanOrEqual(dial.min!);
      expect(value, dial.key).toBeLessThanOrEqual(dial.max!);
    }
  });

  it("gives the glass the same dials whatever it holds", () => {
    for (const type of CONTENTS_TYPES) {
      expect(dialsFor(type).slice(0, GLASS_DIALS.length)).toEqual(GLASS_DIALS);
    }
    const gradient = createContentsConfig("gradient").contents as GradientContents;
    expect(gradient.colors).toHaveLength(4);
  });
});
