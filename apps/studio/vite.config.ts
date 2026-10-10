import { defineConfig, type Plugin } from "vite";

// The HTML carries authoring notes nobody reading the built page needs, so the build drops them.
function stripHtmlComments(): Plugin {
  return {
    name: "strip-html-comments",
    apply: "build",
    transformIndexHtml: (html) => html.replace(/<!--[\s\S]*?-->/g, ""),
  };
}

// public/ holds the @orb3d/core standalone runtime, which `ensure-standalone` copies in (the embed
// exporter fetches /orb3d.standalone.js and inlines it into the downloaded page). The copy is
// gitignored; see scripts/ensure-standalone.mjs.
export default defineConfig({
  base: "/",
  publicDir: "public",
  plugins: [stripHtmlComments()],
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
