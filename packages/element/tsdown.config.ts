import { defineConfig } from "tsdown";

// @orb3d/element: a single ESM entry with types. @orb3d/core stays external.
export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  dts: true,
  sourcemap: true,
  deps: { neverBundle: ["@orb3d/core", /^@orb3d\/core\//] },
  platform: "browser",
  target: "es2022",
  outDir: "dist",
});
