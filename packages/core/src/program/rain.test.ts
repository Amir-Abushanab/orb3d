import { describe, expect, it } from "vitest";
import { ensureOrbConfig, type Drop } from "../config/model";
import { PRESETS } from "../presets";
import { compileOrb } from "./compile";
import {
  RAIN_TRAILS,
  RAIN_TRAIL_SLOTS,
  copyRain,
  createRain,
  rainTo,
  stepRain,
  writeRain,
  type RainData,
} from "./rain";
import { OrbRuntime } from "./runtime";

function fixture(drops: Drop[]) {
  const program = compileOrb(
    ensureOrbConfig({
      rain: {
        amount: 1,
        mist: 0,
        density: 0,
        run: 1,
        spawn: 0,
        direction: 0,
        angle: 0,
        lens: 0.36,
        shade: "#000000",
        drops,
        beads: [],
      },
    }),
  );
  return { program, dials: program.states[program.state]!.dials, rain: createRain(program) };
}
function volume(r: number) {
  return r * r * r;
}
function water(rain: RainData) {
  return rain.goal.reduce((sum, radius) => sum + volume(radius), rain.film);
}

function runoffDistance(run: number): number {
  const runtime = new OrbRuntime(
    compileOrb({
      weather: {
        rain: { amount: 1, density: 0, run, drops: [[0, 0.6, 0.075, 0]], beads: [] },
      },
      states: { idle: {} },
    }),
  );
  const start = runtime.snapshot().rain.y[0]!;
  for (let i = 0; i < 60; i++) runtime.advance(1 / 60);
  return start - runtime.snapshot().rain.y[0]!;
}

