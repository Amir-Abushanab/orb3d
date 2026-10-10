import { createOrb, mergeOrbConfig } from "@orb3d/core";
import type {
  FallbackReason,
  OrbConfigInput,
  OrbHandle,
  OrbOptions,
  OrbPhase,
  OrbRenderer,
} from "@orb3d/core";

/** The attributes a live element answers to. The shell options are read once at mount instead. */
const LIVE_ATTRIBUTES = ["config", "src", "preset", "state", "level", "paused"] as const;

// SSR-safe base: `class extends HTMLElement` evaluates HTMLElement at import time, which throws
// under Node. Fall back to a dummy base there; the element is never instantiated server-side
// (register() is guarded), so the missing DOM methods are never called.
const ElementBase: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (function Orb3DElementBase() {} as unknown as typeof HTMLElement);

/**
 * `<orb-3d>`: the framework-agnostic drop-in (Vue, Svelte, plain HTML). Light DOM, `display:block`.
 *
 * Config attributes: `preset` (name), `src` (URL to a config JSON) and `config` (JSON), merged in
 * that order, block by block (see `mergeOrbConfig`), then the `config` property last. `state`
 * springs the orb to a state, `level` (0 to 1) feeds the input level, and `paused` stops and
 * starts it. All of these are LIVE: a change after mount reaches the running orb.
 *
 * Shell options: `poster`, `poster-fit` (`fill` | `cover` | `contain`), `fade-ms`, `lazy`, `webgl`
 * (`auto` | `force` | `off`) and `min-size` (CSS px). Read once at mount.
 *
 * Also `config` and `state` properties, `setLevel()` (for audio: no attribute churn per frame) and
 * a read-only `handle`. Emits `orb3d-ready` (detail = renderer), `orb3d-fallback` (detail =
 * reason) and `orb3d-phase` (detail = phase).
 */
export class Orb3DElement extends ElementBase {
  static get observedAttributes(): string[] {
    return [...LIVE_ATTRIBUTES];
  }

  #handle: OrbHandle | null = null;
  #config: OrbConfigInput = {};
  #debounce?: ReturnType<typeof setTimeout>;
  /**
   * Which connect the in-flight `#mount` belongs to. `#mount` awaits the config, and a disconnect
   * plus reconnect during that await queues a second mount; without this check both would finish
   * and the first handle would leak.
   */
  #mountId = 0;
  #configRevision = 0;
  #preset: { name: string; make: () => OrbConfigInput } | null = null;
  #src: { url: string; config: OrbConfigInput } | null = null;

  constructor() {
    super();
    // A framework may assign config before the lazy import defines <orb-3d>. Replay that own
    // property through the setter so it cannot shadow this class's accessor after upgrade.
    if (Object.hasOwn(this, "config")) {
      const config = this.config;
      delete (this as { config?: OrbConfigInput }).config;
      this.config = config;
    }
  }

  /** The live shell handle (null before connect and after disconnect). */
  get handle(): OrbHandle | null {
    return this.#handle;
  }

  /** Programmatic config, merged last (over the `preset`, `src` and `config` attributes). */
  get config(): OrbConfigInput {
    return this.#config;
  }
  set config(value: OrbConfigInput) {
    this.#config = value ?? {};
    this.#configRevision++;
    this.#scheduleUpdate();
  }

  /** The state the orb is showing. Setting it is the same as setting the `state` attribute. */
  get state(): string {
    return this.#handle?.state ?? this.getAttribute("state") ?? "idle";
  }
  set state(name: string) {
    this.setAttribute("state", name);
  }

  /** Feed the input level, 0 to 1, without touching the attribute. */
  setLevel(value: number): void {
    this.#handle?.setLevel(value);
  }

  connectedCallback(): void {
    if (!this.style.display) this.style.display = "block";
    void this.#mount(++this.#mountId);
  }

