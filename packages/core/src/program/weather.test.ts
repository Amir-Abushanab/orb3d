import { describe, expect, it } from "vitest";
import {
  createDefaultConfig,
  dialLayout,
  ensureOrbConfig,
  mergeOrbConfig,
  setDial,
  dialFor,
} from "../config/model";
import { compileOrb } from "./compile";
import { FEATURES } from "./features";
import {
  advanceRuntime,
  createRuntimeData,
  createUniforms,
  OrbRuntime,
  setRuntimeState,
  writeRuntime,
} from "./runtime";
import { orbShader } from "./shader";

const off = {
  rain: { enabled: false },
  snow: { enabled: false },
  fog: { enabled: false },
  sunny: { enabled: false },
};

const windRuntime = (shared: boolean) =>
  new OrbRuntime(
    compileOrb({
      weather: {
        wind: shared ? 30 : 0,
        rain: { drops: [], amount: 0, density: 0.5, run: 1, angle: shared ? 0 : 30 },
        snow: { amount: 1, density: 0.6, angle: shared ? 0 : 30 },
      },
      states: { idle: {} },
    }),
  );

describe("shared weather config", () => {
  it("migrates old config/state paths and exports a single weather object", () => {
    const config = ensureOrbConfig({
      rain: { amount: 0.8, direction: 25, lens: 0.7, shade: "#123456" } as never,
      react: { rain: 0.9, snow: 0.4 } as never,
      states: { windy: { rain: { direction: -30 }, react: { fog: 0.6 } } },
    });
    expect(config.weather.gravity).toBe(25);
    expect(config.weather.water).toEqual({ lens: 0.7, shade: "#123456" });
    expect(config.weather.rain.react).toBe(0.9);
    expect(config.weather.snow.react).toBe(0.4);
    expect(config.states.windy!.weather).toEqual({ gravity: -30, fog: { react: 0.6 } });
    const json = JSON.parse(JSON.stringify(config));
    expect(json.rain).toBeUndefined();
    expect(json.react.rain).toBeUndefined();
    expect(json.weather.rain.direction).toBeUndefined();
    expect(ensureOrbConfig(json)).toEqual(config);
    expect(config.rain.direction).toBe(25);
    expect(config.react.rain).toBe(0.9);
  });

  it("merges partial modern and legacy patches without losing shared controls", () => {
    const base = ensureOrbConfig({ weather: { gravity: 18, wind: 24, rain: { density: 0.5 } } });
    const merged = ensureOrbConfig(mergeOrbConfig(base, { weather: { snow: { enabled: false } } }));
    expect(merged.weather.gravity).toBe(18);
    expect(merged.weather.rain.density).toBe(0.5);
    expect(merged.weather.snow.enabled).toBe(false);
    const legacy = ensureOrbConfig(
      mergeOrbConfig(merged, { rain: { direction: -12, run: 1.3 } as never }),
    );
    expect(legacy.weather.gravity).toBe(-12);
    expect(legacy.weather.wind).toBe(24);
    expect(legacy.weather.rain.run).toBe(1.3);
    const override = {};
    setDial(override, dialFor("none", "rain.direction")!, 45, base);
    expect(override).toEqual({ weather: { gravity: 45 } });
  });

  it("packs shared gravity and wind once for both simulations", () => {
    const program = compileOrb({
      weather: { gravity: 17, wind: 32, rain: { angle: -12 }, snow: { angle: 8 } },
    });
    expect(program.rain.direction).toBe(program.snow.gravity);
    expect(program.rain.wind).toBe(program.snow.wind);
    expect(program.states.idle!.dials[program.rain.wind!]).toBe(32);
  });
  it("applies shared incoming wind identically to rain and snow's local angles", () => {
    const shared = windRuntime(true),
      local = windRuntime(false);
    shared.seek(3);
    local.seek(3);
    expect(shared.snapshot().rain.x).toEqual(local.snapshot().rain.x);
    expect(shared.snapshot().snow.incomingX).toEqual(local.snapshot().snow.incomingX);
    expect(shared.snapshot().snow.y).toEqual(local.snapshot().snow.y);
  });
});

