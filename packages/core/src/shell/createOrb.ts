import { mergeOrbConfig, mergeStates, type OrbConfigInput } from "../config/model";
import { weatherState, type WeatherSnapshot, type WeatherOptions } from "../weather";
import type { OrbRenderer, OrbRendererOptions } from "../renderer/OrbRenderer";
import { probeWebGL, minSide, prefersReducedData, prefersReducedMotion } from "./probe";
import { ensurePositioned, setupPoster, type Poster, type PosterFit } from "./poster";

export type { PosterFit } from "./poster";

/** Why the shell showed the poster instead of the live orb. */
export type FallbackReason =
  | "no-webgl"
  /** WebGL2 exists, but it is a software rasterizer: the poster is the better answer. Distinct
   *  from `"no-webgl"` on purpose, since "your browser cannot do this" and "this machine has no
   *  GPU" are different messages. */
  | "software-renderer"
  | "reduced-motion"
  | "save-data"
  | "small-viewport"
  | "context-lost"
  | "load-error";

/**
 * Where the shell is: poster → loading → running, or → fallback (a permanent poster).
 *
 * Named a phase, not a state, because a state is what the orb is showing (`idle`, `thinking`);
 * the two change independently, and an orb can switch states long before it has left the poster.
 */
export type OrbPhase = "poster" | "loading" | "running" | "fallback";

/** The heavy module fetched on upgrade. */
type CoreModule = typeof import("../core-loader");

export interface OrbOptions {
  /** Poster URL / data-URI. Defaults to adopting the container's `<img data-orb3d-poster>` (SSR). */
  poster?: string;
  /** Poster `object-fit`. Default `"fill"`, which matches the canvas, so a poster captured at the
   *  container's aspect hands off with no visible jump. */
  posterFit?: PosterFit;
  /** Wait until the container nears the viewport before fetching the engine. Default true. */
  lazy?: boolean;
  /** IntersectionObserver margin for the lazy trigger. Default "200px". */
  rootMargin?: string;
  /**
   * - `"auto"` (default): probe, and upgrade only onto a GPU. A software rasterizer keeps the
   *   poster and reports `"software-renderer"`.
   * - `"force"`: skip the probe and upgrade regardless.
   * - `"off"`: stay a poster. This is how you decline the upgrade; `paused` does not.
   */
  webgl?: "auto" | "force" | "off";
  /** Forward prefers-reduced-motion to the renderer (a still frame; states cut). Default true. */
  respectReducedMotion?: boolean;
  /** Adapt live resolution to sustained slow frames. Default false; exports keep authored resolution. */
  adaptiveQuality?: boolean;
  /** With reduced motion: `"static"` upgrades to a still frame, `"poster"` stays a poster.
   *  Default `"static"`, since a still orb still shows which state it is in. */
  reducedMotionBehavior?: "static" | "poster";
  /** Keep a permanent poster when the user has Save-Data on. Default true. */
  respectSaveData?: boolean;
  /** Stay a poster when the container's shorter side is below this many CSS pixels. Default 0. */
  minSizeForWebGL?: number;
  /** Poster→canvas crossfade duration (ms). Default 300. */
  fadeMs?: number;
  /** Start paused: the engine still loads and the canvas still swaps in, but holds still. */
  paused?: boolean;
  onReady?(renderer: OrbRenderer): void;
  onFallback?(reason: FallbackReason): void;
  onPhaseChange?(phase: OrbPhase): void;
  /** Seam for the standalone/CDN build to supply the core synchronously. */
  loadCore?(): Promise<CoreModule>;
}

export interface SnapshotOptions {
  /** Image MIME type. Default `"image/png"`, which keeps the transparent corners. */
  type?: string;
  /** Encoder quality 0–1 for lossy types. */
  quality?: number;
  /** Render a fixed time for a reproducible frame (default: the live frame). Poster captures
   *  should pass `0`, the frame the orb opens on, so the file doesn't churn. */
  time?: number;
}

