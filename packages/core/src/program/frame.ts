import { getDialValue, type OrbConfig } from "../config/model";

export interface OrbFrame {
  radius: number;
  x: number;
  y: number;
}
/** Fit the visible effect tail (below 1/1024 alpha) and shadow, in y-up canvas coordinates. */
export function effectFrame(
  width: number,
  height: number,
  size: number,
  halo: number,
  spread: number,
  shadow: number,
  caustic = 0,
): OrbFrame {
  const glow = halo > 1 / 1024 ? 1 + spread * Math.sqrt(Math.log(halo * 1024) / 3) : 1;
  const shade = shadow > 1 / 1024 ? Math.sqrt(Math.log(shadow * 1024) / 2.5) : 0;
  const focus = shadow > 0 && caustic > 1 / 1024 ? Math.sqrt(Math.log(caustic * 1024) / 2.5) : 0;
  const side = Math.max(1, glow, shade * 0.8, focus * 0.32);
  const top = Math.max(1, glow),
    bottom = Math.max(1, glow, 1 + Math.max(shade * 0.15, focus * 0.06));
  const radius = Math.max(1, Math.min(width / (2 * side), height / (top + bottom)) * size);
  return { radius, x: width / 2, y: height / 2 + (radius * (bottom - top)) / 2 };
}
export function orbFrame(
  config: OrbConfig,
  width: number,
  height: number,
  state = config.state,
  level = 0,
): OrbFrame {
  const read = (key: string): number =>
    Number(getDialValue(config.states[state], key) ?? getDialValue(config, key));
  return effectFrame(
    width,
    height,
    config.size,
    read("halo.amount") + read("react.halo") * level,
    read("halo.radius"),
    read("shadow.amount"),
    read("shadow.caustic"),
  );
}
