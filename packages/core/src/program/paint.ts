import { dialsFor, getDialValue, type OrbConfig } from "../config/model";
import { COLOR_POINTS, fillHex, type ColorValue } from "../config/fill";
import { parseHex } from "../util/color";

export const PAINT_PAGE = 1024;
export interface PaintProgram {
  states: string[];
  fields: { key: string; rows: number[] }[];
  pages: number[];
  static: number[];
}
const packed = (hex: string): number => {
  const rgb = parseHex(hex)!;
  return (
    Math.round(rgb[0] * 255) * 65536 + Math.round(rgb[1] * 255) * 256 + Math.round(rgb[2] * 255)
  );
};

/** Gradient definitions are immutable during playback. Only one state-weight vector animates;
 * interrupted transitions blend complete fields without changing mesh topology or packed RGB. */
export function compilePaint(config: OrbConfig, names: string[]): PaintProgram | undefined {
  const fields = dialsFor(config.contents.type)
    .filter((dial) => dial.kind === "color")
    .map(({ key }) => ({
      key,
      values: names.map(
        (name) =>
          (getDialValue(config.states[name], key) ?? getDialValue(config, key)) as ColorValue,
      ),
    }))
    .filter(({ values }) => values.some((value) => typeof value !== "string"));
  if (fields.length === 0) return undefined;
  const values = Array.from({ length: Math.ceil(names.length / 4) * 4 }, () => 0);
  const definitions = new Map<string, number>();
  const rows = fields.map(({ key, values: colors }) => ({
    key,
    rows: colors.map((fill) => {
      const signature = JSON.stringify(fill);
      const exists = definitions.get(signature);
      if (exists !== undefined) return exists;
      const at = values.length / 4;
      definitions.set(signature, at);
      if (typeof fill === "string") {
        values.push(0, ...parseHex(fillHex(fill))!);
        return at;
      }
      values.push(
        ["linear", "radial", "conic", "mesh"].indexOf(fill.type) + 1,
        fill.angle,
        fill.scale,
        fill.center[0],
      );
      const nodes = fill.type === "mesh" ? fill.points : fill.stops;
      values.push(fill.center[1], fill.softness, nodes.length, 0);
      for (let i = 0; i < COLOR_POINTS; i++) {
        const node = nodes[Math.min(i, nodes.length - 1)]!;
        values.push(
          "x" in node ? node.x : node.position,
          "y" in node ? node.y : 0,
          packed(node.color),
          "influence" in node ? node.influence : 1,
        );
      }
      return at;
    }),
  }));
  const slots = values.length / 4;
  if (slots > PAINT_PAGE * 10 || names.length > PAINT_PAGE * 4)
    throw new Error("[orb3d] colour definitions exceed the portable shader budget");
  return {
    states: names,
    fields: rows,
    pages: Array.from({ length: Math.ceil(slots / PAINT_PAGE) }, (_, i) =>
      Math.min(PAINT_PAGE, slots - i * PAINT_PAGE),
    ),
    static: values,
  };
}

/** Shader-layout identity excludes editable values, so dragging a point updates data, not code. */
export function paintKey(paint?: PaintProgram): string {
  return paint
    ? JSON.stringify([
        paint.pages,
        paint.fields,
        paint.fields.map(({ rows }) => rows.map((at) => paint.static[at * 4]! < 0.5)),
      ])
    : "";
}
