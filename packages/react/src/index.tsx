"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { CSSProperties, ForwardedRef, ReactElement, ReactNode } from "react";
import { createDefaultConfig, createOrb, ensureOrbConfig, mergeOrbConfig } from "@orb3d/core";
import type {
  FallbackReason,
  OrbConfigInput,
  OrbConfig,
  OrbHandle,
  OrbOptions,
  OrbPhase,
  OrbRenderer,
  PosterFit,
} from "@orb3d/core";

/** Flat props for the settings people actually reach for; anything else goes through `config`. */
interface FlatProps {
  /** The orb's diameter as a share of the box's shorter side. Below 1 leaves room for a halo. */
  size?: number;
  /** `"transparent"` (the default) composites over the page; a colour fills behind the orb. */
  background?: string;
  /** Scales every motion at once. */
  speed?: number;
  paused?: boolean;
}

export interface Orb3DProps extends FlatProps {
  /** A preset: a function (tree-shakeable) or a name string (lazy-imports the presets chunk). */
  preset?: string | (() => OrbConfigInput);
  /**
   * The state to show, by name (`idle`, `listening`, `thinking`, `speaking`, `muted` in the
   * built-in presets). Changing it springs the orb to the new state; it never rebuilds anything.
   */
  state?: string;
  /**
   * The input level, 0 to 1. Fine for a value that changes now and then; for audio, call
   * `ref.current.setLevel()` from your analyser loop instead, so React doesn't re-render per frame.
   */
  level?: number;
  /**
   * Escape hatch: a full or partial config, applied last and merged block by block, so
   * `config={{ glass: { frost: 0.5 } }}` keeps the rest of the glass, and
   * `config={{ contents: { type: "image", src: "/photo.jpg" } }}` puts a picture in it.
   * Precedence: default ← preset ← flat props ← config.
   */
  config?: OrbConfigInput;
  poster?: string;
  /** Poster `object-fit`. Default `"fill"` (matches the canvas, so the handoff is seamless). */
  posterFit?: PosterFit;
  /** Poster→canvas crossfade in ms. Default 300. */
  fadeMs?: number;
  lazy?: boolean;
  webgl?: "auto" | "force" | "off";
  respectReducedMotion?: boolean;
  adaptiveQuality?: boolean;
  /** Stay a poster below this box size in CSS pixels. */
  minSizeForWebGL?: number;
  className?: string;
  style?: CSSProperties;
  /** Custom SSR poster markup, e.g. `<img data-orb3d-poster src="…" />`; the shell adopts it. */
  children?: ReactNode;
  onReady?: (renderer: OrbRenderer) => void;
  onFallback?: (reason: FallbackReason) => void;
  onPhaseChange?: (phase: OrbPhase) => void;
}

/** Resolve the base config: function preset (sync) → its config; string preset → lazy-load. */
async function resolveBase(preset: Orb3DProps["preset"]): Promise<OrbConfig> {
  if (typeof preset === "string") {
    const { PRESETS, isPresetName } = await import("@orb3d/core/presets");
    if (isPresetName(preset)) return PRESETS[preset]();
  }
  return syncBase(preset);
}

/** The base we can build synchronously (function preset or default); a string preset resolves later. */
function syncBase(preset: Orb3DProps["preset"]): OrbConfig {
  return typeof preset === "function"
    ? ensureOrbConfig(mergeOrbConfig(createDefaultConfig(), preset()))
    : createDefaultConfig();
}

/** Apply the flat props (and the config escape hatch) onto a full base config. */
function buildConfig(base: OrbConfig, props: Orb3DProps): OrbConfigInput {
  // A function preset may hand back the same object on every call, so copy before writing.
  const out: OrbConfigInput = structuredClone(base);
  if (props.size !== undefined) out.size = props.size;
  if (props.background !== undefined) out.background = props.background;
  if (props.speed !== undefined) out.speed = props.speed;
  if (props.paused !== undefined) out.paused = props.paused;
  // The state prop is applied through setState, never through the config: a config change cuts
  // the dials, and a state change should spring.
  delete out.state;
  const config = props.config ? mergeOrbConfig(out, props.config) : out;
  if (props.state !== undefined) delete config.state;
  return config;
}

/**
 * Function presets are keyed by identity: swapping one function for another must re-run the update
 * effect, and a string cannot say which function it saw. An inline function gets a fresh id each
 * render; memoize the preset if you want the effect to skip entirely.
 */
const presetIds = new WeakMap<object, number>();
let nextPresetId = 0;
function presetKey(preset: Orb3DProps["preset"]): string | undefined {
  if (typeof preset !== "function") return preset;
  let id = presetIds.get(preset);
  if (id === undefined) presetIds.set(preset, (id = nextPresetId++));
  return `fn#${id}`;
}

/** A stable string that changes whenever the resolved config would; keys the update effect. */
function configKey(props: Orb3DProps): string {
  return JSON.stringify({
    preset: presetKey(props.preset),
    flat: [props.size, props.background, props.speed, props.paused],
    config: props.config,
  });
}