  disconnectedCallback(): void {
    this.#mountId++; // invalidate a mount still awaiting its config
    clearTimeout(this.#debounce);
    this.#handle?.destroy();
    this.#handle = null;
  }

  attributeChangedCallback(name: string): void {
    if (name === "config" || name === "src" || name === "preset") this.#configRevision++;
    const handle = this.#handle;
    if (!handle) return;
    if (name === "state") {
      const state = this.getAttribute("state");
      if (state) handle.setState(state);
    } else if (name === "level") {
      handle.setLevel(Number(this.getAttribute("level")) || 0);
    } else if (name === "paused") {
      if (this.#boolAttr("paused")) handle.pause();
      else handle.play();
    } else {
      this.#scheduleUpdate();
    }
  }

  async #mount(id: number): Promise<void> {
    const revision = this.#configRevision;
    const config = await this.#buildConfig();
    if (id !== this.#mountId || !this.isConnected) return; // superseded while the config resolved
    if (revision !== this.#configRevision) return this.#mount(id);
    const state = this.getAttribute("state");
    if (state) config.state = state;
    const minSize = Number(this.getAttribute("min-size"));
    const options: OrbOptions = {
      poster: this.getAttribute("poster") ?? undefined,
      posterFit: (this.getAttribute("poster-fit") as OrbOptions["posterFit"]) ?? undefined,
      fadeMs: this.#numAttr("fade-ms"),
      lazy: this.#boolAttr("lazy"),
      webgl: (this.getAttribute("webgl") as OrbOptions["webgl"]) ?? undefined,
      minSizeForWebGL: Number.isFinite(minSize) && minSize > 0 ? minSize : undefined,
      paused: this.#boolAttr("paused"),
      adaptiveQuality: this.#boolAttr("adaptive-quality"),
      onReady: (renderer: OrbRenderer) =>
        this.dispatchEvent(new CustomEvent("orb3d-ready", { detail: renderer })),
      onFallback: (reason: FallbackReason) =>
        this.dispatchEvent(new CustomEvent("orb3d-fallback", { detail: reason })),
      onPhaseChange: (phase: OrbPhase) =>
        this.dispatchEvent(new CustomEvent("orb3d-phase", { detail: phase })),
    };
    const handle = createOrb(this, config, options);
    // A synchronous phase event can remove the element before createOrb returns its handle.
    if (id !== this.#mountId || !this.isConnected) return handle.destroy();
    this.#handle = handle;
    const level = Number(this.getAttribute("level"));
    if (level > 0) this.#handle.setLevel(level);
  }

  /** preset ← src JSON ← config attribute ← config property, block by block. */
  async #buildConfig(): Promise<OrbConfigInput> {
    let base: OrbConfigInput = {};
    const presetName = this.getAttribute("preset");
    if (presetName) {
      if (this.#preset?.name !== presetName) {
        const { PRESETS, isPresetName } = await import("@orb3d/core/presets");
        const make = isPresetName(presetName) ? PRESETS[presetName] : (): OrbConfigInput => ({});
        this.#preset = { name: presetName, make };
      }
      base = this.#preset.make();
    }
    const src = this.getAttribute("src");
    if (src) {
      if (this.#src?.url !== src) {
        try {
          const json: unknown = await fetch(src).then((r) => {
            if (!r.ok) throw new Error(`config: ${r.status}`);
            return r.json();
          });
          if (json && typeof json === "object" && !Array.isArray(json)) {
            this.#src = { url: src, config: json as OrbConfigInput };
          }
        } catch {
          // ignore a failed or invalid config fetch; fall through to whatever we have
        }
      }
      // Cloned so the cache never shares an object with a config the shell may go on to hold.
      if (this.#src?.url === src) base = mergeOrbConfig(base, structuredClone(this.#src.config));
    }
    const merged = mergeOrbConfig(
      mergeOrbConfig(base, parseJson(this.getAttribute("config"))),
      this.#config,
    );
    // The state attribute is applied through setState, so a config update never cuts a transition.
    delete merged.state;
    return merged;
  }

  #scheduleUpdate(): void {
    clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => {
      void this.#update();
    }, 50);
  }

  async #update(): Promise<void> {
    const handle = this.#handle;
    if (!handle) return;
    const revision = this.#configRevision;
    const config = await this.#buildConfig();
    if (this.#handle !== handle || revision !== this.#configRevision) return;
    handle.set(config);
  }

  /** A non-negative number attribute, or undefined for the shell default (`"0"` is a value). */
  #numAttr(name: string): number | undefined {
    if (!this.hasAttribute(name)) return undefined;
    const value = Number(this.getAttribute(name));
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  /** Presence = true; `"false"`/`"0"` = false; absent = undefined (shell default). */
  #boolAttr(name: string): boolean | undefined {
    if (!this.hasAttribute(name)) return undefined;
    const value = this.getAttribute(name);
    return value !== "false" && value !== "0";
  }
}

function parseJson(json: string | null): OrbConfigInput {
  if (!json) return {};
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as OrbConfigInput)
      : {};
  } catch {
    return {};
  }
}

/** Define the element (idempotent, SSR/Node-import-safe). */
export function register(tag = "orb-3d"): void {
  if (typeof window === "undefined" || typeof customElements === "undefined") return;
  if (!customElements.get(tag))
    customElements.define(tag, tag === "orb-3d" ? Orb3DElement : class extends Orb3DElement {});
}

// Self-register on import so a bare `import "@orb3d/element"` makes <orb-3d> work. Guarded so
// importing under Node (SSR) is a no-op rather than a ReferenceError.
register();

declare global {
  interface HTMLElementTagNameMap {
    "orb-3d": Orb3DElement;
  }
}

export type { OrbConfig, OrbHandle, OrbPhase, FallbackReason, SnapshotOptions } from "@orb3d/core";
