import { weatherState, type WeatherSnapshot, type WeatherOptions } from "../weather/index";
import {
  ensureOrbConfig,
  mergeOrbConfig,
  mergeStates,
  type OrbConfigInput,
  type OrbConfig,
} from "../config/model";
import { compileOrb, type OrbProgram } from "../program/compile";
import { OrbRuntime } from "../program/runtime";
import { OrbGL, shaderKey } from "./gl";
import { OrbMedia } from "./media";
import { AdaptiveResolution } from "./adaptive";

export interface OrbRendererOptions {
  /** Under prefers-reduced-motion, hold a still frame and cut between states. Default true. */
  respectReducedMotion?: boolean;
  /** Adapt live resolution toward 60 fps, within quality/dprMax. Default false. Captures stay full size. */
  adaptiveQuality?: boolean;
  /** Draw into this canvas instead of creating one in the container. */
  canvas?: HTMLCanvasElement;
  /** Keep the drawing buffer between frames, for pixel reads outside a frame. Default false. */
  preserveDrawingBuffer?: boolean;
  /**
   * Called when a custom shader (`contents: { type: "shader" }`) does not compile, with the
   * compiler's message. Until the code compiles, the orb keeps showing the last shader that did,
   * or clear glass if none has.
   */
  onShaderError?(message: string): void;
}

export interface SetStateOptions {
  /** Cut straight to the state instead of springing to it. */
  immediate?: boolean;
}

/**
 * The orb's engine on the web: one full-canvas triangle and one fragment shader on a WebGL2
 * context. The config compiles to a program; the shared runtime springs its dials toward the
 * current state and integrates rates into clocks, so changing a speed moves things on from where
 * they are instead of jumping them; the shader works out everything else from those.
 */