function Orb3DInner(props: Orb3DProps, ref: ForwardedRef<OrbHandle>): ReactElement {
  const { className, style, children } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<OrbHandle | null>(null);
  // Keep the latest callbacks in a ref so they never force a remount.
  const cbRef = useRef<Pick<Orb3DProps, "onReady" | "onFallback" | "onPhaseChange">>({});
  cbRef.current.onReady = props.onReady;
  cbRef.current.onFallback = props.onFallback;
  cbRef.current.onPhaseChange = props.onPhaseChange;

  const key = useMemo(
    () => configKey(props),
    [props.preset, props.size, props.background, props.speed, props.paused, props.config],
  );
  // The key the live handle was last given, so the update effect can tell a real change from its
  // own first run (and from StrictMode's replay), both of which the mount effect already covered.
  const appliedKeyRef = useRef<string | null>(null);
  const configRevisionRef = useRef(0);

  // A stable object that delegates to whichever handle is live, so a ref taken before the shell
  // mounted, or across a StrictMode remount, keeps working.
  useImperativeHandle(
    ref,
    () => ({
      get phase() {
        return handleRef.current?.phase ?? "poster";
      },
      get renderer() {
        return handleRef.current?.renderer ?? null;
      },
      get state() {
        return handleRef.current?.state ?? props.state ?? "idle";
      },
      setState: (name) => handleRef.current?.setState(name),
      setLevel: (value) => handleRef.current?.setLevel(value),
      setWeather: (snapshot, options) => handleRef.current?.setWeather(snapshot, options),
      snapshot: (opts) => handleRef.current?.snapshot(opts) ?? Promise.resolve(null),
      set: (config) => handleRef.current?.set(config),
      play: () => handleRef.current?.play(),
      pause: () => handleRef.current?.pause(),
      destroy: () => handleRef.current?.destroy(),
    }),
    [],
  );

  // Mount once. StrictMode's double mount is safe: destroy() aborts a pending upgrade, and the
  // pre-upgrade create/destroy is DOM-only (poster + IntersectionObserver).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    const revision = ++configRevisionRef.current;
    const options: OrbOptions = {
      poster: props.poster,
      posterFit: props.posterFit,
      fadeMs: props.fadeMs,
      lazy: props.lazy,
      webgl: props.webgl,
      respectReducedMotion: props.respectReducedMotion,
      adaptiveQuality: props.adaptiveQuality,
      minSizeForWebGL: props.minSizeForWebGL,
      onReady: (r) => cbRef.current.onReady?.(r),
      onFallback: (reason) => cbRef.current.onFallback?.(reason),
      onPhaseChange: (phase) => cbRef.current.onPhaseChange?.(phase),
    };
    const initial = buildConfig(syncBase(props.preset), props);
    if (props.state !== undefined) initial.state = props.state;
    const handle = createOrb(container, initial, options);
    handleRef.current = handle;
    appliedKeyRef.current = key;
    if (props.level !== undefined) handle.setLevel(props.level);
    // A string preset resolves asynchronously; stage the real config once it loads. This is the one
    // set a mount makes: the update effect below sees the key it already applied and skips.
    if (typeof props.preset === "string") {
      void resolveBase(props.preset).then((base) => {
        if (!cancelled && handleRef.current === handle && configRevisionRef.current === revision)
          handle.set(buildConfig(base, props));
      });
    }
    return () => {
      cancelled = true;
      configRevisionRef.current++;
      handle.destroy();
      handleRef.current = null;
      appliedKeyRef.current = null;
    };
    // Mount-time only: options are captured once; config, state and level flow through the
    // effects below.
  }, []);

  // Push config changes (flat props, config, preset) to the live handle.
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle || appliedKeyRef.current === key) return;
    appliedKeyRef.current = key;
    const revision = ++configRevisionRef.current;
    const apply = (base: OrbConfig): void => {
      if (handleRef.current === handle && configRevisionRef.current === revision)
        handle.set(buildConfig(base, props));
    };
    if (typeof props.preset === "string") void resolveBase(props.preset).then(apply);
    else apply(syncBase(props.preset));
  }, [key]);

  useEffect(() => {
    if (props.state !== undefined) handleRef.current?.setState(props.state);
  }, [props.state]);

  useEffect(() => {
    if (props.level !== undefined) handleRef.current?.setLevel(props.level);
  }, [props.level]);

  return (
    <div ref={containerRef} className={className} style={style}>
      {children}
    </div>
  );
}

/**
 * A drop-in orb. Renders a `<div>` (SSR-safe; pass an `<img data-orb3d-poster>` child for a
 * server-rendered poster) and, on the client, mounts the shell: poster-first, lazy, WebGL2,
 * reduced-motion and Save-Data aware, with the engine code-split out.
 *
 * A `ref` receives the {@link OrbHandle}: `setState()`, `setLevel()`, `snapshot()`, `set()`,
 * `play()`, `pause()`.
 */
export const Orb3D = forwardRef(Orb3DInner);
Orb3D.displayName = "Orb3D";

export default Orb3D;
export type { OrbConfig, OrbHandle, OrbPhase, FallbackReason, SnapshotOptions } from "@orb3d/core";
