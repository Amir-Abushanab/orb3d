// Dials: the numbers and colours a state can move, each addressed by its dotted path in the config
// (`glass.rim`, `contents.sun.y`). Kept apart from the model so the contents, which declare their
// own dials, and the model, which validates them, do not import each other.

/** The panel group a dial is shown under. */
export type DialGroup = string;

/** A dial: a number or colour a state can override, addressed by its dotted path in the config. */
export interface Dial {
  key: string;
  kind: "number" | "color" | "boolean";
  label: string;
  group: DialGroup;
  min?: number;
  max?: number;
  step?: number;
  /** A short explanation of a dial's units or endpoints, shown by control panels. */
  hint?: string;
  /** Set when the dial sits inside an array that only means anything whole, such as the sunset's
   *  sky stops: the path of that array. A state that moves one entry carries the whole array. */
  whole?: string;
}

export function num(
  key: string,
  group: DialGroup,
  label: string,
  min: number,
  max: number,
  step = 0.01,
): Dial {
  return { key, kind: "number", label, group, min, max, step };
}

export function color(key: string, group: DialGroup, label: string): Dial {
  return { key, kind: "color", label, group };
}
export function toggle(key: string, group: DialGroup, label: string): Dial {
  return { key, kind: "boolean", label, group };
}

/** Former top-level weather paths remain valid API aliases. New documents use weather.*. */
export function canonicalDialKey(key: string): string {
  if (key === "rain.direction") return "weather.gravity";
  if (key === "rain.lens") return "weather.water.lens";
  if (key === "rain.shade") return "weather.water.shade";
  if (/^react\.(rain|snow|fog|sunny)$/.test(key)) return `weather.${key.slice(6)}.react`;
  if (/^(rain|snow|fog|sunny)\./.test(key)) return `weather.${key}`;
  return key;
}

/** Channels a dial takes in a packed dial vector: three for a colour. */
export function channels(dial: Dial): number {
  return dial.kind === "color" ? 3 : 1;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The first `length` entries of an array as finite numbers, or null. */
export function tuple(value: unknown, length: number): number[] | null {
  if (!Array.isArray(value) || value.length < length) return null;
  const out = value.slice(0, length).map(Number);
  return out.every(Number.isFinite) ? out : null;
}

/** Read a dotted path (numeric segments index arrays). Undefined when any step is missing. */
export function getDialValue(source: unknown, key: string): unknown {
  const canonical = canonicalDialKey(key);
  if (canonical !== key) {
    const value = getDialValue(source, canonical);
    if (value !== undefined) return value;
  }
  let at: unknown = source;
  for (const part of key.split(".")) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return at ?? undefined;
}

/**
 * Write a dotted path, creating the objects (and arrays, where the next segment is a number) on the
 * way. Writing into an array that only means anything whole (see {@link Dial.whole}) copies the
 * whole array from `base` first, so a state that moves one sky stop does not lose the other five.
 */
export function setDialValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
  base?: object,
  whole?: string,
): void {
  key = canonicalDialKey(key);
  if (whole && base && getDialValue(target, whole) === undefined) {
    const array = getDialValue(base, whole);
    if (Array.isArray(array)) setPath(target, whole, structuredClone(array));
  }
  setPath(target, key, value);
}

function setPath(target: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split(".");
  let at: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const next = at[part];
    if (next === null || typeof next !== "object") {
      at[part] = /^\d+$/.test(parts[i + 1]!) ? [] : {};
    }
    at = at[part] as Record<string, unknown>;
  }
  at[parts.at(-1)!] = value;
}

/**
 * Remove a dotted path from a state override, pruning the blocks it leaves empty. A dial inside a
 * whole array clears the array, so the base's shows through again.
 */
export function clearDialValue(target: Record<string, unknown>, key: string, whole?: string): void {
  key = canonicalDialKey(key);
  const parts = (whole ?? key).split(".");
  const trail: Record<string, unknown>[] = [target];
  for (const part of parts.slice(0, -1)) {
    const next = trail.at(-1)![part];
    if (next === null || typeof next !== "object") return;
    trail.push(next as Record<string, unknown>);
  }
  delete trail.at(-1)![parts.at(-1)!];
  for (let i = trail.length - 1; i > 0; i--) {
    if (Object.keys(trail[i]!).length > 0) break;
    delete trail[i - 1]![parts[i - 1]!];
  }
}
