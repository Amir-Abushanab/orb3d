// The `@orb3d/core` entry: the lightweight poster-first shell (createOrb / mountOrb) plus the
// framework-agnostic config model. Deliberately free of any static renderer import: the shell
// fetches the engine on demand through a dynamic import (see ./core-loader), so a bundler keeps it
// out of this module's initial load. For a synchronous build see ./standalone (the CDN entry) or
// import ./renderer directly.
export * from "./config/model";
export { parseHex, toHex, normalizeColor } from "./util/color";
export type { RGB } from "./util/color";
// Explicit, not `export *`, so createOrbImpl (which the standalone build uses to avoid bundling the
// dynamic-import path) stays off the public surface.
export { createOrb, mountOrb } from "./shell/createOrb";
// Exported because every consumer that wants "only upgrade on a GPU" would otherwise hand-roll the
// same WEBGL_debug_renderer_info read, and getting it wrong fails silently.
export { probeWebGL, isSoftwareRenderer, hasWebGL } from "./shell/probe";
export type {
  OrbOptions,
  OrbHandle,
  OrbPhase,
  FallbackReason,
  SnapshotOptions,
  PosterFit,
} from "./shell/createOrb";
// Type-only (erased at build time) so consumers can type `onReady(renderer)`.
export type { OrbRenderer, OrbRendererOptions, SetStateOptions } from "./renderer/OrbRenderer";

export * from "./weather/index";