describe("spherical rain", () => {
  it.each([-65, 0, 65])(
    "drains dense rain with gravity under %s° crosswind without a giant collector",
    (wind) => {
      const program = compileOrb({
        weather: {
          gravity: 0,
          wind,
          windSpeed: 12,
          gusts: 20,
          turbulence: 0.45,
          rain: { enabled: true, density: 1, size: 1.8, run: 1.8, spawn: 0.5 },
        },
        states: { idle: {} },
      });
      const dials = program.states.idle!.dials;
      const rain = createRain(program);
      let largest = 0,
        detached = false;
      for (let k = 0; k < 1800; k++) {
        const before = [...rain.live];
        stepRain(rain, program, dials, (k + 1) / 60, 1.8);
        for (let i = 0; i < rain.live.length; i++) {
          detached ||= rain.live[i] === 3;
          if (rain.live[i] !== 1) continue;
          largest = Math.max(largest, rain.goal[i]!);
          if (before[i] === 1) expect(rain.y[i]!).toBeLessThanOrEqual(rain.py[i]! + 0.00001);
        }
      }
      expect(largest).toBeLessThan(0.18);
      expect(detached).toBe(true);
    },
  );
  it("makes maximum runoff visibly faster while zero runoff leaves the drop pinned", () => {
    expect(runoffDistance(0)).toBe(0);
    const normal = runoffDistance(1);
    const fast = runoffDistance(3);
    expect(fast).toBeGreaterThan(1);
    expect(fast).toBeGreaterThan(normal * 2.5);
  });

  it("keeps resting water still when the rain clock is stopped", () => {
    const program = compileOrb(PRESETS.sunset());
    const rain = createRain(program);
    const n = program.static[(program.rain.counts - program.staticSlot) * 4]!;
    expect(rain.live.slice(0, n)).toEqual(Array.from({ length: n }, () => 1));
    expect(rain.untouched.slice(0, n)).toEqual(Array.from({ length: n }, () => 1));
    expect(rain.count.every((count) => count === 0)).toBe(true);
    const runtime = new OrbRuntime(program, "idle");
    const start = Array.from(runtime.write(100, 100));
    runtime.seek(600);
    // The rain clock stays stopped in idle, so its dynamic slots remain exact too.
    const end = Array.from(runtime.write(100, 100));
    expect(
      end.slice(program.rain.pool * 4, (program.rain.trails + RAIN_TRAILS * RAIN_TRAIL_SLOTS) * 4),
    ).toEqual(
      start.slice(
        program.rain.pool * 4,
        (program.rain.trails + RAIN_TRAILS * RAIN_TRAIL_SLOTS) * 4,
      ),
    );
  });
  it("is reproducible across seeks and frame subdivisions", () => {
    const program = compileOrb(PRESETS.storm());
    const a = new OrbRuntime(program, "thinking");
    const b = new OrbRuntime(program, "thinking");
    a.seek(3);
    b.seek(1);
    b.seek(3);
    expect(Array.from(a.write(100, 100))).toEqual(Array.from(b.write(100, 100)));
    const dials = program.states.thinking!.dials;
    const one = createRain(program),
      many = createRain(program);
    rainTo(one, program, dials, 3, 1000);
    for (let i = 1; i <= 180; i++) rainTo(many, program, dials, i / 60, 1000);
    expect(many).toEqual(one);
  });
  it("follows a meridian outward above the equator and inward below it", () => {
    const { program, dials, rain } = fixture([[0.4, 0.65, 0.09, 1]]);
    const longitude = rain.x[0]! / rain.z[0]!;
    let widest = rain.x[0]!;
    for (let k = 0; k < 180; k++) {
      stepRain(rain, program, dials);
      if (rain.live[0] !== 1) break;
      expect(rain.x[0]! / rain.z[0]!).toBeCloseTo(longitude, 10);
      expect(rain.x[0]! ** 2 + rain.y[0]! ** 2 + rain.z[0]! ** 2).toBeCloseTo(1, 12);
      widest = Math.max(widest, rain.x[0]!);
    }
    expect(widest).toBeGreaterThan(0.48);
    expect(rain.y[0]!).toBeLessThan(0);
    expect(rain.x[0]!).toBeLessThan(widest);
  });
  it("pins small drops and accelerates larger ones on steeper latitudes", () => {
    const small = fixture([[0.2, 0.1, 0.018, 0]]);
    for (let k = 0; k < 120; k++) stepRain(small.rain, small.program, small.dials);
    expect(small.rain.untouched[0]).toBe(1);
    const upper = fixture([[0, 0.93, 0.08, 1]]);
    const middle = fixture([[0, 0.1, 0.08, 1]]);
    for (let k = 0; k < 15; k++) {
      stepRain(upper.rain, upper.program, upper.dials);
      stepRain(middle.rain, middle.program, middle.dials);
    }
    expect(Math.abs(middle.rain.vy[0]!)).toBeGreaterThan(Math.abs(upper.rain.vy[0]!));
  });
  it("merges only at surface contact, conserving volume and pulling sideways", () => {
    const { program, dials, rain } = fixture([
      [0, 0.3, 0.08, 1],
      [0.035, 0.1, 0.025, 0],
    ]);
    let merged = false;
    let approach = 0;
    for (let k = 0; k < 500 && !merged; k++) {
      const before = water(rain);
      stepRain(rain, program, dials);
      merged = rain.live[1] === 2;
      if (!merged) {
        approach = Math.hypot(rain.vx[0]!, rain.vy[0]!, rain.vz[0]!);
      } else {
        // A shed bead is a separate volume in the same pool.
        const total = water(rain);
        expect(total).toBeCloseTo(before, 12);
        expect(rain.goal[1]).toBeGreaterThan(0);
        expect(rain.joinx[0]!).toBeGreaterThan(0);
        expect(rain.pair.slice(0, 2)).toEqual([1, 0]);
        expect(rain.hold[0]).toBeGreaterThanOrEqual(3);
        const speed = Math.hypot(rain.vx[0]!, rain.vy[0]!, rain.vz[0]!);
        expect(speed).toBeGreaterThan(approach * 0.5);
        expect(speed).toBeLessThan(approach * 0.8);
        const contact = [rain.x[1], rain.y[1], rain.z[1]];
        const headY = rain.y[0]!;
        stepRain(rain, program, dials);
        expect(Math.hypot(rain.vx[0]!, rain.vy[0]!, rain.vz[0]!)).toBeGreaterThan(speed * 0.8);
        for (let s = 0; s < 5; s++) stepRain(rain, program, dials);
        expect([rain.x[1], rain.y[1], rain.z[1]]).toEqual(contact);
        expect(rain.y[0]!).toBeLessThan(headY);
        expect(rain.vx[0]!).toBeGreaterThan(0);
      }
    }
    expect(merged).toBe(true);
  });
  it.each([
    [
      "equal",
      [
        [-0.048, 0.1, 0.05, 0],
        [0.048, 0.1, 0.05, 0],
      ],
    ],
    [
      "bead",
      [
        [0, 0.1, 0.06, 0],
        [0.073, 0.1, 0.018, 0],
      ],
    ],
    [
      "glancing",
      [
        [0, 0.1, 0.05, 0],
        [0.063, 0.165, 0.045, 0],
      ],
    ],
    [
      "rim",
      [
        [0.82, 0.1, 0.035, 0],
        [0.853, 0.1, 0.032, 0],
      ],
    ],
  ] as [string, Drop[]][])(
    "keeps both %s lobes during neck growth and conserves their water",
    (_, drops) => {
      const { program, dials, rain } = fixture(drops);
      const total = water(rain);

      stepRain(rain, program, dials);
      const head = rain.live.findIndex((live, i) => live === 1 && rain.pair[i]! >= 0);
      expect(head).toBeGreaterThanOrEqual(0);
      const donor = rain.pair[head]!;
      const donorRadius = rain.radius0[donor]!;
      const contact = [rain.x[donor], rain.y[donor], rain.z[donor]];
      const out = new Float32Array(program.slots * 4);
      rain.frac = 1;
      writeRain(rain, program, out);
      const neckAt = (program.rain.pool + head * 2) * 4 + 3;
      const neck = out[neckAt]!;
      stepRain(rain, program, dials);
      writeRain(rain, program, out);
      // The neck widens before the donor loses any water or opacity.
      expect(out[neckAt]).toBeGreaterThan(neck * 2);
      expect(rain.goal[donor]).toBeCloseTo(donorRadius, 12);
      let visibleFrames = 0;
      for (let s = 0; s < 20; s++) {
        stepRain(rain, program, dials);
        expect(water(rain)).toBeCloseTo(total, 12);
        if (rain.live[donor] === 2) {
          visibleFrames++;
          expect([rain.x[donor], rain.y[donor], rain.z[donor]]).toEqual(contact);
          if (rain.phase[head]! >= 0.3)
            expect(volume(rain.r[0]!) + volume(rain.r[1]!) + rain.film).toBeCloseTo(total, 9);
        } else break;
      }
      expect(visibleFrames).toBeGreaterThanOrEqual(8);
      expect(rain.live[donor]).toBe(0);
      expect(rain.pair.slice(0, 2)).toEqual([-1, -1]);
      expect(
        Math.hypot(rain.x[0]! - rain.x[1]!, rain.y[0]! - rain.y[1]!, rain.z[0]! - rain.z[1]!),
      ).toBeGreaterThan(0.02);
    },
  );
  it("catches immediately at contact, hesitates before draining, and then releases", () => {
    const { program, dials, rain } = fixture([
      [0, 0.2, 0.075, 1],
      [0.045, 0.095, 0.024, 0],
    ]);
    rain.vy[0] = -0.006;
    rain.vz[0] = (0.006 * rain.y[0]!) / rain.z[0]!;
    rain.stretch[0] = 0.9;
    rain.shed.fill(1000);
    const anchor = [rain.x[1], rain.y[1], rain.z[1]];
    const initial = water(rain);
    let approach = Math.hypot(rain.vx[0]!, rain.vy[0]!, rain.vz[0]!);
    for (let k = 0; k < 12 && rain.pair[0]! < 0; k++) {
      approach = Math.hypot(rain.vx[0]!, rain.vy[0]!, rain.vz[0]!);
      stepRain(rain, program, dials);
    }
    expect(rain.live[1]).toBe(2);
    const caught = Math.hypot(rain.vx[0]!, rain.vy[0]!, rain.vz[0]!);
    expect(caught).toBeLessThan(approach * 0.85);
    expect(caught).toBeGreaterThan(approach * 0.5);
    stepRain(rain, program, dials);
    // The initial shape/adhesion response precedes loss of the smaller lobe's water.
    expect(rain.goal[1]).toBe(rain.radius0[1]);
    let slowest = caught;
    for (let k = 0; k < 2; k++) {
      stepRain(rain, program, dials);
      slowest = Math.min(slowest, Math.hypot(rain.vx[0]!, rain.vy[0]!, rain.vz[0]!));
    }
    expect(slowest).toBeLessThan(caught * 0.75);
    for (let k = 0; k < 7; k++) stepRain(rain, program, dials);
    expect(Math.hypot(rain.vx[0]!, rain.vy[0]!, rain.vz[0]!)).toBeGreaterThan(slowest * 1.2);
    expect([rain.x[1], rain.y[1], rain.z[1]]).toEqual(anchor);
    expect(water(rain)).toBeCloseTo(initial, 12);
  });
  it("queues a third contact while a pair integrates, without losing or duplicating water", () => {
    const { program, dials, rain } = fixture([
      [0, 0.1, 0.055, 0],
      [-0.07, 0.1, 0.025, 0],
      [0.067, 0.1, 0.025, 0],
    ]);
    const total = water(rain);
    stepRain(rain, program, dials);
    expect(rain.live.slice(0, 3)).toEqual([1, 2, 1]);
    expect(rain.pair[2]).toBe(-1);
    let second = false;
    for (let k = 0; k < 60; k++) {
      stepRain(rain, program, dials);
      expect(water(rain)).toBeCloseTo(total, 12);
      second ||= rain.live[2] === 2;
      for (let i = 0; i < 3; i++) {
        const partner = rain.pair[i]!;
        if (partner >= 0) expect(rain.pair[partner]).toBe(i);
      }
    }
    expect(second).toBe(true);
    expect(rain.live.slice(0, 3)).toEqual([1, 0, 0]);
  });
  it("keeps contact timing readable when runoff runs three times faster", () => {
    const { program, dials, rain } = fixture([
      [-0.025, 0.1, 0.03, 0],
      [0.025, 0.1, 0.03, 0],
    ]);
    rainTo(rain, program, dials, 0.3, 1000, 0.1);
    expect(rain.live[1]).toBe(2);
    expect(rain.goal[1]).toBeGreaterThan(0.015);
    rainTo(rain, program, dials, 0.9, 1000, 0.3);
    expect(rain.live[1]).toBe(0);
  });
  it("finishes an arriving lobe's growth continuously when it contacts existing water", () => {
    const { program, dials, rain } = fixture([
      [0, 0.1, 0.06, 0],
      [0.04, 0.1, 0.018, 0],
    ]);
    rain.r[0] = 0.03;
    rain.r[1] = 0.012;
    stepRain(rain, program, dials);
    expect(rain.live[1]).toBe(2);
    const start = rain.r[0]!;
    stepRain(rain, program, dials);
    expect(rain.r[0]!).toBeGreaterThan(start);
    expect(rain.r[0]!).toBeLessThan(start + 0.006);
    expect(rain.r[1]!).toBeLessThan(0.016);
    for (let k = 0; k < 20; k++) stepRain(rain, program, dials);
    expect(rain.live[1]).toBe(0);
    expect(Math.abs(rain.r[0]! - rain.goal[0]!)).toBeLessThan(rain.goal[0]! * 0.005);
  });
  it("does not absorb visually separated drops near the rim", () => {
    const { program, dials, rain } = fixture([
      [0.88, 0, 0.025, 0],
      [0.91, 0, 0.025, 0],
    ]);
    stepRain(rain, program, dials);
    expect(rain.live.slice(0, 2)).toEqual([1, 1]);
  });
  it("lets a smaller running drop carry a larger pinned contact forward", () => {
    const { program, dials, rain } = fixture([
      [0, 0.18, 0.035, 1],
      [0.055, 0.08, 0.07, 0],
    ]);
    rain.vy[0] = -0.006;
    rain.vz[0] = (0.006 * rain.y[0]!) / rain.z[0]!;
    rain.stretch[0] = 1;
    stepRain(rain, program, dials);
    expect(rain.pair.slice(0, 2)).toEqual([1, 0]);
    expect(rain.live.slice(0, 2)).toEqual([1, 2]);
    const anchor = [rain.x[1], rain.y[1], rain.z[1]];
    const head = rain.y[0]!;
    for (let k = 0; k < 6; k++) stepRain(rain, program, dials);
    expect([rain.x[1], rain.y[1], rain.z[1]]).toEqual(anchor);
    expect(rain.y[0]!).toBeLessThan(head);
    expect(rain.vx[0]!).toBeGreaterThan(0);
  });
  it("deposits an uneven film while the running body shrinks and still water keeps its volume", () => {
    const { program, dials, rain } = fixture([[0.2, 0.65, 0.1, 1]]);
    rain.shed[0] = 1000;
    const initial = water(rain);
    const rates: number[] = [];
    for (let k = 0; k < 140 && rain.live[0] === 1; k++) {
      const before = volume(rain.goal[0]!);
      stepRain(rain, program, dials);
      expect(water(rain)).toBeCloseTo(initial, 12);
      const speed = Math.hypot(rain.vx[0]!, rain.vy[0]!, rain.vz[0]!);
      if (speed > 0.001) rates.push((before - volume(rain.goal[0]!)) / before / speed);
    }
    expect(rain.film).toBeGreaterThan(initial * 0.12);
    expect(rain.goal[0]!).toBeLessThan(0.096);
    expect(Math.max(...rates) / Math.min(...rates)).toBeGreaterThan(2);
    const resting = fixture([[0.2, 0.1, 0.018, 0]]);
    for (let k = 0; k < 120; k++) stepRain(resting.rain, resting.program, resting.dials);
    expect(resting.rain.film).toBe(0);
    expect(resting.rain.goal[0]).toBe(Math.fround(0.018));
  });
  it("relaxes the moving footprint and preserves smooth sub-step deformation", () => {
    const { program, dials, rain } = fixture([[0, 0.4, 0.085, 1]]);
    rain.shed[0] = 1000;
    for (let k = 0; k < 70; k++) stepRain(rain, program, dials);
    expect(rain.stretch[0]).toBeGreaterThan(0.8);
    const out = new Float32Array(program.slots * 4);
    rain.frac = 1;
    writeRain(rain, program, out);
    const shape = out[program.rain.pool * 4 + 2]! - 1;
    expect(Math.floor(shape / 4096) / 4095).toBeGreaterThan(0.8);
    const angle = ((shape % 4096) / 4095) * Math.PI * 2 - Math.PI;
    expect(Math.sin(angle)).toBeLessThan(-0.98);
    const previous = rain.stretch[0]!;
    rain.vx[0] = 0;
    rain.vy[0] = 0;
    rain.vz[0] = 0;
    rain.stick[0] = 100;
    stepRain(rain, program, dials);
    expect(rain.stretch[0]!).toBeLessThan(previous);
    expect(rain.stretch[0]!).toBeGreaterThan(previous * 0.75);
    const frames: number[] = [];
    for (let frame = 0; frame <= 16; frame++) {
      rain.frac = frame / 16;
      writeRain(rain, program, out);
      frames.push(Math.floor((out[program.rain.pool * 4 + 2]! - 1) / 4096) / 4095);
    }
    // High-refresh frames must not reuse the same 5-bit silhouette and then pop to the next.
    expect(new Set(frames).size).toBe(frames.length);
    expect(Math.max(...frames.slice(1).map((v, i) => Math.abs(v - frames[i]!)))).toBeLessThan(
      0.006,
    );
  });
  it("turns the silhouette gradually after a sudden sideways momentum change", () => {
    const { program, dials, rain } = fixture([[0, 0.4, 0.085, 1]]);
    rain.shed[0] = 1000;
    for (let k = 0; k < 35; k++) stepRain(rain, program, dials);
    const before = rain.heading[0]!;
    rain.vx[0] = 0.006;
    rain.vy[0] = -0.002;
    stepRain(rain, program, dials);
    const velocity = Math.atan2(rain.vy[0]!, rain.vx[0]!);
    expect(rain.heading[0]!).toBeGreaterThan(before);
    expect(rain.heading[0]! - before).toBeLessThan((velocity - before) * 0.1);
    const out = new Float32Array(program.slots * 4);
    const angles: number[] = [];
    for (let k = 0; k <= 8; k++) {
      rain.frac = k / 8;
      writeRain(rain, program, out);
      angles.push((((out[program.rain.pool * 4 + 2]! - 1) % 4096) / 4095) * Math.PI * 2 - Math.PI);
    }
    expect(new Set(angles).size).toBe(angles.length);
    expect(Math.max(...angles.slice(1).map((a, i) => Math.abs(a - angles[i]!)))).toBeLessThan(
      0.015,
    );
  });
  it("detaches at the south pole and replenishes rain without returning to the old mark", () => {
    const { program, dials, rain } = fixture([[0.2, 0.3, 0.09, 1]]);
    dials[program.rain.spawn] = 1;
    let detached = false,
      renewed = false;
    for (let k = 0; k < 1600; k++) {
      stepRain(rain, program, dials);
      detached ||= rain.live[0] === 3;
      renewed ||= detached && rain.y[0]! > 0.8;
    }
    expect(detached).toBe(true);
    expect(renewed).toBe(true);
    expect(rain.untouched[0]).toBe(0);
  });
  it("leaves sparse residual beads of different sizes across the wet footprint", () => {
    const { program, dials, rain } = fixture([[0.2, 0.75, 0.12, 1]]);
    const beads: { size: number; offset: number }[] = [];
    for (let k = 0; k < 400 && rain.live[0] === 1; k++) {
      const previous = [...rain.live];
      const total = water(rain);
      stepRain(rain, program, dials);
      expect(water(rain)).toBeCloseTo(total, 12);
      for (let i = 16; i < rain.live.length; i++) {
        if (previous[i] === 0 && rain.live[i] === 1) {
          beads.push({
            size: rain.r[i]!,
            offset: Math.abs(rain.x[i]! * rain.z[0]! - rain.z[i]! * rain.x[0]!),
          });
        }
      }
    }
    expect(beads.length).toBeGreaterThanOrEqual(2);
    expect(beads.length).toBeLessThan(10);
    const sizes = beads.map((bead) => bead.size);
    expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(1.3);
    expect(beads.some((bead) => bead.offset > 0.001)).toBe(true);
  });
  it("fills the glass with much more rain at maximum density", () => {
    const low = fixture([]),
      high = fixture([]);
    low.dials[low.program.rain.density] = 0.25;
    high.dials[high.program.rain.density] = 1;
    for (let k = 0; k < 600; k++) {
      stepRain(low.rain, low.program, low.dials);
      stepRain(high.rain, high.program, high.dials);
    }
    const population = (rain: typeof low.rain) => rain.live.filter((live) => live === 1).length;
    expect(population(high.rain)).toBeGreaterThan(100);
    expect(population(high.rain)).toBeGreaterThan(population(low.rain) * 4);
  });
  it("scatters new rain across all four quadrants by default", () => {
    const { program, dials, rain } = fixture([]);
    dials[program.rain.density] = 1;
    const quadrants = [0, 0, 0, 0];
    const ys: number[] = [];
    for (let k = 0; k < 100; k++) {
      const previous = [...rain.live];
      stepRain(rain, program, dials);
      for (let i = 16; i < rain.live.length; i++) {
        if (previous[i] !== 0 || rain.live[i] === 0) continue;
        const x = rain.px[i]!,
          y = rain.py[i]!;
        quadrants[(x < 0 ? 1 : 0) + (y < 0 ? 2 : 0)]!++;
        ys.push(y);
      }
    }
    expect(quadrants.every((count) => count > 15)).toBe(true);
    expect(Math.abs(ys.reduce((sum, y) => sum + y, 0) / ys.length)).toBeLessThan(0.15);
  });
  it.each([0, 90, -90, 180, 45])(
    "retains flow-aligned arrivals in legacy %s° programs",
    (direction) => {
      const { program, dials, rain } = fixture([]);
      delete program.rain.angle;
      dials[program.rain.density] = 1;
      dials[program.rain.spawn] = 1;
      dials[program.rain.direction] = direction;
      const gx = Math.sin((direction * Math.PI) / 180),
        gy = -Math.cos((direction * Math.PI) / 180);
      let arrivals = 0;
      for (let k = 0; k < 50; k++) {
        const previous = [...rain.live];
        stepRain(rain, program, dials);
        for (let i = 16; i < rain.live.length; i++) {
          if (previous[i] !== 0 || rain.live[i] !== 1) continue;
          expect(rain.px[i]! * gx + rain.py[i]! * gy).toBeLessThanOrEqual(-0.82);
          arrivals++;
        }
      }
      expect(arrivals).toBeGreaterThan(50);
    },
  );
  it.each([-60, 0, 60])("places incoming rain at %s° independently of gravity", (angle) => {
    const { program, dials, rain } = fixture([]);
    dials[program.rain.density] = 1;
    dials[program.rain.spawn] = 1;
    dials[program.rain.angle!] = angle;
    dials[program.rain.direction] = 90;
    const ax = Math.sin((angle * Math.PI) / 180),
      ay = -Math.cos((angle * Math.PI) / 180);
    let arrivals = 0;
    for (let k = 0; k < 40; k++) {
      const previous = [...rain.live];
      stepRain(rain, program, dials);
      for (let i = 16; i < rain.live.length; i++) {
        if (previous[i] !== 0 || rain.live[i] === 0) continue;
        expect(rain.px[i]! * ax + rain.py[i]! * ay).toBeLessThanOrEqual(-0.82);
        arrivals++;
      }
    }
    expect(arrivals).toBeGreaterThan(40);
  });
  it.each([-60, 60])("carries a brief lateral impact from %s° rain", (angle) => {
    const { program, dials, rain } = fixture([]);
    dials[program.rain.density] = 1;
    dials[program.rain.angle!] = angle;
    let checked = 0;
    for (let k = 0; k < 20; k++) {
      const previous = [...rain.live];
      stepRain(rain, program, dials);
      for (let i = 16; i < rain.live.length; i++) {
        if (
          previous[i] !== 0 ||
          rain.live[i] !== 1 ||
          Math.abs(rain.px[i]!) > 0.5 ||
          Math.abs(rain.py[i]!) > 0.5
        )
          continue;
        expect(rain.vx[i]! * Math.sign(angle)).toBeGreaterThan(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
  it("leaves already attached water under the same gravity when wind changes", () => {
    const still = fixture([[0.1, 0.4, 0.09, 1]]),
      windy = fixture([[0.1, 0.4, 0.09, 1]]);
    windy.dials[windy.program.rain.angle!] = 60;
    for (let k = 0; k < 60; k++) {
      stepRain(still.rain, still.program, still.dials);
      stepRain(windy.rain, windy.program, windy.dials);
    }
    expect(windy.rain).toEqual(still.rain);
  });
  it("dissipates the arrival impulse and bends the path back downward", () => {
    const { program, dials, rain } = fixture([[0, 0.35, 0.09, 1]]);
    dials[program.rain.angle!] = 60;
    rain.shed[0] = 1000;
    rain.vx[0] = 0.006;
    rain.vy[0] = -0.003;
    rain.vz[0] = (0.003 * rain.y[0]!) / rain.z[0]!;
    for (let k = 0; k < 30; k++) stepRain(rain, program, dials);
    expect(Math.abs(rain.vx[0]!)).toBeLessThan(0.003);
    expect(rain.vy[0]!).toBeLessThan(-0.003);
  });
  it.each([0, 90, -90, 180, 45])("runs along the sphere in a %s° direction", (direction) => {
    const { program, dials, rain } = fixture([[0, 0, 0.1, 1]]);
    dials[program.rain.direction] = direction;
    rain.shed[0] = 1000;
    const gx = Math.sin((direction * Math.PI) / 180),
      gy = -Math.cos((direction * Math.PI) / 180);
    for (let k = 0; k < 60; k++) {
      stepRain(rain, program, dials);
      expect(rain.x[0]! ** 2 + rain.y[0]! ** 2 + rain.z[0]! ** 2).toBeCloseTo(1, 12);
      expect(-rain.x[0]! * gy + rain.y[0]! * gx).toBeCloseTo(0, 10);
    }
    expect(rain.x[0]! * gx + rain.y[0]! * gy).toBeGreaterThan(0.25);
    expect(rain.count.some((count) => count > 1)).toBe(true);
  });
  it.each([90, -90, 180])("detaches and clears the downstream edge at %s°", (direction) => {
    const gx = Math.sin((direction * Math.PI) / 180),
      gy = -Math.cos((direction * Math.PI) / 180);
    const { program, dials, rain } = fixture([[gx * 0.97, gy * 0.97, 0.09, 1]]);
    dials[program.rain.direction] = direction;
    stepRain(rain, program, dials);
    expect(rain.live[0]).toBe(3);
    expect(rain.vx[0]! * gx + rain.vy[0]! * gy).toBeCloseTo(0.006, 12);
    for (let k = 0; k < 40; k++) stepRain(rain, program, dials);
    expect(rain.live[0]).toBe(0);
  });
  it.each([90, -90])("chooses the downstream resting lobe during a %s° contact", (direction) => {
    const { program, dials, rain } = fixture([
      [-0.018, 0, 0.02, 0],
      [0.018, 0, 0.02, 0],
    ]);
    dials[program.rain.direction] = direction;
    stepRain(rain, program, dials);
    expect(rain.live.slice(0, 2)).toEqual(direction === 90 ? [2, 1] : [1, 2]);
  });
  it("archives full paths without dropping or refreshing their wet tails", () => {
    const { program, dials, rain } = fixture([[0.15, 0.75, 0.09, 1]]);
    let chunk = -1;
    for (let k = 0; k < 300 && chunk < 0; k++) {
      stepRain(rain, program, dials);
      chunk = rain.owner.findIndex((owner, i) => owner === -1 && rain.count[i] === 12);
    }
    expect(chunk).toBeGreaterThanOrEqual(0);
    const path = rain.path.slice(chunk * 24, (chunk + 1) * 24);
    const stamps = rain.stamp.slice(chunk * 12, (chunk + 1) * 12);
    for (let k = 0; k < 120; k++) stepRain(rain, program, dials);
    expect(rain.path.slice(chunk * 24, (chunk + 1) * 24)).toEqual(path);
    expect(rain.stamp.slice(chunk * 12, (chunk + 1) * 12)).toEqual(stamps);
    const done = rain.done;
    const time = rain.time;
    rainTo(rain, program, dials, done / 60, 1000, time + 3);
    expect(rain.done).toBe(Math.floor((time + 3) * 60 + 1e-3));
    expect(rain.time).toBe(time + 3);
    const out = new Float32Array(program.slots * 4);
    writeRain(rain, program, out);
    const at = (program.rain.trails + chunk * RAIN_TRAIL_SLOTS) * 4;
    expect(Array.from(out.slice(at + 12, at + 24))).toEqual(stamps.map(Math.fround));
  });
  it("snapshots do not share state and interpolation stays between adjacent steps", () => {
    const { program, dials, rain } = fixture([[0.2, 0.3, 0.09, 1]]);
    for (let k = 0; k < 20; k++) stepRain(rain, program, dials);
    const saved = copyRain(rain);
    rain.frac = 0.5;
    const out = new Float32Array(program.slots * 4);
    writeRain(rain, program, out);
    const code = out[program.rain.pool * 4]!;
    const x = (Math.floor(code / 4096) / 4095) * 2.4 - 1.2;
    expect(x).toBeCloseTo((rain.x[0]! + rain.px[0]!) / 2, 3);
    stepRain(rain, program, dials);
    expect(saved.done).toBe(20);
    expect(saved.x).not.toEqual(rain.x);
  });
});
