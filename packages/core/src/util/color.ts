/** An sRGB colour, each channel 0–1. Colours are authored and blended in display space, as SVG
 *  does, so a config reads the same in the studio, in a poster and in the live orb. */
export type RGB = [number, number, number];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** `#rgb`, `#rrggbb` or `#rrggbbaa` (alpha ignored) to channels, or null if it is not hex. */
export function parseHex(value: string): RGB | null {
  const match = HEX.exec(value.trim());
  if (!match) return null;
  let hex = match[1]!;
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
}

/** Channels to `#rrggbb`, clamped. */
export function toHex(rgb: readonly number[]): string {
  return (
    "#" +
    [0, 1, 2]
      .map((i) =>
        Math.round(Math.min(1, Math.max(0, rgb[i] ?? 0)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/** A colour config value as `#rrggbb`, or the fallback when it does not parse. */
export function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const rgb = parseHex(value);
  return rgb ? toHex(rgb) : fallback;
}
