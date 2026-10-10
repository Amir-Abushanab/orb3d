import { normalizeColor, parseHex, toHex, type RGB } from "../util/color";

export interface ColorStop {
  position: number;
  color: string;
}
export interface MeshPoint {
  x: number;
  y: number;
  color: string;
  influence: number;
}
export type GradientType = "linear" | "radial" | "conic" | "mesh";
export interface GradientColor {
  type: GradientType;
  /** Clockwise from up, in degrees. Point coordinates are 0–1, y up. */
  angle: number;
  center: [number, number];
  scale: number;
  stops: ColorStop[];
  points: MeshPoint[];
  softness: number;
}
/** Solid hex colours remain valid; a gradient can be used at any colour dial. */
export type ColorValue = string | GradientColor;
export const COLOR_POINTS = 8;

const unit = (v: unknown, fallback: number, lo = 0, hi = 1): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export function gradientColor(type: GradientType, color = "#ff8a46"): GradientColor {
  return {
    type,
    angle: 0,
    center: [0.5, 0.5],
    scale: 1,
    softness: 0.7,
    stops: [
      { position: 0, color },
      { position: 1, color: "#6f8bff" },
    ],
    points: [
      { x: 0.18, y: 0.8, color, influence: 0.65 },
      { x: 0.82, y: 0.8, color: "#ffd2a8", influence: 0.65 },
      { x: 0.18, y: 0.2, color: "#6f8bff", influence: 0.65 },
      { x: 0.82, y: 0.2, color: "#e2486a", influence: 0.65 },
    ],
  };
}

export function normalizeFill(value: unknown, fallback: ColorValue = "#000000"): ColorValue {
  if (typeof value === "string")
    return parseHex(value) ? normalizeColor(value, "#000000") : structuredClone(fallback);
  if (!value || typeof value !== "object" || Array.isArray(value)) return structuredClone(fallback);
  const src = value as Record<string, unknown>;
  if (!["linear", "radial", "conic", "mesh"].includes(String(src.type)))
    return structuredClone(fallback);
  const base = gradientColor(src.type as GradientType, fillHex(fallback));
  const stops = (Array.isArray(src.stops) ? src.stops : base.stops)
    .slice(0, COLOR_POINTS)
    .filter((v) => v && typeof v === "object")
    .map((v: ColorStop) => ({
      position: unit(v.position, 0),
      color: normalizeColor(v.color, "#000000"),
    }));
  stops.sort((a, b) => a.position - b.position);
  const points = (Array.isArray(src.points) ? src.points : base.points)
    .slice(0, COLOR_POINTS)
    .filter((v) => v && typeof v === "object")
    .map((v: MeshPoint) => ({
      x: unit(v.x, 0.5),
      y: unit(v.y, 0.5),
      color: normalizeColor(v.color, "#000000"),
      influence: unit(v.influence, 0.65, 0.05, 1.5),
    }));
  return {
    type: base.type,
    angle: unit(src.angle, 0, -180, 180),
    center: Array.isArray(src.center)
      ? [unit(src.center[0], 0.5), unit(src.center[1], 0.5)]
      : [0.5, 0.5],
    scale: unit(src.scale, 1, 0.05, 4),
    softness: unit(src.softness, 0.7),
    stops: stops.length >= 2 ? stops : base.stops,
    points: points.length >= 2 ? points : base.points,
  };
}

function linear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function srgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** Shared preview/reference sampler. Mesh weighting matches wave3d's picker in linear RGB. */
export function sampleFill(fill: ColorValue, x = 0.5, y = 0.5): RGB {
  if (typeof fill === "string") return parseHex(fill) ?? [0, 0, 0];
  if (fill.type === "mesh") {
    const col = [0, 0, 0];
    let sum = 0;
    const exponent = 4.8 + (1.35 - 4.8) * fill.softness;
    for (const p of fill.points) {
      const distance = Math.hypot(x - p.x, y - p.y) / Math.max(0.05, p.influence);
      const w = 1 / (Math.max(distance, 0.012) ** exponent + 0.002);
      const rgb = parseHex(p.color) ?? [0, 0, 0];
      for (let c = 0; c < 3; c++) col[c]! += linear(rgb[c]!) * w;
      sum += w;
    }
    return col.map((c) => srgb(c / Math.max(sum, 0.0001))) as RGB;
  }
  const angle = (fill.angle * Math.PI) / 180,
    dx = x - fill.center[0],
    dy = y - fill.center[1];
  let t =
    fill.type === "linear"
      ? 0.5 + (dx * Math.sin(angle) + dy * Math.cos(angle)) / fill.scale
      : fill.type === "radial"
        ? (Math.hypot(dx, dy) * 2) / fill.scale
        : ((((Math.atan2(dx, dy) - angle) / (2 * Math.PI)) % 1) + 1) % 1;
  t = Math.min(1, Math.max(0, t));
  let previous = fill.stops[0]!;
  for (const next of fill.stops.slice(1)) {
    if (t <= next.position) {
      const a = parseHex(previous.color)!,
        b = parseHex(next.color)!;
      const mix = Math.min(
        1,
        Math.max(0, (t - previous.position) / Math.max(0.00001, next.position - previous.position)),
      );
      return a.map((v, i) => v + (b[i]! - v) * mix) as RGB;
    }
    previous = next;
  }
  return parseHex(previous.color)!;
}
export function fillHex(fill: ColorValue): string {
  return typeof fill === "string" ? fill : toHex(sampleFill(fill));
}

export function skyFill(stops: [number, string][]): GradientColor {
  return {
    ...gradientColor("linear"),
    stops: stops.map(([position, color]) => ({ position, color })),
  };
}

/** Legacy sky stop reads stay available without duplicating the canonical gradient in JSON. */
export function skyColorAliases<T extends { color: ColorValue; stops: [number, string][] }>(
  sky: T,
): T {
  Object.defineProperty(sky, "stops", {
    configurable: true,
    enumerable: false,
    get: () => {
      if (typeof sky.color !== "string" && sky.color.type === "linear") {
        const stops: [number, string][] = sky.color.stops.map((s) => [s.position, s.color]);
        if (stops.length > 6) stops.splice(5, stops.length - 6);
        while (stops.length < 6) stops.push([...stops.at(-1)!]);
        return stops;
      }
      return Array.from({ length: 6 }, (_, i): [number, string] => [
        i / 5,
        toHex(sampleFill(sky.color, 0.5, i / 5)),
      ]);
    },
    set: (stops: [number, string][]) => {
      sky.color = skyFill(stops);
    },
  });
  return sky;
}
