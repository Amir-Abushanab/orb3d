import { defineConfig } from "tsdown";

// @orb3d/react-native: a single ESM entry with types. React Native, Skia, Reanimated and
// @orb3d/core stay external; Metro resolves them in the app, and the app's worklets Babel plugin
// turns the runtime's worklet functions in @orb3d/core into UI-thread code.
export default defineConfig({
  entry: ["src/index.tsx"],
  format: "esm",
  dts: true,
  sourcemap: true,
  deps: {
    neverBundle: [
      "react",
      "react/jsx-runtime",
      "react-native",
      "@shopify/react-native-skia",
      "react-native-skia",
      "react-native-reanimated",
      "react-native-worklets",
      "@orb3d/core",
      /^@orb3d\/core\//,
    ],
  },
  platform: "neutral",
  target: "es2022",
  outDir: "dist",
});