export class OrbRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly #container: HTMLElement;
  readonly #ownsCanvas: boolean;
  readonly #preserve: boolean;
  readonly #respectReducedMotion: boolean;
  readonly #onShaderError: ((message: string) => void) | undefined;
  readonly #adaptiveQuality: boolean;
  readonly #adaptive = new AdaptiveResolution();
  #authoredShortSide = 0;
  #capturing = false;

  #gl: WebGL2RenderingContext | null = null;
  #orb: OrbGL | null = null;
  #shaderError: string | null = null;
  /** The key of the shader of your own that last failed to compile, so it is not tried again. */
  #failed: string | null = null;

  #config: OrbConfig;
  #program: OrbProgram;
  readonly #runtime: OrbRuntime;
  #media: OrbMedia | null = null;

  #output: { width: number; height: number } | null = null;
  #started = false;
  #raf = 0;
  #last = 0;
  #visible = true;
  #lost = false;
  #disposed = false;
  #reduced = false;
  readonly #motion: MediaQueryList | null;
  readonly #resizeObserver: ResizeObserver | null;
  readonly #intersection: IntersectionObserver | null;

  constructor(
    container: HTMLElement,
    config: OrbConfigInput = {},
    options: OrbRendererOptions = {},
  ) {
    this.#container = container;
    this.#preserve = options.preserveDrawingBuffer ?? false;
    this.#respectReducedMotion = options.respectReducedMotion ?? true;
    this.#adaptiveQuality = options.adaptiveQuality ?? false;
    this.#onShaderError = options.onShaderError;
    this.#config = ensureOrbConfig(config);
    this.#program = compileOrb(this.#config);
    this.#runtime = new OrbRuntime(this.#program);

    this.#ownsCanvas = !options.canvas;
    this.canvas = options.canvas ?? document.createElement("canvas");
    if (this.#ownsCanvas) {
      Object.assign(this.canvas.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        display: "block",
      });
      if (getComputedStyle(container).position === "static") container.style.position = "relative";
      container.appendChild(this.canvas);
    }
    try {
      this.#initGL();
    } catch (error) {
      // Leave the container as it was found: the shell falls back to its poster on this throw.
      if (this.#ownsCanvas) this.canvas.remove();
      throw error;
    }
    this.#syncMedia();
    this.canvas.addEventListener("webglcontextlost", this.#onContextLost, false);
    this.canvas.addEventListener("webglcontextrestored", this.#onContextRestored, false);

    this.#motion =
      typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
    this.#reduced = this.#respectReducedMotion && (this.#motion?.matches ?? false);
    this.#motion?.addEventListener("change", this.#onMotionChange);
    document.addEventListener("visibilitychange", this.#onVisibility);
    this.#resizeObserver =
      typeof ResizeObserver === "function" ? new ResizeObserver(() => this.resize()) : null;
    this.#resizeObserver?.observe(container);
    this.#intersection =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver((entries) => {
            this.#visible = entries.some((e) => e.isIntersecting);
            this.refreshPlayback();
          })
        : null;
    this.#intersection?.observe(container);
    this.resize();
  }

  /** Whether frames are being drawn right now. */
  get isRunning(): boolean {
    return this.#raf !== 0;
  }

  /** The context is lost, or its resources have not been successfully rebuilt yet. */
  get isContextLost(): boolean {
    return this.#lost;
  }

  /** Current live-resolution multiplier. Explicit output sizes and captures use 1. */
  get resolutionScale(): number {
    return this.#output || this.#capturing || !this.#adaptiveQuality
      ? 1
      : Math.min(1, Math.max(this.#adaptive.scale, 192 / Math.max(1, this.#authoredShortSide)));
  }

  /** Whether a picture or clip the contents name is still loading (it shows once it has). */
  get mediaLoading(): boolean {
    return this.#media?.loading ?? false;
  }

  /** The custom shader's compile error, if it has one: meanwhile the orb shows the last shader
   *  that compiled, or clear glass. */
  get shaderError(): string | null {
    return this.#shaderError;
  }

  /** The live config. Read it; change it through {@link setConfig}. */
  getConfig(): OrbConfig {
    return this.#config;
  }

  /** The state the orb is in, or springing toward. */
  getState(): string {
    return this.#runtime.state;
  }

  /** The smoothed input level, 0 to 1. */
  getLevel(): number {
    return this.#runtime.level;
  }

  start(): void {
    this.#started = true;
    this.refreshPlayback();
  }

  stop(): void {
    this.#started = false;
    this.refreshPlayback();
  }

  /** Re-decide whether to draw frames: started, not paused, visible, motion allowed. */
  refreshPlayback(): void {
    const animate =
      this.#started &&
      !this.#config.paused &&
      !this.#reduced &&
      this.#visible &&
      document.visibilityState !== "hidden" &&
      !this.#lost &&
      !this.#disposed;
    if (animate && this.#raf === 0) {
      this.#adaptive.reset();
      this.#last = performance.now();
      this.#raf = requestAnimationFrame(this.#tick);
    } else if (!animate && this.#raf !== 0) {
      cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    }
    this.#media?.setPlaying(animate);
    if (!animate && this.#started && this.#reduced) this.#runtime.settle();
    if (!animate) this.renderOnce();
  }

  /**
   * Move to a state. It springs there over the state's `duration` (or `transition.duration`),
   * carrying any motion already under way, unless `immediate` is set or the orb is not animating,
   * in which case it cuts. An unknown name falls back to the opening state.
   */
  setState(name: string, options: SetStateOptions = {}): void {
    const cut = options.immediate === true || this.#raf === 0;
    this.#runtime.setState(name, cut);
    if (cut) this.renderOnce();
  }

  /**
   * Feed the input level, 0 to 1: a voice's loudness, a progress pulse, anything. Smoothed by
   * `level.attack` and `level.release`, then added to the dials through the `react` blocks.
   */
  setLevel(value: number): void {
    this.#runtime.setLevel(value);
  }

  /** Hold still (or carry on) without touching anything else, a transition in flight included. */
  setPaused(paused: boolean): void {
    this.#config.paused = paused;
    this.refreshPlayback();
  }

  /**
   * Merge a partial config (see `mergeOrbConfig`) and apply it at once. Dials cut to their new
   * values rather than springing, so an edit shows immediately; a `state` in the partial moves to
   * that state. New contents build a new shader.
   */
  setConfig(partial: OrbConfigInput, options: { transition?: boolean } = {}): void {
    this.#config = ensureOrbConfig(mergeOrbConfig(this.#config, partial));
    this.#program = compileOrb(this.#config);
    this.#runtime.setProgram(
      this.#program,
      partial.state ?? this.#runtime.state,
      options.transition === true,
    );
    if (this.#gl && !this.#lost) this.#build();
    this.#syncMedia();
    this.resize();
    this.refreshPlayback();
  }

  /** Provider-independent observations; preserve surface deposits and spring to the new weather. */
  setWeather(snapshot: Partial<WeatherSnapshot>, options: WeatherOptions = {}): void {
    const state = this.#runtime.state;
    const patch = weatherState(snapshot, {
      target: this.#config.weather.view === "sky" ? "hero" : this.#config.weather.view,
      ...options,
      reducedMotion: options.reducedMotion ?? this.#reduced,
    });
    const states = mergeStates(this.#config.states, { [state]: { ...patch, duration: 3 } });
    this.setConfig(
      {
        ...(options.target
          ? { weather: { view: options.target === "hero" ? "sky" : options.target } }
          : {}),
        states: { [state]: states[state]! },
      },
      { transition: true },
    );
  }

  /**
   * Jump to `time` seconds after the orb opened in its current state, settled: a reproducible
   * frame. `seek(0)` is the frame a poster should be captured from.
   */
  seek(time: number): void {
    this.#runtime.seek(time);
    this.renderOnce();
  }

  /** Draw one frame now, without advancing time. */
  renderOnce(): void {
    if (this.#orb?.key && !this.#lost && !this.#disposed) this.#draw();
  }

  /** Render at a fixed pixel size instead of the container's (for exports); none to undo. */
  setOutputSize(size?: { width: number; height: number }): void {
    this.#output = size ? { width: Math.round(size.width), height: Math.round(size.height) } : null;
    this.resize();
  }

  resize(): void {
    if (this.#disposed) return;
    let width: number;
    let height: number;
    if (this.#output) {
      ({ width, height } = this.#output);
    } else {
      const ratio =
        Math.min(globalThis.devicePixelRatio || 1, this.#config.dprMax) * this.#config.quality;
      width = Math.round(this.#container.clientWidth * ratio);
      height = Math.round(this.#container.clientHeight * ratio);
      this.#authoredShortSide = Math.min(width, height);
      width = Math.round(width * this.resolutionScale);
      height = Math.round(height * this.resolutionScale);
    }
    width = Math.max(1, width);
    height = Math.max(1, height);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    if (this.#raf === 0) this.renderOnce();
  }

  /**
   * The current frame as an image. With `time`, the frame at that time instead (see {@link seek}),
   * after which the orb carries on from where it was.
   */
  captureImage(type = "image/png", quality?: number, time?: number): Promise<Blob> {
    const saved = time === undefined ? null : this.#runtime.snapshot();
    this.#capturing = true;
    this.resize();
    if (time === undefined) this.renderOnce();
    else this.seek(time);
    // toBlob copies the bitmap synchronously, so the frame just drawn is the one captured even
    // without preserveDrawingBuffer, and restoring below cannot leak into it.
    const blob = new Promise<Blob>((resolve, reject) => {
      this.canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("[orb3d] capture failed"))),
        type,
        quality,
      );
    });
    if (saved) {
      this.#runtime.restore(saved);
    }
    this.#capturing = false;
    this.resize();
    return blob;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#raf !== 0) cancelAnimationFrame(this.#raf);
    this.#raf = 0;
    this.#resizeObserver?.disconnect();
    this.#intersection?.disconnect();
    this.#motion?.removeEventListener("change", this.#onMotionChange);
    document.removeEventListener("visibilitychange", this.#onVisibility);
    this.canvas.removeEventListener("webglcontextlost", this.#onContextLost, false);
    this.canvas.removeEventListener("webglcontextrestored", this.#onContextRestored, false);
    const gl = this.#gl;
    this.#media?.dispose(gl);
    this.#media = null;
    this.#orb?.dispose();
    this.#orb = null;
    // Hand the context back now rather than at garbage collection: browsers cap live contexts.
    if (this.#ownsCanvas) gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.#gl = null;
    if (this.#ownsCanvas) this.canvas.remove();
  }

  // -------------------------------------------------------------------------------------------

  #tick = (now: number): void => {
    const frameMs = now - this.#last;
    const dt = Math.min(Math.max(frameMs / 1000, 0), 0.1);
    this.#last = now;
    if (
      this.#adaptiveQuality &&
      !this.#output &&
      this.#adaptive.sample(frameMs, this.#authoredShortSide)
    )
      this.resize();
    this.#runtime.advance(dt);
    this.#draw();
    this.#raf = requestAnimationFrame(this.#tick);
  };

  #onMotionChange = (): void => {
    this.#reduced = this.#respectReducedMotion && (this.#motion?.matches ?? false);
    this.refreshPlayback();
  };

  #onVisibility = (): void => this.refreshPlayback();

  #onContextLost = (event: Event): void => {
    event.preventDefault(); // ask for a restore
    this.#lost = true;
    this.#orb = null;
    this.#media?.lose();
    this.refreshPlayback();
  };

  #onContextRestored = (): void => {
    try {
      this.#initGL();
    } catch {
      return; // still lost: the shell's timer hands over to the poster
    }
    this.#lost = false;
    this.refreshPlayback();
  };

  /** Load the picture or clip the contents name, if that changed, and drop one no longer named. */
  #syncMedia(): void {
    const media = this.#program.media;
    if (this.#media && this.#media.kind === media?.kind && this.#media.src === media.src) return;
    this.#media?.dispose(this.#gl);
    this.#media = null;
    this.#runtime.setMedia(0, 0);
    if (!media?.src) return;
    const loaded = new OrbMedia(media.kind, media.src, () => {
      if (this.#media !== loaded) return;
      this.#runtime.setMedia(loaded.width, loaded.height);
      this.refreshPlayback();
      if (this.#raf === 0) this.renderOnce();
    });
    this.#media = loaded;
  }

  #initGL(): void {
    const gl = this.canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: this.#preserve,
    });
    if (!gl) throw new Error("[orb3d] WebGL2 is not available");
    this.#gl = gl;
    this.#orb = new OrbGL(gl);
    this.#build();
  }

  /** Compile and link the shader for the program's contents, unless it already is. */
  #build(): void {
    const gl = this.#gl!;
    const key = shaderKey(this.#program);
    // The same code that failed last time fails again: keep what is showing, without the compile.
    if (key === this.#failed) {
      this.#keepShowing();
      return;
    }
    try {
      // Back to code that compiled, or a new shader that does: nothing is wrong any more.
      this.#orb!.use(this.#program, key);
      this.#shaderError = null;
      this.#failed = null;
    } catch (error) {
      // Only a shader of your own can fail on a working context.
      if (this.#program.contents !== "shader" || gl.isContextLost()) throw error;
      const message = error instanceof Error ? error.message : String(error);
      this.#failed = key;
      this.#shaderError = message;
      this.#onShaderError?.(message);
      this.#keepShowing();
    }
  }

  /**
   * A shader of your own that does not compile: keep showing the last one that did, which reads
   * the same uniforms, so the orb holds still while the code is mid-edit. With none before it,
   * show clear glass.
   */
  #keepShowing(): void {
    const orb = this.#orb!;
    if (orb.key?.includes(":shader:")) return;
    if (orb.key !== "fallback") orb.use({ contents: "none" }, "fallback");
    // Clear glass reads the uniform array of clear glass, so hand it one of those.
    this.#program = compileOrb({ ...this.#config, contents: { type: "none" } });
    this.#runtime.setProgram(this.#program, this.#runtime.state);
  }

  #draw(): void {
    const gl = this.#gl!;
    if (this.#media && this.#program.shader === "media") this.#media.bind(gl);
    this.#orb!.draw(this.#runtime, this.canvas.width, this.canvas.height);
  }
}
