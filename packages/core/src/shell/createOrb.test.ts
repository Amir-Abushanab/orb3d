import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "../config/model";
import type { OrbRenderer } from "../renderer/OrbRenderer";
import { createOrb } from "./createOrb";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function loadingOrb() {
  vi.stubGlobal("getComputedStyle", () => ({ position: "relative" }));
  const events: (string | number)[] = [];
  const container = { style: {}, querySelector: () => null } as unknown as HTMLElement;
  class Renderer {
    canvas = new EventTarget();
    isContextLost = false;
    constructor() {
      events.push("created");
    }
    setLevel(value: number) {
      events.push(value);
    }
    start() {
      events.push("started");
    }
    dispose() {
      events.push("disposed");
    }
  }
  const core = { createDefaultConfig, OrbRenderer: Renderer as unknown as typeof OrbRenderer };
  let resolve!: (value: typeof core) => void;
  const loaded = new Promise<typeof core>((done) => (resolve = done));
  const handle = createOrb(container, {}, { lazy: false, webgl: "force", loadCore: () => loaded });
  return { handle, events, finish: () => resolve(core), loaded };
}

describe("levels during lazy loading", () => {
  it("applies the latest level before starting and forwards later updates", async () => {
    const { handle, events, finish, loaded } = loadingOrb();
    handle.setLevel(0.2);
    handle.setLevel(0.8);
    expect(events).toEqual([]);
    finish();
    await loaded;
    expect(handle.phase).toBe("running");
    expect(events).toEqual(["created", 0.8, "started"]);
    handle.setLevel(0.4);
    expect(events.at(-1)).toBe(0.4);
    handle.destroy();
  });

  it("does not replay a staged level after the orb is destroyed", async () => {
    const { handle, events, finish, loaded } = loadingOrb();
    handle.setLevel(0.8);
    handle.destroy();
    finish();
    await loaded;
    expect(events).toEqual([]);
    expect(handle.renderer).toBeNull();
  });
});

describe("context recovery", () => {
  it("falls back if the restore event arrives but the renderer could not rebuild", async () => {
    vi.useFakeTimers();
    const { handle, events, finish, loaded } = loadingOrb();
    finish();
    await loaded;
    const renderer = handle.renderer!;
    renderer.canvas.dispatchEvent(new Event("webglcontextlost"));
    Object.assign(renderer, { isContextLost: true });
    renderer.canvas.dispatchEvent(new Event("webglcontextrestored"));
    vi.advanceTimersByTime(4000);
    expect(handle.phase).toBe("fallback");
    expect(handle.renderer).toBeNull();
    expect(events).toContain("disposed");
    handle.destroy();
  });

  it("stays live when the renderer successfully recovers", async () => {
    vi.useFakeTimers();
    const { handle, finish, loaded } = loadingOrb();
    finish();
    await loaded;
    handle.renderer!.canvas.dispatchEvent(new Event("webglcontextlost"));
    handle.renderer!.canvas.dispatchEvent(new Event("webglcontextrestored"));
    vi.advanceTimersByTime(4000);
    expect(handle.phase).toBe("running");
    expect(handle.renderer).not.toBeNull();
    handle.destroy();
  });
});
