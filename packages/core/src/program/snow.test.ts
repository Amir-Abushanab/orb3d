import { describe, expect, it } from "vitest";
import { ensureOrbConfig } from "../config/model";
import { compileOrb } from "./compile";
import { OrbRuntime } from "./runtime";
import { createRain, RAIN_DROPS, RAIN_TRAIL_SLOTS } from "./rain";
import { createSnow, snowTo, type SnowData } from "./snow";

function fixture(snow: Record<string, number> = {}) {
  const program = compileOrb(
    ensureOrbConfig({ snow: { amount: 1, ...snow } as never, states: { idle: {} } }),
  );
  return { program, dials: program.states.idle!.dials, snow: createSnow() };
}
function mass(s: SnowData): number {
  return s.ice.reduce(
    (sum, value, i) => sum + value + s.water[i]!,
    s.escaped + s.evaporated + s.film,
  );
}
function place(s: SnowData, i: number, x: number, y: number, r: number, ice: number) {
  s.live[i] = 2;
  s.id[i] = i + 1;
  s.x[i] = x;
  s.px[i] = x;
  s.y[i] = y;
  s.py[i] = y;
  s.radius[i] = r;
  s.pradius[i] = r;
  s.ice[i] = r ** 3 * ice;
  s.water[i] = r ** 3 * (1 - ice);
  s.phase[i] = ice;
  s.pphase[i] = ice;
  s.age[i] = 1;
  s.supplied += r ** 3;
}

