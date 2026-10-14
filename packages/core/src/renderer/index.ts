// `@orb3d/core/renderer`: the engine itself, for a consumer that wants no shell and no poster;
// OrbGL draws a compiled orb on a WebGL2 context of your own, such as a worker's OffscreenCanvas.
export { OrbRenderer } from "./OrbRenderer";
export type { OrbRendererOptions, SetStateOptions } from "./OrbRenderer";
export { OrbGL } from "./gl";
export { bendPoint, bendRadius, unbendRadius } from "./lens";
