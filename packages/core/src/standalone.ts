// The single-file CDN / standalone build entry. Unlike the `.` shell, which fetches the engine on
// demand, this imports it statically and pre-binds createOrb / mountOrb with a synchronous
// loadCore, so a plain <script type="module"> from a CDN upgrades with no extra round-trip. This is
// also the runtime the studio inlines into its exported embed HTML.
import * as core from "./core-loader";
import { createOrbImpl } from "./shell/createOrb";
import type { OrbHandle, OrbOptions } from "./shell/createOrb";
import type { OrbConfigInput } from "./config/model";

const loadCore = (): Promise<typeof core> => Promise.resolve(core);

/** {@link createOrbImpl} with the engine already bundled in. */
export function createOrb(
  container: HTMLElement,
  config: OrbConfigInput = {},
  options: OrbOptions = {},
): OrbHandle {
  return createOrbImpl(loadCore, container, config, options);
}

/** The drop-in embed contract: an alias of {@link createOrb}. */
export const mountOrb = createOrb;

// CDN users get the engine and presets directly too, plus the same config surface as the `.`
// entry, so code written against the package entry ports to the standalone unchanged.
export { OrbRenderer } from "./renderer/OrbRenderer";
export { PRESETS, PRESET_NAMES, isPresetName } from "./presets";
export type { PresetName } from "./presets";
export * from "./config/model";
export { parseHex, toHex, normalizeColor } from "./util/color";
export { probeWebGL, isSoftwareRenderer, hasWebGL } from "./shell/probe";
export type { RGB } from "./util/color";
export type {
  OrbOptions,
  OrbHandle,
  OrbPhase,
  FallbackReason,
  SnapshotOptions,
  PosterFit,
} from "./shell/createOrb";
export type { OrbRendererOptions, SetStateOptions } from "./renderer/OrbRenderer";

export * from "./weather/index";
