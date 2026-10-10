import { describe, expect, it } from "vitest";
import { ensureOrbConfig, writeStateDials } from "./config/model";
import { PRESETS, PRESET_NAMES, isPresetName } from "./presets";

describe("presets", () => {
  it.each(PRESET_NAMES)("%s is a complete, valid config", (name) => {
    const config = PRESETS[name]();
    expect(ensureOrbConfig(config)).toEqual(config);
  });

  it.each(PRESET_NAMES)("%s has the five states, and each looks different", (name) => {
    const config = PRESETS[name]();
    expect(Object.keys(config.states)).toEqual([
      "idle",
      "listening",
      "thinking",
      "speaking",
      "muted",
    ]);
    const packed = Object.keys(config.states).map((s) => writeStateDials(config, s).join());
    expect(new Set(packed).size).toBe(packed.length);
  });

  it("opens on clear glass", () => {
    expect(PRESET_NAMES[0]).toBe("clear");
    expect(PRESETS.clear().contents).toEqual({ type: "none" });
  });

  it("knows its own names", () => {
    expect(isPresetName("sunset")).toBe(true);
    expect(isPresetName("toString")).toBe(false);
  });
});
