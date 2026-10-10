/** Live resolution follows sustained frame pressure, with slower recovery to avoid oscillation. */
export class AdaptiveResolution {
  scale = 1;
  #elapsed = 0;
  #frames = 0;
  #healthy = 0;

  reset(): void {
    this.#elapsed = this.#frames = this.#healthy = 0;
  }

  sample(frameMs: number, shortSide: number): boolean {
    const minimum = Math.min(1, Math.max(0.5, 192 / Math.max(1, shortSide)));
    if (this.scale < minimum) {
      this.scale = minimum;
      this.reset();
      return true;
    }
    // Small avatars stay sharp. Long background/resize gaps are not performance samples.
    if (minimum === 1 || !Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 200) {
      this.reset();
      return false;
    }
    this.#elapsed += frameMs;
    this.#frames++;
    if (this.#elapsed < 1000) return false;
    const average = this.#elapsed / this.#frames;
    this.#healthy = average < 18 ? this.#healthy + this.#elapsed : 0;
    this.#elapsed = this.#frames = 0;
    if (average > 23) {
      const next = Math.max(minimum, this.scale * 0.85);
      if (next === this.scale) return false;
      this.scale = next;
      return true;
    }
    if (this.#healthy >= 4000 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.05);
      this.#healthy = 0;
      return true;
    }
    return false;
  }
}