export interface OrbHandle {
  readonly phase: OrbPhase;
  readonly renderer: OrbRenderer | null;
  /** The state the orb is showing, or springing toward (staged until the engine is live). */
  readonly state: string;
  /**
   * Move to a state, by name: it springs there once the orb is live. Before then it is staged, so
   * the orb opens in it. An unknown name falls back to the config's opening state.
   */
  setState(name: string): void;
  /** Feed the input level, 0 to 1. The latest value is staged until the orb is live. */
  setLevel(value: number): void;
  /** Apply observations to the current state; live deposits persist while dials transition. */
  setWeather(snapshot: Partial<WeatherSnapshot>, options?: WeatherOptions): void;
  /** Capture the current frame. Resolves `null` until the orb is running. */
  snapshot(options?: SnapshotOptions): Promise<Blob | null>;
  /**
   * Merge a partial config one level deep (see `mergeOrbConfig`). Applied to the live orb at once,
   * or staged before then.
   */
  set(config: OrbConfigInput): void;
  play(): void;
  pause(): void;
  /** Safe in any phase: aborts a pending upgrade, disposes a live renderer, removes the poster. */
  destroy(): void;
}

/**
 * The shell implementation. `loadCore` is an explicit parameter, not read from options, so the
 * standalone build can pass a synchronous core and NOT bundle the dynamic-import path: its output
 * stays a single file. The public {@link createOrb} supplies the dynamic-import default.
 */
