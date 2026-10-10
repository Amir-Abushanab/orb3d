import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContentsConfig, ensureOrbConfig, type OrbConfig } from "@orb3d/core";
import { PRESETS } from "@orb3d/core/presets";
import { CLEAR_UNDO_MS, History, describeChange } from "./history";

/** A picture picked from disk: big enough that the timeline holds it out of line. */
const PICKED = `data:image/jpeg;base64,${"A".repeat(4000)}`;

function picture(src: string, zoom: number): OrbConfig {
  return ensureOrbConfig({ contents: { type: "image", src, zoom } as never });
}

function timeline(live: () => OrbConfig): History {
  return new History({ getLive: live, getPresetName: () => "custom", onChange: () => {} });
}

describe("the timeline", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("steps back and forward, and editing drops what was ahead", () => {
    let live = PRESETS.clear();
    const h = timeline(() => live);
    h.reset(live, "clear");
    live = ensureOrbConfig({ ...live, glass: { ...live.glass, frost: 0.4 } });
    h.commit(live, "custom");
    live = ensureOrbConfig({ ...live, glass: { ...live.glass, frost: 0.8 } });
    h.commit(live, "custom");
    expect(h.undo()?.config.glass.frost).toBe(0.4);
    expect(h.undo()?.config.glass.frost).toBe(0);
    expect(h.undo()).toBeNull();
    expect(h.redo()?.config.glass.frost).toBe(0.4);
    live = ensureOrbConfig({ ...live, glass: { ...live.glass, frost: 0.1 } });
    h.commit(live, "custom");
    expect(h.getState().canRedo).toBe(false);
    expect(h.getState().entries.map((e) => e.label)).toEqual(["clear", "frost", "frost"]);
  });

  it("makes one version of a stream of changes", () => {
    let live = PRESETS.clear();
    const h = timeline(() => live);
    h.reset(live, "clear");
    for (let i = 1; i <= 30; i++) {
      live = ensureOrbConfig({ ...live, glass: { ...live.glass, rim: i / 20 } });
      h.markDirty();
      vi.advanceTimersByTime(16);
    }
    vi.advanceTimersByTime(1000);
    expect(h.getState().entries).toHaveLength(2);
  });

  it("skips a commit that changes nothing", () => {
    const live = PRESETS.clear();
    const h = timeline(() => live);
    h.reset(live, "clear");
    expect(h.commit(structuredClone(live), "clear")).toBe(false);
    expect(h.getState().entries).toHaveLength(1);
  });

  it("brings a cleared timeline back, but only for a while", () => {
    let live = PRESETS.clear();
    const h = timeline(() => live);
    h.reset(live, "clear");
    live = ensureOrbConfig({ ...live, speed: 2 });
    h.commit(live, "custom");
    h.clear(live, "custom");
    expect(h.getState().entries).toHaveLength(1);
    expect(h.undoClear()).toBe(true);
    expect(h.getState().entries).toHaveLength(2);
    h.clear(live, "custom");
    vi.advanceTimersByTime(CLEAR_UNDO_MS + 1);
    expect(h.undoClear()).toBe(false);
  });

  it("hands back a copy, never the version it keeps", () => {
    const live = PRESETS.clear();
    const h = timeline(() => live);
    h.reset(live, "clear");
    h.commit(ensureOrbConfig({ ...live, speed: 3 }), "custom");
    const back = h.undo()!;
    back.config.speed = 9;
    expect(h.redo()?.config.speed).toBe(3);
    expect(h.undo()?.config.speed).toBe(1);
  });
});

describe("a picture picked from disk, through the timeline", () => {
  it("comes back intact after an undo", () => {
    let live = picture(PICKED, 1);
    const h = timeline(() => live);
    h.reset(live, "custom");
    live = picture(PICKED, 2);
    h.commit(live, "custom", "zoom");
    expect(h.undo()?.config.contents).toMatchObject({ src: PICKED, zoom: 1 });
  });

  it("leaves the live config alone on the way in", () => {
    const live = picture(PICKED, 1);
    const h = timeline(() => live);
    h.reset(live, "custom");
    h.commit(picture(PICKED, 2), "custom");
    expect(live.contents).toMatchObject({ src: PICKED });
  });

  it("is held once, however many versions name it", () => {
    let live = picture(PICKED, 1);
    const h = timeline(() => live);
    h.reset(live, "custom");
    for (let i = 2; i < 12; i++) {
      live = picture(PICKED, 1 + i / 10);
      h.commit(live, "custom");
    }
    const id = h.getState().entries[4]!.id;
    expect(h.getConfig(id)?.contents).toMatchObject({ src: PICKED });
    expect(JSON.stringify(h.getState())).not.toContain("AAAA");
  });

  it("keeps a hosted URL inline", () => {
    const live = picture("/photo.jpg", 1);
    const h = timeline(() => live);
    h.reset(live, "custom");
    expect(h.getConfig(h.getState().entries[0]!.id)?.contents).toMatchObject({ src: "/photo.jpg" });
  });
});

describe("describeChange", () => {
  const base = ensureOrbConfig(PRESETS.sunset());

  it("names a dial as the panel does, with its group where the label is shared", () => {
    expect(
      describeChange(base, ensureOrbConfig({ ...base, glass: { ...base.glass, rim: 2 } })),
    ).toBe("rim");
    expect(
      describeChange(base, ensureOrbConfig({ ...base, halo: { ...base.halo, color: "#000000" } })),
    ).toBe("halo colour");
  });

  it("names a state's override by the state", () => {
    const next = ensureOrbConfig({
      ...base,
      states: { ...base.states, thinking: { ...base.states.thinking, glass: { frost: 1 } } },
    });
    expect(describeChange(base, next)).toBe("thinking: frost");
  });

  it("names new contents, states added and states deleted", () => {
    expect(describeChange(base, createContentsConfig("gradient"))).toBe("contents gradient");
    const { muted: _muted, ...rest } = base.states;
    expect(describeChange(base, ensureOrbConfig({ ...base, states: rest }))).toBe("delete muted");
    expect(
      describeChange(base, ensureOrbConfig({ ...base, states: { ...base.states, error: {} } })),
    ).toBe("add error");
  });
});
