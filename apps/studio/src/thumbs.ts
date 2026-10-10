/**
 * Thumbnails for the version history: each version's orb, in its opening state, as it starts.
 *
 * One hidden, small OrbRenderer draws them all, one after another: a WebGL context per thumbnail
 * would run into the browser's cap on live contexts long before a timeline is full. They are drawn
 * only when a row scrolls into view, because a timeline can hold eighty versions and most are
 * never looked at.
 */

import type { OrbConfig } from "@orb3d/core";
import { OrbRenderer } from "@orb3d/core/renderer";

/** Twice the row's thumbnail, so a 2× screen is not upscaling it, and no larger. */
const SIZE = 56;
/** How long a version's picture or clip may take to load before it is drawn without one. */
const MEDIA_WAIT_MS = 2500;

export class HistoryThumbnailer {
  readonly #getConfig: (id: number) => OrbConfig | null;
  readonly #cache = new Map<number, string>();
  readonly #waiting = new Map<number, Array<(url: string | null) => void>>();
  readonly #queue: number[] = [];
  #running = false;
  #host?: HTMLDivElement;
  #renderer?: OrbRenderer;

  /** `getConfig` hands back a copy this may change. */
  constructor(getConfig: (id: number) => OrbConfig | null) {
    this.#getConfig = getConfig;
  }

  cached(id: number): string | undefined {
    return this.#cache.get(id);
  }

  /** The thumbnail for a version, drawn if need be; `done` gets its data URL, or null. */
  request(id: number, done: (url: string | null) => void): void {
    const hit = this.#cache.get(id);
    if (hit !== undefined) {
      done(hit);
      return;
    }
    const waiting = this.#waiting.get(id);
    if (waiting) {
      waiting.push(done);
      return;
    }
    this.#waiting.set(id, [done]);
    this.#queue.push(id);
    void this.#pump();
  }

  async #pump(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      while (this.#queue.length > 0) {
        const id = this.#queue.shift()!;
        let url: string | null = null;
        try {
          url = await this.#draw(id);
        } catch (error) {
          console.warn("[orb studio] a version's thumbnail failed:", error);
        }
        if (url) {
          this.#cache.set(id, url);
          // Ids from dropped versions linger here; past a generous ceiling, forget the oldest.
          if (this.#cache.size > 240) this.#cache.delete(this.#cache.keys().next().value!);
        }
        const callbacks = this.#waiting.get(id) ?? [];
        this.#waiting.delete(id);
        for (const done of callbacks) done(url);
        // Let the page breathe between thumbnails.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      this.#running = false;
    }
  }

  async #draw(id: number): Promise<string | null> {
    const stored = this.#getConfig(id);
    if (!stored) return null;
    // The host is sized in the exact pixels wanted, so no device pixel ratio on top.
    const config: OrbConfig = { ...stored, dprMax: 1, quality: 1, paused: true };
    if (!this.#host) {
      this.#host = document.createElement("div");
      this.#host.style.cssText = `position:fixed;left:-10000px;top:0;width:${SIZE}px;height:${SIZE}px;pointer-events:none;`;
      document.body.append(this.#host);
    }
    if (this.#renderer) this.#renderer.setConfig(config);
    else {
      // Never started, so it draws only when asked; reduced motion must not hold it on a blank frame.
      this.#renderer = new OrbRenderer(this.#host, config, {
        preserveDrawingBuffer: true,
        respectReducedMotion: false,
      });
    }
    const renderer = this.#renderer;
    for (let waited = 0; renderer.mediaLoading && waited < MEDIA_WAIT_MS; waited += 50) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // The opening state at its first frame: what a poster of this version would show.
    renderer.setState(config.state, { immediate: true });
    renderer.seek(0);
    const out = document.createElement("canvas");
    out.width = renderer.canvas.width;
    out.height = renderer.canvas.height;
    out.getContext("2d")?.drawImage(renderer.canvas, 0, 0);
    return out.toDataURL("image/webp", 0.85);
  }
}