export function createOrbImpl(
  loadCore: () => Promise<CoreModule>,
  container: HTMLElement,
  config: OrbConfigInput,
  options: OrbOptions,
): OrbHandle {
  const {
    lazy = true,
    rootMargin = "200px",
    webgl = "auto",
    respectReducedMotion = true,
    reducedMotionBehavior = "static",
    respectSaveData = true,
    minSizeForWebGL = 0,
    fadeMs = 300,
  } = options;

  let phase: OrbPhase = "poster";
  let renderer: OrbRenderer | null = null;
  let staged: OrbConfigInput = { ...config };
  if (options.paused !== undefined) staged.paused = options.paused;
  let stagedState: string | undefined = config.state;
  let stagedLevel: number | undefined;

  let aborted = false;
  let io: IntersectionObserver | null = null;
  let lostTimer: ReturnType<typeof setTimeout> | undefined;
  let lossCount = 0;

  ensurePositioned(container);
  const poster: Poster | null = setupPoster(container, options.poster, options.posterFit);

  function setPhase(next: OrbPhase): void {
    if (phase === next) return;
    phase = next;
    options.onPhaseChange?.(next);
  }

  function fallback(reason: FallbackReason): void {
    setPhase("fallback");
    poster?.show();
    options.onFallback?.(reason);
  }

  function onContextRestored(): void {
    // The browser's restore event can arrive even if rebuilding the shader failed.
    if (renderer && !renderer.isContextLost) clearTimeout(lostTimer);
  }

  function onContextLost(): void {
    lossCount += 1;
    clearTimeout(lostTimer);
    if (lossCount >= 2) {
      teardownRenderer();
      fallback("context-lost");
      return;
    }
    // The renderer asks for a restore; if none has come within ~4s, give up to the poster.
    lostTimer = setTimeout(() => {
      teardownRenderer();
      fallback("context-lost");
    }, 4000);
  }

  function teardownRenderer(): void {
    if (!renderer) return;
    renderer.canvas.removeEventListener("webglcontextlost", onContextLost, false);
    renderer.canvas.removeEventListener("webglcontextrestored", onContextRestored, false);
    renderer.dispose();
    renderer = null;
  }

  async function upgrade(): Promise<void> {
    setPhase("loading");
    let core: CoreModule;
    try {
      core = await loadCore();
    } catch {
      if (!aborted) fallback("load-error");
      return;
    }
    if (aborted) return;

    const rendererOptions: OrbRendererOptions = {
      respectReducedMotion,
      adaptiveQuality: options.adaptiveQuality,
    };
    try {
      const full = mergeOrbConfig(core.createDefaultConfig(), staged);
      if (stagedState !== undefined) full.state = stagedState;
      renderer = new core.OrbRenderer(container, full, rendererOptions);
    } catch {
      // A context the probe said was there and the engine could not get, or a shader the driver
      // refused: either way the poster is what this browser can show.
      fallback("no-webgl");
      return;
    }
    const canvas = renderer.canvas;
    canvas.addEventListener("webglcontextlost", onContextLost, false);
    canvas.addEventListener("webglcontextrestored", onContextRestored, false);
    if (stagedLevel !== undefined) renderer.setLevel(stagedLevel);
    renderer.start();
    setPhase("running");
    options.onReady?.(renderer);

    if (poster) {
      // Crossfade only after two frames, so the orb has definitely painted first.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (!aborted && renderer) poster.fadeOut(fadeMs);
        }),
      );
    }
  }

  function probeAndUpgrade(): void {
    if (aborted) return;
    if (webgl === "auto") {
      const probe = probeWebGL();
      if (probe === "none") return fallback("no-webgl");
      if (probe === "software") return fallback("software-renderer");
    }
    void upgrade();
  }

  function begin(): void {
    // Permanent-poster gates, checked before any lazy wait or engine fetch.
    if (webgl === "off") return; // deliberate poster-only mode, no fallback callback
    if (respectSaveData && prefersReducedData()) return fallback("save-data");
    if (respectReducedMotion && reducedMotionBehavior === "poster" && prefersReducedMotion()) {
      return fallback("reduced-motion");
    }
    if (minSizeForWebGL > 0 && minSide(container) < minSizeForWebGL) {
      return fallback("small-viewport");
    }
    if (lazy && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io?.disconnect();
            io = null;
            probeAndUpgrade();
          }
        },
        { rootMargin },
      );
      io.observe(container);
    } else {
      probeAndUpgrade();
    }
  }

  const handle: OrbHandle = {
    get phase() {
      return phase;
    },
    get renderer() {
      return renderer;
    },
    get state() {
      return renderer?.getState() ?? stagedState ?? staged.state ?? "idle";
    },
    setState(name) {
      stagedState = name;
      renderer?.setState(name);
    },
    setLevel(value) {
      stagedLevel = value;
      renderer?.setLevel(value);
    },
    setWeather(snapshot, opts = {}) {
      const state = handle.state;
      const patch = weatherState(snapshot, {
        target: staged.weather?.view === "sky" ? "hero" : (staged.weather?.view ?? "orb"),
        ...opts,
        reducedMotion: opts.reducedMotion ?? (respectReducedMotion && prefersReducedMotion()),
      });
      staged = mergeOrbConfig(staged, {
        ...(opts.target ? { weather: { view: opts.target === "hero" ? "sky" : opts.target } } : {}),
        states: {
          [state]: mergeStates(staged.states ?? {}, { [state]: { ...patch, duration: 3 } })[state]!,
        },
      });
      renderer?.setWeather(snapshot, opts);
    },
    snapshot(opts = {}) {
      if (!renderer) return Promise.resolve(null);
      const { type = "image/png", quality, time } = opts;
      return renderer.captureImage(type, quality, time);
    },
    set(next) {
      staged = mergeOrbConfig(staged, next);
      if (next.state !== undefined) stagedState = next.state;
      renderer?.setConfig(next);
    },
    play() {
      staged.paused = false;
      renderer?.setPaused(false);
    },
    pause() {
      staged.paused = true;
      renderer?.setPaused(true);
    },
    destroy() {
      aborted = true;
      io?.disconnect();
      io = null;
      clearTimeout(lostTimer);
      teardownRenderer();
      poster?.remove();
    },
  };

  begin();
  return handle;
}

/**
 * Mount an orb into a container: shows a poster at once, then, lazily and only when the browser
 * can run it, fetches the engine, builds the renderer and crossfades in. Falls back to the poster
 * on no WebGL2, Save-Data, reduced motion (if asked), small containers, context loss or a failed
 * load.
 *
 * No static engine import: it arrives through a dynamic import, so the shell stays tiny.
 */
export function createOrb(
  container: HTMLElement,
  config: OrbConfigInput = {},
  options: OrbOptions = {},
): OrbHandle {
  return createOrbImpl(
    options.loadCore ?? (() => import("../core-loader")),
    container,
    config,
    options,
  );
}

/** The drop-in embed contract: an alias of {@link createOrb}. */
export const mountOrb = createOrb;
