import { defineConfig } from "tsdown";

// The publishable @orb3d/core build: one output module per source module (unbundled), so the
// dynamic import of ./core-loader stays a separate chunk and the engine stays out of the shell.
// The single-file CDN build is separate, see vite.standalone.config.ts.
export default defineConfig({
  entry: [
    "src/index.ts",
    "src/renderer/index.ts",
    // An orb as data, for other platforms: compile, runtime and the shader in every dialect.
    "src/program/index.ts",
    "src/presets.ts",
    // Included ONLY for its .d.ts: the ./standalone export's `default` points at the vite
    // single-file build (which emits no types) while its `types` points here. The dist/standalone.js
    // tsdown emits alongside is reachable through no export subpath, an unused byproduct of
    // dts emission, not a public entry.
    "src/standalone.ts",
  ],
  format: "esm",
  dts: true,
  sourcemap: true,
  unbundle: true,
  platform: "browser",
  target: "es2022",
  outDir: "dist",
});
