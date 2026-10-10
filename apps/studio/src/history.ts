/**
 * Undo and redo as a timeline of versions.
 *
 * The whole document is one plain-JSON config (and the preset it came from), so a version is a
 * deep clone, and going back to one reuses main.ts's apply path. This class owns only the
 * timeline, the cursor and the bookkeeping of commits; it holds no reference to the renderer or
 * the panel.
 *
 * A linear list of entries with a cursor at the current version. Editing with the cursor behind
 * the newest entry drops the versions ahead of it. The history popover renders `getState()` and
 * jumps to any entry by its stable id.
 *
 * Coalescing is what makes it usable: dragging a slider fires a change every frame, and a version
 * per frame would bury the timeline. `markDirty` debounces, and main.ts flushes when the pointer
 * comes up, so one gesture is one version.
 *
 * The same timeline as Wave Studio's and Materials Studio's, for an orb.
 */

import { CONTENTS, dialsFor, getDialValue, type Dial, type OrbConfig } from "@orb3d/core";

/** One version in the timeline. */
interface Entry {
  id: number;
  /** The timeline's own clone, with any large string swapped for a reference (see MediaStore).
   *  Nothing hands it out without cloning it and putting the strings back. */
  config: OrbConfig;
  /** Cached, so the no-change check never serializes a stored entry again. */
  fingerprint: string;
  /** What the version did, for the list ("glass frost", "thinking: sun y", "preset aura"). */
  label: string;
  /** The preset the picker shows when this version is restored. */
  presetName: string;
  time: number;
}

/** What going back to a version hands main.ts. */
export interface Restored {
  config: OrbConfig;
  presetName: string;
}

/** The timeline, as the history popover draws it. */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  entries: Array<{ id: number; label: string; time: number; current: boolean }>;
}

export interface HistoryDeps {
  /** The live config. Replaced on every change; never capture it. */
  getLive: () => OrbConfig;
  /** The current preset's name, tagged onto a commit. */
  getPresetName: () => string;
  /** Fired whenever the timeline or the cursor moves, so the controls can redraw. */
  onChange: () => void;
}

/** How long a cleared timeline can be brought back, in ms. The toast offering it lasts as long. */
export const CLEAR_UNDO_MS = 4000;

/** Strings shorter than this travel inside the clone; longer ones are held once, out of line. A
 *  hosted URL is well under it; a picture picked from disk, as a data URL, is far over it. */
const INLINE_LIMIT = 2048;
const REF_PREFIX = "orb3d-media#";

/** The contents fields that can hold a string the size of a file: a picture or clip's source, and
 *  a shader's code. */
const LARGE_KEYS = ["src", "code"] as const;

type Large = Record<(typeof LARGE_KEYS)[number], unknown>;

/**
 * Out-of-line storage for the strings a contents can carry that are the size of a file.
 *
 * A picture picked from disk is a data URL of up to a megabyte and a half. Deep-cloned into every
 * version, serialized for every fingerprint and diff, and kept eighty times over, it would make
 * the timeline the heaviest thing in the studio. Held once here instead, under a short reference
 * the versions carry; strings are immutable, so handing the same one back on a restore copies
 * nothing.
 */
class MediaStore {
  readonly #payloads = new Map<string, string>();
  readonly #refs = new Map<string, string>();
  #next = 1;

  /** The short reference standing for one payload, minted the first time it is seen. */
  #ref(payload: string): string {
    let ref = this.#refs.get(payload);
    if (!ref) {
      ref = `${REF_PREFIX}${this.#next++}`;
      this.#refs.set(payload, ref);
      this.#payloads.set(ref, payload);
    }
    return ref;
  }

  /**
   * A copy of `config` with any large string swapped for a reference. Copies only the spine (the
   * top level and the contents), never a payload, and leaves the caller's config as it was.
   */
  intern(config: OrbConfig): OrbConfig {
    const contents = config.contents as unknown as Large;
    let swapped: Large | null = null;
    for (const key of LARGE_KEYS) {
      const value = contents[key];
      if (typeof value !== "string" || value.length < INLINE_LIMIT) continue;
      swapped ??= { ...contents };
      swapped[key] = this.#ref(value);
    }
    return swapped ? { ...config, contents: swapped as unknown as OrbConfig["contents"] } : config;
  }

  /** Put the payloads back, in place. */
  resolve(config: OrbConfig): OrbConfig {
    const contents = config.contents as unknown as Large;
    for (const key of LARGE_KEYS) {
      const value = contents[key];
      if (typeof value === "string" && value.startsWith(REF_PREFIX)) {
        contents[key] = this.#payloads.get(value);
      }
    }
    return config;
  }

  /** Drop every payload no version refers to any more. */
  prune(held: Iterable<OrbConfig>): void {
    const used = new Set<string>();
    for (const config of held) {
      const contents = config.contents as unknown as Large;
      for (const key of LARGE_KEYS) {
        const value = contents[key];
        if (typeof value === "string" && value.startsWith(REF_PREFIX)) used.add(value);
      }
    }
    for (const [ref, payload] of this.#payloads) {
      if (used.has(ref)) continue;
      this.#payloads.delete(ref);
      this.#refs.delete(payload);
    }
  }
}