describe("weather gates", () => {
  it("cuts switches immediately while numeric state changes still spring", () => {
    const program = compileOrb({
      weather: { rain: { amount: 1 } },
      states: { idle: {}, off: { weather: off } },
    });
    const data = createRuntimeData(program);
    setRuntimeState(data, program, "off");
    expect(data.x[program.rain.enabled!]).toBe(0);
    expect(data.x[program.rain.amount]).toBe(1);
  });

  it("skips particle access and packing when every weather effect is disabled", () => {
    const program = compileOrb({ weather: off, states: { idle: {} } });
    const data = createRuntimeData(program),
      out = createUniforms(program);
    Object.defineProperty(data.rain, "x", {
      get() {
        throw new Error("disabled rain stepped");
      },
    });
    Object.defineProperty(data.snow, "x", {
      get() {
        throw new Error("disabled snow stepped");
      },
    });
    out.fill(Number.NaN, program.rain.pool * 4);
    advanceRuntime(data, program, 10);
    writeRuntime(data, program, out, 256, 256);
    expect(out[15]! & (FEATURES.rain | FEATURES.snow | FEATURES.mist)).toBe(0);
    expect(out[program.rain.pool * 4]).toBeNaN();
    expect(out[program.snow.pool * 4]).toBeNaN();
  });

  it("pauses and resumes live water and snow without simulating the disabled interval", () => {
    const program = compileOrb({
      weather: { rain: { amount: 1, run: 1 }, snow: { amount: 1, density: 1, melt: 0.6 } },
      states: {
        idle: {},
        off: { weather: { rain: { enabled: false }, snow: { enabled: false } } },
      },
    });
    const runtime = new OrbRuntime(program);
    runtime.seek(2);
    const before = runtime.snapshot();
    runtime.setState("off");
    runtime.advance(30);
    const paused = runtime.snapshot();
    expect(paused.rain.x).toEqual(before.rain.x);
    expect(paused.rain.r).toEqual(before.rain.r);
    expect(paused.snow.ice).toEqual(before.snow.ice);
    runtime.setState("idle");
    runtime.advance(1 / 60);
    const resumed = runtime.snapshot();
    expect(resumed.snow.serial - before.snow.serial).toBeLessThanOrEqual(1);
    expect(Math.abs(resumed.rain.y[0]! - before.rain.y[0]!)).toBeLessThan(0.03);
  });

  it("keeps deposited snow melting and wiping fog when its amount reaches zero and rain is off", () => {
    const program = compileOrb({
      weather: { rain: { enabled: false }, snow: { amount: 1, density: 0, melt: 0.8 } },
      states: { idle: {}, stop: { weather: { snow: { amount: 0 } } } },
    });
    const runtime = new OrbRuntime(program),
      snap = runtime.snapshot(),
      snow = snap.snow;
    snow.live[0] = 2;
    snow.id[0] = 1;
    snow.x[0] = snow.px[0] = 0.1;
    snow.y[0] = snow.py[0] = 0.6;
    snow.radius[0] = snow.pradius[0] = 0.09;
    snow.ice[0] = 0.00036;
    snow.water[0] = 0.00036;
    runtime.restore(snap);
    runtime.setState("stop", true);
    for (let i = 0; i < 180; i++) runtime.advance(1 / 60);
    const after = runtime.snapshot();
    expect(after.snow.ice[0]).toBeLessThan(snow.ice[0]!);
    expect(after.snow.y[0]).toBeLessThan(0.6);
    expect(after.rain.source).toContain(-2);
    const flags = runtime.write(256, 256)[15]!;
    expect(flags & FEATURES.rain).toBe(0);
    expect(flags & FEATURES.snow).toBe(FEATURES.snow);
  });

  it("resumes a contacting meniscus gradually after an enable pause", () => {
    const runtime = new OrbRuntime(
      compileOrb({
        weather: {
          rain: {
            amount: 1,
            run: 0.7,
            mist: 0,
            density: 0,
            drops: [
              [0, 0.4, 0.07, 1],
              [0.05, 0.34, 0.02, 0],
            ],
          },
        },
        states: { idle: {}, off: { weather: { rain: { enabled: false } } } },
      }),
    );
    runtime.advance(1 / 60);
    runtime.advance(1 / 60);
    const before = runtime.snapshot(),
      head = before.rain.pair.findIndex((partner, i) => partner >= 0 && before.rain.live[i] === 1);
    expect(head).toBeGreaterThanOrEqual(0);
    runtime.setState("off");
    runtime.advance(30);
    runtime.setState("idle");
    runtime.advance(1 / 60);
    const resumed = runtime.snapshot();
    expect(resumed.rain.phase[head]).toBeGreaterThan(before.rain.phase[head]!);
    expect(resumed.rain.phase[head]).toBeLessThan(before.rain.phase[head]! + 0.2);
    expect(resumed.rain.pair[head]).toBeGreaterThanOrEqual(0);
  });

  it("preserves runoff when changing shared controls or recompiling an enable switch", () => {
    const config = ensureOrbConfig({
      weather: { rain: { amount: 1, run: 1 } },
      states: { idle: {} },
    });
    const runtime = new OrbRuntime(compileOrb(config));
    runtime.seek(2);
    const before = runtime.snapshot();
    runtime.setProgram(
      compileOrb(
        ensureOrbConfig(
          mergeOrbConfig(config, { weather: { rain: { enabled: false }, gravity: 25 } }),
        ),
      ),
    );
    expect(runtime.snapshot().rain.x).toEqual(before.rain.x);
    expect(runtime.snapshot().rain.path).toEqual(before.rain.path);
  });
});

