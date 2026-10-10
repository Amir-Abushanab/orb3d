import { describe, expect, it } from "vitest";
import { ensureOrbConfig } from "@orb3d/core";
import { compileOrb, OrbRuntime } from "@orb3d/core/program";
import { createPreviewConfig } from "./preview";

describe("Base preview", () => {
  it("uses the displayed runoff speed instead of a live state's slower override", () => {
    const config = ensureOrbConfig({
      weather: { rain: { run: 3 } },
      state: "thinking",
      states: { thinking: { weather: { rain: { run: 0.12 } } } },
    });
    const preview = createPreviewConfig(config);
    const runtime = new OrbRuntime(compileOrb(preview));
    runtime.advance(1);
    expect(runtime.snapshot().clock[1]).toBeCloseTo(3);
    runtime.setState("thinking", true);
    runtime.advance(1);
    expect(runtime.snapshot().clock[1]).toBeCloseTo(3.12);
    runtime.setState(preview.state, true);
    runtime.advance(1);
    expect(runtime.snapshot().clock[1]).toBeCloseTo(6.12);
    expect(config.state).toBe("thinking");
    expect(Object.keys(config.states)).toEqual(["thinking"]);
  });

  it("preserves a user's state even if its name matches the internal Base name", () => {
    const config = ensureOrbConfig({ states: { __studio_base__: { speed: 0.5 } } });
    const preview = createPreviewConfig(config);
    expect(preview.state).toBe("__studio_base___");
    expect(preview.states["__studio_base__"]).toEqual(config.states["__studio_base__"]);
    expect(preview.states[preview.state]).toEqual({});
  });
});
