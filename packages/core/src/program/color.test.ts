import { describe, expect, it } from "vitest";
import {
  CONTENTS_TYPES,
  createContentsConfig,
  dialsFor,
  ensureOrbConfig,
  gradientColor,
  normalizeFill,
  sampleFill,
  setDial,
  skyFill,
  type ColorValue,
} from "../config/model";
import { compileOrb } from "./compile";
import { paintKey } from "./paint";
import { OrbRuntime } from "./runtime";
import { orbShader } from "./shader";
import { effectFrame } from "./frame";

const compileColor = (color: ColorValue) =>
  compileOrb({ halo: { amount: 1, color } as never, states: { idle: {} } });

const quiet = {
  rain: { enabled: false },
  snow: { enabled: false },
  fog: { enabled: false },
  sunny: { enabled: false },
};

describe("spatial colors", () => {
  it("keeps solid colors and validates bounded editable gradients", () => {
    expect(normalizeFill("#abc")).toBe("#aabbcc");
    const mesh = gradientColor("mesh");
    const value = normalizeFill({
      ...mesh,
      softness: 2,
      points: Array.from({ length: 20 }, () => ({ x: -2, y: 3, color: "#abc", influence: 0 })),
    });
    expect(typeof value).toBe("object");
    if (typeof value === "string") throw new Error("gradient rejected");
    expect(value.points).toHaveLength(8);
    expect(value.points[0]).toEqual({ x: 0, y: 1, color: "#aabbcc", influence: 0.05 });
    expect(value.softness).toBe(1);
    expect(normalizeFill("invalid", mesh)).toEqual(mesh);
  });
  it("blends mesh colors in the same linear RGB space as wave3d", () => {
    const fill = {
      ...gradientColor("mesh"),
      points: [
        { x: 0, y: 0.5, color: "#000000", influence: 1 },
        { x: 1, y: 0.5, color: "#ffffff", influence: 1 },
      ],
    };
    for (const c of sampleFill(fill, 0.5, 0.5)) expect(c).toBeCloseTo(0.7353569, 5);
    const linear = skyFill([
      [0, "#000000"],
      [1, "#ffffff"],
    ]);
    expect(sampleFill(linear, 0.5, 0.5)).toEqual([0.5, 0.5, 0.5]);
  });
  it("migrates sky stops into one field and preserves canonical JSON", () => {
    const config = ensureOrbConfig({
      contents: {
        type: "sunset",
        sky: {
          stops: [
            [0, "#123456"],
            [1, "#abcdef"],
          ],
        },
      } as never,
    });
    if (config.contents.type !== "sunset") throw new Error("sunset missing");
    expect(typeof config.contents.sky.color).toBe("object");
    expect(config.contents.sky.stops[0]![1]).toBe("#123456");
    const json = JSON.parse(JSON.stringify(config));
    expect(json.contents.sky.stops).toBeUndefined();
    expect(ensureOrbConfig(json)).toEqual(config);
    const edited = ensureOrbConfig({
      ...config,
      contents: {
        ...config.contents,
        sky: { ...config.contents.sky, color: gradientColor("mesh") },
      },
    });
    if (edited.contents.type !== "sunset" || typeof edited.contents.sky.color === "string")
      throw new Error("mesh missing");
    expect(edited.contents.sky.color.type).toBe("mesh");
  });
  it.each(CONTENTS_TYPES)("supports gradients at every %s color picker", (type) => {
    const config = createContentsConfig(type);
    config.states = { idle: {} };
    for (const dial of dialsFor(type))
      if (dial.kind === "color" && !dial.key.startsWith("contents.sky.stops."))
        setDial(config as never, dial, gradientColor("mesh"), config);
    const valid = ensureOrbConfig(config),
      program = compileOrb(valid);
    expect(program.paint?.fields.length).toBe(
      dialsFor(type).filter(
        (dial) => dial.kind === "color" && !dial.key.startsWith("contents.sky.stops."),
      ).length,
    );
    for (const dialect of ["glsl", "sksl", "msl"] as const)
      expect(orbShader(dialect, program)).not.toMatch(/\$\w/);
  });
  it("keeps a solid-only program free of color buffers and shader work", () => {
    const program = compileOrb({
      contents: { type: "gradient" } as never,
      weather: quiet,
      states: { idle: {} },
    });
    expect(program.paint).toBeUndefined();
    const runtime = new OrbRuntime(program);
    runtime.advance(1);
    runtime.write(100, 100);
    expect(runtime.paintData).toHaveLength(0);
    expect(orbShader("glsl", program)).not.toContain("paintSample");
  });
  it("blends complete fields through interrupted transitions without mutating definitions", () => {
    const program = compileOrb({
      halo: { amount: 1, color: gradientColor("mesh") } as never,
      states: {
        idle: {},
        warm: { halo: { color: gradientColor("radial") } },
        flat: { halo: { color: "#ffffff" } },
      },
    });
    const runtime = new OrbRuntime(program),
      definition = runtime.paintData.slice();
    runtime.setState("warm");
    runtime.advance(0.12);
    runtime.write(100, 100);
    expect(runtime.paintData[0]).toBeGreaterThan(0);
    expect(runtime.paintData[1]).toBeGreaterThan(0);
    const before = runtime.paintData.slice();
    runtime.setState("flat");
    runtime.write(100, 100);
    expect(runtime.paintData).toEqual(before);
    runtime.advance(0.1);
    runtime.write(100, 100);
    expect(runtime.paintData[0]! + runtime.paintData[1]! + runtime.paintData[2]!).toBeCloseTo(1, 5);
    expect(runtime.paintData.slice(4)).toEqual(definition.slice(4));
  });
  it("updates gradient values without changing the shader cache identity", () => {
    const first = gradientColor("mesh"),
      second = structuredClone(first);
    second.points[0]!.x = 0.4;
    const a = compileColor(first),
      b = compileColor(second);
    expect(paintKey(a.paint)).toBe(paintKey(b.paint));
    expect(a.paint?.static).not.toEqual(b.paint?.static);
    expect(orbShader("glsl", a)).toBe(orbShader("glsl", b));
  });
});

describe("effect frame", () => {
  it("preserves the sphere frame with no outside effects", () => {
    expect(effectFrame(200, 100, 1, 0, 0.3, 0)).toEqual({ radius: 50, x: 100, y: 50 });
  });
  it("contains a growing halo and moves up to include a lower shadow", () => {
    const normal = effectFrame(200, 200, 1, 0, 0.3, 0),
      glow = effectFrame(200, 200, 1, 1, 0.8, 0);
    expect(glow.radius).toBeLessThan(normal.radius);
    const edge = 100 / glow.radius;
    expect(Math.exp(-3 * ((edge - 1) / 0.8) ** 2)).toBeLessThanOrEqual(1 / 1024 + 1e-7);
    const shade = effectFrame(200, 200, 1, 0, 0.3, 1);
    expect(shade.y).toBeGreaterThan(100);
    const focus = effectFrame(200, 200, 1, 0, 0.3, 0.000001, 1);
    expect(focus.y).toBeGreaterThan(100);
  });
});
