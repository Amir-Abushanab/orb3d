import { describe, expect, it } from "vitest";
import { bendPoint, bendRadius, unbendRadius } from "./lens";

describe("the glass", () => {
  it("leaves the centre and the rim where they are", () => {
    for (const bend of [0, 0.4, 0.7, 0.9]) {
      expect(bendRadius(0, bend)).toBe(0);
      expect(bendRadius(1, bend)).toBeCloseTo(1, 12);
    }
  });

  it("matches the mark's generator", () => {
    // Lens.see(0.18, -0.22) in wordmark.py, divided by the radius and with y turned back up.
    const [x, y] = bendPoint(0.18, -0.22, 0.7);
    const d = Math.hypot(0.18, -0.22);
    const s = (0.3 * d + 0.7 * Math.sin((d * Math.PI) / 2)) / d;
    expect(x).toBeCloseTo(0.18 * s, 12);
    expect(y).toBeCloseTo(-0.22 * s, 12);
    expect(x).toBeGreaterThan(0.18); // magnified toward the middle
  });

  it("inverts exactly across the face", () => {
    for (const bend of [0, 0.3, 0.7, 0.9]) {
      for (let i = 0; i <= 50; i++) {
        const d = i / 50;
        expect(unbendRadius(bendRadius(d, bend), bend)).toBeCloseTo(d, 5);
      }
    }
  });
});
