// The dynamic-import target for the shell. The `.` entry's `createOrb` reaches the renderer through
// `import("./core-loader")`, so a bundler code-splits the engine out of the initial load: the
// drop-in component ships a tiny shell and fetches the engine only when an orb actually upgrades.
// The standalone/CDN build imports this statically instead.
export { OrbRenderer } from "./renderer/OrbRenderer";
export { createDefaultConfig } from "./config/model";
