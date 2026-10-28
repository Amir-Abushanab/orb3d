import { describe, expect, it } from "vitest";
import { CONTENTS_TYPES, createContentsConfig } from "../config/model";
import { PRESETS, PRESET_NAMES } from "../presets";
import { compileOrb } from "./compile";
import { MAX_SLOTS, programLayout } from "./layout";
import { OrbRuntime } from "./runtime";
import { orbShader } from "./shader";

describe("compileOrb", () => {
  it("rejects older programs before their changed uniform layout can be used", () => {
    const config = createContentsConfig("none");
    const program = compileOrb(config);
    const legacy = structuredClone(program);
    Object.assign(legacy, { version: 7 });
    expect(() => new OrbRuntime(legacy)).toThrow("re-export");
  });
  it.each(CONTENTS_TYPES)("lays %s out inside the uniform budget", (type) => {
    const layout = programLayout(type);
    expect(layout.slots).toBeLessThanOrEqual(MAX_SLOTS);
    const program = compileOrb(createContentsConfig(type));
    expect(program.slots).toBe(layout.slots);
    expect(program.static).toHaveLength((layout.slots - layout.staticSlot) * 4);
    for (const state of Object.values(program.states))
      expect(state.dials).toHaveLength(program.dialCount);
  });

  it.each(PRESET_NAMES)("compiles %s to plain JSON", (name) => {
    const program = compileOrb(PRESETS[name]());
    expect(JSON.parse(JSON.stringify(program))).toEqual(program);
    expect(program.clocks).toHaveLength(7);
    for (const [rate, react] of program.clocks) {
      expect(rate).toBeLessThan(program.dialCount);
      expect(react).toBeLessThan(program.dialCount);
    }
  });

  it("carries a picture's source, a shader's code, and shaders when asked", () => {
    const image = compileOrb({ contents: { type: "image", src: "a.jpg" } });
    expect(image.media).toEqual({ src: "a.jpg", kind: "image" });
    expect(image.shader).toBe("media");
    const custom = compileOrb(
      { contents: { type: "shader", code: "// mine" } },
      {
        shaders: ["msl", "glsl"],
      },
    );
    expect(custom.code).toBe("// mine");
    expect(custom.shaders?.glsl).toContain("// mine");
    expect(custom.shaders?.msl).toContain("// mine");
    expect(custom.shaders?.sksl).toBeUndefined();
  });
});

describe("orbShader", () => {
  it.each(CONTENTS_TYPES)("expands every token for %s in each dialect", (type) => {
    for (const dialect of ["glsl", "sksl", "msl"] as const) {
      const source = orbShader(dialect, { contents: type });
      expect(source).not.toMatch(/\$\w/);
      expect(source).toContain("orbContents");
    }
  });

  it("threads the picture through Metal's functions", () => {
    const msl = orbShader("msl", { contents: "image" });
    expect(msl).toContain("texture2d<float> uMedia [[texture(0)]]");
    expect(msl).toContain("orbContents(uData, uMedia, ");
    expect(orbShader("msl", { contents: "none" })).not.toContain("uMedia");
  });
});

describe("the runtime's clocks", () => {
  it("integrate their rates at the speed, from where they are", () => {
    const config = createContentsConfig("gradient");
    const program = compileOrb(config);
    const runtime = new OrbRuntime(program);
    runtime.advance(1);
    const data = runtime.write(10, 10);
    // Clock 0 is time at speed 1; the contents' first clock is the flow, at its rate.
    expect(data[4]).toBeCloseTo(1, 5);
    expect(data[8]).toBeCloseTo((config.contents as { flow: number }).flow, 5);
  });

  it("writes the picture's size once it has loaded", () => {
    const runtime = new OrbRuntime(compileOrb({ contents: { type: "image" } }));
    expect(runtime.write(10, 10)[14]).toBe(0);
    runtime.setMedia(640, 480);
    const data = runtime.write(10, 10);
    expect([data[12], data[13], data[14]]).toEqual([640, 480, 1]);
  });
});
