import { describe, expect, it } from "vitest";
import { AdaptiveResolution } from "./adaptive";

function frames(controller: AdaptiveResolution, ms: number, seconds: number, side = 640): void {
  for (let time = 0; time < seconds * 1000; time += ms) controller.sample(ms, side);
}

describe("adaptive live resolution", () => {
  it("responds to sustained pressure, respects its floor and recovers slowly", () => {
    const controller = new AdaptiveResolution();
    frames(controller, 40, 1);
    expect(controller.scale).toBe(0.85);
    frames(controller, 40, 12);
    expect(controller.scale).toBe(0.5);
    frames(controller, 1000 / 60, 4.2);
    expect(controller.scale).toBeCloseTo(0.55);
    frames(controller, 1000 / 60, 40);
    expect(controller.scale).toBeCloseTo(1);
  });

  it("keeps small avatars sharp and ignores isolated stalls and background gaps", () => {
    const controller = new AdaptiveResolution();
    frames(controller, 40, 20, 192);
    expect(controller.scale).toBe(1);
    controller.sample(80, 640);
    frames(controller, 1000 / 60, 1);
    expect(controller.scale).toBe(1);
    controller.sample(2000, 640);
    frames(controller, 1000 / 60, 1);
    expect(controller.scale).toBe(1);
  });

  it("enforces a 192-pixel shorter-side floor after resizing", () => {
    const controller = new AdaptiveResolution();
    frames(controller, 40, 20, 256);
    expect(controller.scale).toBe(0.75);
    expect(controller.sample(40, 128)).toBe(true);
    expect(controller.scale).toBe(1);
  });
});