function fingerprint(config: OrbConfig): string {
  return JSON.stringify(config);
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A dial as the list names it: its label, with its group in front where another dial shares
 *  the label ("frost", but "halo colour" and "shadow colour"). */
function dialName(dial: Dial, dials: readonly Dial[]): string {
  const label = dial.label.toLowerCase();
  const shared = dials.some((other) => other !== dial && other.label === dial.label);
  return shared ? `${dial.group.toLowerCase()} ${label}` : label;
}

/** The contents fields that are not dials, by what the list calls them. */
const STRUCTURE: Record<string, string> = {
  src: "source",
  fit: "fit",
  code: "shader code",
};

/** What the canvas fields are called in the list. */
const SETTINGS: Record<string, string> = {
  size: "size",
  background: "background",
  quality: "quality",
  dprMax: "pixel ratio",
  transition: "transition",
  level: "level smoothing",
  state: "opening state",
  paused: "paused",
};

/**
 * The best name for a manual edit: the first thing that differs between two versions, as the
 * panel labels it. Discrete actions (a preset, a state added) pass their own label instead.
 */
export function describeChange(prev: OrbConfig, next: OrbConfig): string {
  const type = next.contents.type;
  if (prev.contents.type !== type) return `contents ${CONTENTS[type].label.toLowerCase()}`;
  const dials = dialsFor(type);
  for (const dial of dials) {
    if (!same(getDialValue(prev, dial.key), getDialValue(next, dial.key))) {
      return dialName(dial, dials);
    }
  }
  for (const [key, name] of Object.entries(STRUCTURE)) {
    if (!same(getDialValue(prev.contents, key), getDialValue(next.contents, key))) return name;
  }
  const names = new Set([...Object.keys(prev.states), ...Object.keys(next.states)]);
  for (const name of names) {
    const before = prev.states[name];
    const after = next.states[name];
    if (same(before, after)) continue;
    if (!before) return `add ${name}`;
    if (!after) return `delete ${name}`;
    for (const dial of dials) {
      if (!same(getDialValue(before, dial.key), getDialValue(after, dial.key))) {
        return `${name}: ${dialName(dial, dials)}`;
      }
    }
    if (before.duration !== after.duration) return `${name}: transition`;
  }
  for (const [key, name] of Object.entries(SETTINGS)) {
    const k = key as keyof OrbConfig;
    if (!same(prev[k], next[k])) return name;
  }
  return "edit";
}

export class History {
  #entries: Entry[] = [];
  #cursor = -1;
  #nextId = 1;
  #dirty = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  readonly #media = new MediaStore();
  /** The timeline the last clear() replaced, so undoClear() can put it back, once. */
  #cleared?: { entries: Entry[]; cursor: number };
  #clearTimer: ReturnType<typeof setTimeout> | undefined;
  readonly #deps: HistoryDeps;
  readonly #cap: number;
  readonly #delay: number;

  constructor(deps: HistoryDeps, cap = 80, delay = 350) {
    this.#deps = deps;
    this.#cap = cap;
    this.#delay = delay;
  }

  /** Start the timeline over from one version: on opening, or on a shared link. */
  reset(config: OrbConfig, presetName: string, label = presetName): void {
    this.#dropCleared();
    this.#seed(config, presetName, label);
  }

  /** Start over from the live version, keeping the old timeline for {@link CLEAR_UNDO_MS} so
   *  undoClear() can bring it back. Like reset(), but reversible. */
  clear(config: OrbConfig, presetName: string): void {
    this.#cleared = { entries: this.#entries.slice(), cursor: this.#cursor };
    clearTimeout(this.#clearTimer);
    this.#clearTimer = setTimeout(() => this.#dropCleared(), CLEAR_UNDO_MS);
    this.#seed(config, presetName, "cleared");
  }

  /** Bring back the timeline the last clear() replaced. False once that offer has lapsed. */
  undoClear(): boolean {
    const cleared = this.#cleared;
    if (!cleared) return false;
    this.#cleared = undefined;
    clearTimeout(this.#clearTimer);
    this.#cancelTimer();
    this.#dirty = false;
    this.#entries = cleared.entries.slice();
    this.#cursor = cleared.cursor;
    this.#deps.onChange();
    return true;
  }

  /** The live config changed: commit it once the changes stop coming. */
  markDirty(): void {
    this.#dirty = true;
    this.#cancelTimer();
    this.#timer = setTimeout(() => this.flush(), this.#delay);
  }

  isDirty(): boolean {
    return this.#dirty;
  }

  /** Commit a pending edit now; nothing happens if none is pending or nothing changed. */
  flush(): void {
    this.#cancelTimer();
    if (this.#dirty) this.commit(this.#deps.getLive(), this.#deps.getPresetName());
  }

  /**
   * Record `live` as a new version, dropping any versions ahead of the cursor. False if it is the
   * current version already. Without a `label`, one is worked out from what changed.
   */
  commit(live: OrbConfig, presetName: string, label?: string): boolean {
    this.#cancelTimer();
    this.#dirty = false;
    // Interned first, so neither the fingerprint nor the label ever serializes a payload.
    const interned = this.#media.intern(live);
    const print = fingerprint(interned);
    const current = this.#entries[this.#cursor];
    if (current && print === current.fingerprint) return false;
    const name = label ?? (current ? describeChange(current.config, interned) : "edit");
    this.#entries.length = this.#cursor + 1;
    this.#entries.push(this.#entry(interned, print, name, presetName));
    this.#cursor = this.#entries.length - 1;
    let evicted = false;
    while (this.#entries.length > this.#cap) {
      this.#entries.shift();
      this.#cursor--;
      evicted = true;
    }
    if (evicted) this.#media.prune(this.#held());
    this.#deps.onChange();
    return true;
  }

  undo(): Restored | null {
    return this.#cursor <= 0 ? null : this.#goTo(this.#cursor - 1);
  }

  redo(): Restored | null {
    return this.#cursor >= this.#entries.length - 1 ? null : this.#goTo(this.#cursor + 1);
  }

  /** Go to a version by its id; nothing happens if it was dropped. */
  jumpTo(id: number): Restored | null {
    const index = this.#entries.findIndex((entry) => entry.id === id);
    return index < 0 || index === this.#cursor ? null : this.#goTo(index);
  }

  getState(): HistoryState {
    return {
      canUndo: this.#cursor > 0,
      canRedo: this.#cursor < this.#entries.length - 1,
      entries: this.#entries.map((entry, i) => ({
        id: entry.id,
        label: entry.label,
        time: entry.time,
        current: i === this.#cursor,
      })),
    };
  }

  /** A fresh copy of a version's config, payloads back in, safe to change (for its thumbnail);
   *  null for an id it no longer has. */
  getConfig(id: number): OrbConfig | null {
    const entry = this.#entries.find((e) => e.id === id);
    return entry ? this.#media.resolve(structuredClone(entry.config)) : null;
  }

  #seed(config: OrbConfig, presetName: string, label: string): void {
    this.#cancelTimer();
    this.#dirty = false;
    const interned = this.#media.intern(config);
    this.#entries = [this.#entry(interned, fingerprint(interned), label, presetName)];
    this.#cursor = 0;
    this.#media.prune(this.#held());
    this.#deps.onChange();
  }

  #dropCleared(): void {
    clearTimeout(this.#clearTimer);
    if (!this.#cleared) return;
    this.#cleared = undefined;
    this.#media.prune(this.#held());
  }

  /** Every config still holding a reference: the timeline, and one a clear may yet bring back. */
  *#held(): Iterable<OrbConfig> {
    for (const entry of this.#entries) yield entry.config;
    for (const entry of this.#cleared?.entries ?? []) yield entry.config;
  }

  #goTo(index: number): Restored {
    this.#cursor = index;
    this.#dirty = false;
    this.#cancelTimer();
    this.#deps.onChange();
    const entry = this.#entries[index]!;
    // A fresh clone: whatever restores it goes on to change it, and must never change the
    // version the timeline keeps.
    return {
      config: this.#media.resolve(structuredClone(entry.config)),
      presetName: entry.presetName,
    };
  }

  /** `interned` is a shallow copy already free of payloads; the deep clone here is what keeps the
   *  version apart from the live config. */
  #entry(interned: OrbConfig, print: string, label: string, presetName: string): Entry {
    return {
      id: this.#nextId++,
      config: structuredClone(interned),
      fingerprint: print,
      label,
      presetName,
      time: Date.now(),
    };
  }

  #cancelTimer(): void {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
  }
}