describe("snow on glass", () => {
  it("keeps identities unique and conserves ice plus water through accumulation and runoff", () => {
    const { program, dials, snow } = fixture({ density: 1, melt: 0.5 });
    for (let time = 0.25; time <= 60; time += 0.25) {
      snowTo(snow, program.snow, dials, time, 120);
      const ids = snow.id.filter((_, i) => snow.live[i]! > 0);
      expect(new Set(ids).size).toBe(ids.length);
      expect(mass(snow)).toBeCloseTo(snow.supplied, 10);
    }
    expect(snow.serial).toBeGreaterThan(64);
  });
  it("preserves frozen ice and still lets it land when melting is zero", () => {
    const { program, dials, snow } = fixture({ melt: 0, stick: 1 });
    snowTo(snow, program.snow, dials, 15, 900);
    expect(snow.live.some((v) => v === 2)).toBe(true);
    expect(snow.water.every((v) => v === 0)).toBe(true);
    expect(mass(snow)).toBeCloseTo(snow.supplied, 10);
  });
  it("melts landed ice into retained water even while snowfall is stopped", () => {
    const { program, dials, snow } = fixture({ amount: 0, fall: 0, melt: 1 });
    place(snow, 0, 0, 0.3, 0.04, 1);
    const before = snow.supplied;
    snowTo(snow, program.snow, dials, 6, 360);
    expect(snow.ice[0]).toBe(0);
    expect(snow.water[0]).toBeGreaterThan(0);
    expect(snow.radius[0]).toBeGreaterThan(0.039);
    expect(snow.radius[0]).toBeLessThanOrEqual(0.04);
    expect(mass(snow)).toBeCloseTo(before, 12);
  });
  it("keeps separated deposits apart, then transfers contacting water gradually without attraction", () => {
    const { program, dials, snow } = fixture({ amount: 0, melt: 0, stick: 1 });
    place(snow, 0, 0, 0.3, 0.06, 0);
    place(snow, 1, 0.2, 0.3, 0.04, 0);
    snowTo(snow, program.snow, dials, 1 / 60, 1);
    expect(snow.live[1]).toBe(2);
    expect(snow.x[1]).toBeGreaterThan(0.199);
    snow.x[1] = 0.031;
    snowTo(snow, program.snow, dials, 2 / 60, 1);
    expect(snow.live[1]).toBe(3);
    const small = snow.water[1]!;
    const position = snow.x[1]!;
    snowTo(snow, program.snow, dials, 3 / 60, 1);
    expect(snow.water[1]).toBeLessThan(small);
    expect(snow.water[1]).toBeGreaterThan(small * 0.9);
    expect(snow.x[1]).toBe(position);
    expect(mass(snow)).toBeCloseTo(snow.supplied, 12);
  });
  it("steers incoming arrivals with wind while leaving existing ice anchored", () => {
    const { program, dials, snow } = fixture({ angle: 55, dispersion: 0, melt: 0, stick: 1 });
    place(snow, 63, 0.4, -0.2, 0.04, 1);
    snowTo(snow, program.snow, dials, 2, 120);
    const incoming = snow.live.findIndex((v) => v === 1);
    expect(incoming).toBeGreaterThanOrEqual(0);
    expect(snow.incomingX[incoming]).toBeGreaterThan(0.8);
    expect(snow.incomingY[incoming]).toBeLessThan(-0.5);
    expect(snow.x[63]).toBe(0.4);
    expect(snow.y[63]).toBe(-0.2);
  });
  it("collects contacting deposits downhill even when the upper deposit is larger", () => {
    for (const angle of [0, 90, -90, 180]) {
      const { program, dials, snow } = fixture({ amount: 0, melt: 0, stick: 1 });
      dials[program.snow.gravity] = angle;
      const gx = Math.sin((angle * Math.PI) / 180),
        gy = -Math.cos((angle * Math.PI) / 180);
      place(snow, 0, -gx * 0.014, -gy * 0.014, 0.06, 0);
      place(snow, 1, gx * 0.014, gy * 0.014, 0.04, 0);
      snowTo(snow, program.snow, dials, 1 / 60, 1);
      expect(snow.pair[0]).toBe(1);
      expect(snow.live[0]).toBe(3);
      const water = snow.water[1]!;
      snowTo(snow, program.snow, dials, 2 / 60, 1);
      expect(snow.water[1]).toBeGreaterThan(water);
      expect(snow.x[1]! * gx + snow.y[1]! * gy).toBeGreaterThan(0.014);
      expect(mass(snow)).toBeCloseTo(snow.supplied, 12);
    }
  });
  it("writes interpolated rain trails for downhill meltwater while rain is stopped", () => {
    const { program, snow } = fixture({ density: 0, melt: 0 });
    program.states.idle!.dials[program.clocks[0]![0]] = 0;
    const runtime = new OrbRuntime(program),
      snapshot = runtime.snapshot();
    place(snow, 0, 0.2, 0.4, 0.08, 0);
    snapshot.snow = snow;
    runtime.restore(snapshot);
    for (let i = 0; i < 241; i++) runtime.advance(1 / 120);
    const saved = runtime.snapshot(),
      slot = saved.rain.owner.indexOf(RAIN_DROPS);
    expect(saved.clock[1]).toBe(0);
    expect(saved.snow.y[0]).toBeLessThan(0.4);
    expect(saved.snow.film).toBeGreaterThan(0);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(saved.rain.source[slot]).toBe(-2);
    const uniforms = runtime.write(128, 128),
      at = (program.rain.trails + slot * RAIN_TRAIL_SLOTS) * 4;
    const y = ((uniforms[at]! % 4096) / 4095) * 2.4 - 1.2;
    expect(y).toBeCloseTo((saved.snow.py[0]! + saved.snow.y[0]!) / 2, 3);
    expect(uniforms[at + 26]).toBeGreaterThanOrEqual(2);
    const stamps = [...saved.rain.stamp];
    saved.snow.live[0] = 0;
    runtime.restore(saved);
    runtime.advance(1 / 60);
    const released = runtime.snapshot();
    expect(released.rain.owner[slot]).toBe(-1);
    expect(released.rain.stamp[slot * 12 + 1]).toBe(stamps[slot * 12]);
    const headStamp = released.rain.stamp[slot * 12]!;
    runtime.advance(9);
    expect(runtime.snapshot().rain.stamp[slot * 12]).toBe(headStamp);
    expect(runtime.snapshot().clock[0]! - headStamp).toBeGreaterThan(8);
    runtime.restore(saved);
    expect(Array.from(runtime.write(128, 128))).toEqual(Array.from(uniforms));
  });
  it("does not wipe fog with dry, stationary ice", () => {
    const { program, dials, snow } = fixture({ amount: 0, melt: 0, stick: 1 });
    const rain = createRain(program);
    place(snow, 0, 0.2, 0.4, 0.08, 1);
    snowTo(snow, program.snow, dials, 4, 240, 0, rain);
    expect(rain.count.every((count) => count === 0)).toBe(true);
    expect(snow.film).toBe(0);
    expect(snow.y[0]).toBe(0.4);
  });
  it("compacts touching ice without transporting separated meltwater pockets", () => {
    const { program, dials, snow } = fixture({ amount: 0, melt: 0, stick: 1 });
    place(snow, 0, 0, 0.3, 0.06, 0.7);
    place(snow, 1, 0.052, 0.3, 0.04, 0.7);
    const pocket = snow.water[1]!;
    snowTo(snow, program.snow, dials, 1 / 60, 1);
    expect(snow.live[1]).toBe(3);
    const frozen = snow.ice[1]!;
    snowTo(snow, program.snow, dials, 2 / 60, 1);
    expect(snow.ice[1]).toBeLessThan(frozen);
    expect(snow.water[1]).toBe(pocket);
    expect(mass(snow)).toBeCloseTo(snow.supplied, 12);
  });
  it("replays deterministically across frame rates and restores capture snapshots", () => {
    const { program } = fixture();
    const fine = new OrbRuntime(program),
      coarse = new OrbRuntime(program);
    for (let i = 0; i < 360; i++) fine.advance(1 / 60);
    for (let i = 0; i < 180; i++) coarse.advance(1 / 30);
    const a = fine.snapshot().snow,
      b = coarse.snapshot().snow;
    expect({ ...a, frac: 0 }).toEqual({ ...b, frac: 0 });
    expect(a.frac).toBeCloseTo(b.frac, 10);
    const snap = fine.snapshot();
    const uniforms = Array.from(fine.write(128, 128));
    fine.seek(20);
    fine.restore(snap);
    expect(Array.from(fine.write(128, 128))).toEqual(uniforms);
    const before = fine.snapshot().snow;
    fine.setProgram(compileOrb(ensureOrbConfig({ snow: { amount: 1, melt: 0.8 } as never })));
    expect(fine.snapshot().snow).toEqual(before);
  });
});
