import { defineConfig } from "tsdown";

// @orb3d/react: a single ESM entry with types. react and @orb3d/core stay external (peers).
export default defineConfig({
  entry: ["src/index.tsx"],
  format: "esm",
  dts: true,
  sourcemap: true,
  deps: {
    neverBundle: ["react", "react/jsx-runtime", "@orb3d/core", /^@orb3d\/core\//],
  },
  platform: "browser",
  target: "es2022",
  outDir: "dist",
});