describe("shader specialization", () => {
  it("omits disabled weather, blur taps, post processing and unused lighting", () => {
    const config = createDefaultConfig();
    config.weather = {
      ...config.weather,
      rain: { ...config.weather.rain, enabled: false },
      snow: { ...config.weather.snow, enabled: false },
    };
    config.contents = {
      type: "shader",
      code: "vec4 contents(vec2 p, float t, float l, vec4 k, vec3 a, vec3 b) { return vec4(a, 1.0); }",
      knobs: [0, 0, 0, 0],
      color1: "#ffffff",
      color2: "#ffffff",
    };
    config.states = { idle: {} };
    config.glass = {
      ...config.glass,
      reflection: 0,
      dispersion: 0,
      highlight: 0,
      glint: 0,
      bounce: 0,
      rim: 0,
      outline: 0,
    };
    const program = compileOrb(config);
    for (const dialect of ["glsl", "sksl", "msl"] as const) {
      const shader = orbShader(dialect, program);
      for (const functionName of [
        "rainScan",
        "rainTrail",
        "snowWater",
        "snowOver",
        "fogAt",
        "sunny",
        "mirror",
      ])
        expect(shader).not.toMatch(new RegExp(`\\b${functionName}\\s*\\(`));
      expect(shader).not.toContain("i < 24");
      expect(shader).not.toContain("float luma");
    }
  });

  it("retains effects enabled by later states and input response", () => {
    const program = compileOrb({
      weather: { ...off, sunny: { enabled: false, rays: 0, flare: 0, sparkle: 0 } },
      states: {
        idle: {},
        active: {
          weather: {
            rain: { enabled: true },
            fog: { enabled: true, react: 0.5 },
            sunny: { enabled: true, amount: 1, rays: 0, flare: 0, sparkle: 0 },
          },
        },
      },
    });
    expect(program.features & FEATURES.rain).toBeTruthy();
    expect(program.features & FEATURES.fog).toBeTruthy();
    expect(program.features & FEATURES.sunny).toBeTruthy();
    const shader = orbShader("glsl", program);
    expect(shader).toContain("rainScan(");
    expect(shader).toContain("fogAt(");
    expect(shader).toContain("sunny(");
    expect(shader).not.toContain("for (int k = 0; k < 3;");
    expect(shader).not.toContain("float sparkle");
  });

  it("retains numeric transitions arriving from a disabled state", () => {
    const program = compileOrb({
      weather: {
        ...off,
        fog: { enabled: false, amount: 1 },
        sunny: { enabled: false, amount: 1, rays: 1 },
      },
      states: {
        idle: {},
        active: {
          weather: {
            fog: { enabled: true, amount: 0 },
            sunny: { enabled: true, amount: 0, rays: 0 },
          },
        },
      },
    });
    expect(program.features & FEATURES.fog).toBeTruthy();
    expect(program.features & FEATURES.sunnyRays).toBeTruthy();
    const data = createRuntimeData(program);
    setRuntimeState(data, program, "active");
    const offsets = dialLayout("none").offset;
    expect(data.x[offsets["weather.fog.enabled"]!]).toBe(1);
    expect(data.x[offsets["weather.fog.amount"]!]).toBe(1);
    expect(orbShader("glsl", program)).toContain("fogAt(");
  });

  it("preserves custom code and helper aliases while pruning library functions", () => {
    const code = `#define sampleNoise fbm
float unusedCustom(float x) { return x; }
vec4 contents(vec2 p, float t, float l, vec4 k, vec3 a, vec3 b) { return vec4(vec3(sampleNoise(p, 3)), 1.0); }`;
    const shader = orbShader(
      "glsl",
      compileOrb({
        weather: off,
        states: { idle: {} },
        contents: { type: "shader", code } as never,
      }),
    );
    expect(shader).toContain(code);
    expect(shader).toContain("// ---- your contents ----");
    expect(shader).toContain("float fbm(");
  });

  it("keeps custom contents' calls to shared helpers when weather is absent", () => {
    const program = compileOrb({
      weather: off,
      states: { idle: {} },
      contents: {
        type: "shader",
        code: "vec4 contents(vec2 p, float t, float l, vec4 k, vec3 a, vec3 b) { return vec4(vec3(fbm(p, 3)), 1.0); }",
      } as never,
    });
    expect(orbShader("glsl", program)).toContain("float fbm(");
    expect(dialLayout("none").contentsOffset).toBe(156);
  });
});
