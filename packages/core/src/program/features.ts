import { dialLayout, type OrbConfig } from "../config/model";

/** Static shader capabilities. Slot 3.w carries the subset active in the current frame. */
export const FEATURES = {
  rain: 1,
  snow: 2,
  fog: 4,
  sunny: 8,
  mist: 16,
  reflection: 32,
  halo: 64,
  shadow: 128,
  blur: 256,
  dispersion: 512,
  post: 1024,
  bounce: 2048,
  rim: 4096,
  highlight: 8192,
  glint: 16384,
  outline: 32768,
  rainDrops: 65536,
  snowFlakes: 131072,
  sunnyRays: 262144,
  sunnyFlare: 524288,
  sunnySparkle: 1048576,
  clouds: 2097152,
  atmosphere: 4194304,
  lightning: 8388608,
  ice: 16777216,
  air: 67108864,
  hail: 134217728,
} as const;
export type Feature = keyof typeof FEATURES;

/** Inspect every state, not just the opening one. Reactivity is a potential non-zero input. */
export function programFeatures(
  config: OrbConfig,
  states: Record<string, { dials: readonly number[] }>,
): number {
  const { offset } = dialLayout(config.contents.type);
  const variants = Object.values(states);
  const positive = (...keys: string[]): boolean =>
    variants.some(({ dials }) => keys.some((key) => dials[offset[key]!]! > 0));
  // Switches cut immediately, while numeric dials can still be arriving from a disabled state.
  // Keep those transient combinations too: an enabled state and a nonzero state may differ.
  const weather = (name: string, ...keys: string[]): boolean =>
    variants.some(({ dials }) => dials[offset[`weather.${name}.enabled`]!]! > 0.5) &&
    (keys.length === 0 ||
      variants.some(({ dials }) =>
        keys.some((key) => dials[offset[`weather.${name}.${key}`]!]! > 0),
      ));
  let bits = 0;
  const add = (name: Feature, present: boolean): void => {
    if (present) bits |= FEATURES[name];
  };
  // These have persistent deposits; amount zero can still leave water/ice to finish draining.
  add("rain", weather("rain"));
  add("snow", weather("snow"));
  add("rainDrops", (bits & FEATURES.rain) !== 0);
  add("snowFlakes", (bits & FEATURES.snow) !== 0 || weather("hail"));
  add("fog", weather("fog", "amount", "react"));
  add("sunny", weather("sunny", "amount", "react"));
  add("mist", weather("rain", "mist"));
  for (const [name, dial] of [
    ["sunnyRays", "rays"],
    ["sunnyFlare", "flare"],
    ["sunnySparkle", "sparkle"],
  ] as const) {
    add(name, (bits & FEATURES.sunny) !== 0 && positive(`weather.sunny.${dial}`));
  }

  add("clouds", weather("clouds", "coverage"));
  add("atmosphere", weather("atmosphere", "amount"));
  add("lightning", weather("lightning", "amount"));
  add("ice", weather("ice"));
  add(
    "air",
    weather("air", "amount") &&
      (weather("rain", "density") ||
        (weather("snow", "amount", "react") && weather("snow", "density")) ||
        (weather("hail", "amount") && weather("hail", "density"))),
  );
  add("hail", weather("hail"));
  add("reflection", positive("glass.reflection"));
  add("halo", positive("halo.amount", "react.halo"));
  add("shadow", positive("shadow.amount"));
  add("blur", positive("glass.frost") || (bits & FEATURES.fog) !== 0);
  add("dispersion", positive("glass.dispersion"));
  add(
    "post",
    variants.some(
      ({ dials }) =>
        dials[offset["post.saturation"]!] !== 1 || dials[offset["post.exposure"]!] !== 1,
    ),
  );
  for (const name of ["bounce", "rim", "highlight", "glint", "outline"] as const)
    add(name, positive(`glass.${name}`));
  return bits;
}
