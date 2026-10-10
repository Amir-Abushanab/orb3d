import { describe, expect, it } from "vitest";
import {
  omegaFor,
  springStep,
  createRuntimeData,
  createUniformBindings,
  writeUniformBindings,
  advanceRuntime,
  setRuntimeMedia,
  setRuntimeState,
} from "./runtime";
import { compileOrb } from "./compile";
import { gradientColor } from "../config/fill";

function run(duration: number, seconds: number, dt = 1 / 60, from = 0, to = 1): number[] {
  const x = new Float32Array([from]);
  const v = new Float32Array([0]);
  const target = new Float32Array([to]);
  const out: number[] = [];
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    springStep(x, v, target, dt, omegaFor(duration));
    out.push(x[0]!);
  }
  return out;
}

describe("reused native uniform bindings", () => {
  it("updates state weights and media without replacing any array or colour definition", () => {
    const program = compileOrb({
      halo: { amount: 1, radius: 0.3, color: gradientColor("linear") },
      states: { idle: {}, speaking: { halo: { color: gradientColor("radial", "#123456") } } },
    });
    const data = createRuntimeData(program);
    const bindings = createUniformBindings(program);
    const buffer = bindings.uData,
      color = bindings.uPaint0,
      media = data.media;
    const definitions = color!.slice(Math.ceil(program.paint!.states.length / 4) * 4);
    setRuntimeState(data, program, "speaking", true);
    for (let frame = 0; frame < 120; frame++) {
      setRuntimeMedia(data, 320, 240);
      advanceRuntime(data, program, 1 / 60);
      writeUniformBindings(data, program, bindings, 96, 96, 2);
    }
    expect(bindings.uData).toBe(buffer);
    expect(bindings.uPaint0).toBe(color);
    expect(data.media).toBe(media);
    expect(buffer!.slice(12, 15)).toEqual([320, 240, 1]);
    expect(color!.slice(0, 2)).toEqual([0, 1]);
    expect(color!.slice(Math.ceil(program.paint!.states.length / 4) * 4)).toEqual(definitions);
  });
});

describe("springStep", () => {
  it("settles within 2% after the duration", () => {
    const path = run(1, 1);
    expect(path.at(-1)!).toBeGreaterThan(0.98);
  });

  it("starts from rest and never overshoots", () => {
    const path = run(1, 3);
    // Slower in the first frame than an exponential ease of the same duration would be.
    expect(path[0]!).toBeLessThan(1 - Math.exp(-omegaFor(1) / 60));
    for (let i = 1; i < path.length; i++) expect(path[i]!).toBeGreaterThanOrEqual(path[i - 1]!);
    expect(Math.max(...path)).toBeLessThanOrEqual(1);
  });

  it("is exact, so the frame rate does not change the path", () => {
    const fine = run(1, 0.5, 1 / 240);
    const coarse = run(1, 0.5, 1 / 30);
    expect(coarse.at(-1)!).toBeCloseTo(fine.at(-1)!, 4);
  });

  it("stays stable across a long gap", () => {
    const x = new Float32Array([0]);
    const v = new Float32Array([5]);
    springStep(x, v, new Float32Array([1]), 30, omegaFor(1));
    expect(x[0]).toBeCloseTo(1, 5);
    expect(v[0]).toBeCloseTo(0, 5);
  });

  it("carries its velocity into a new target", () => {
    const x = new Float32Array([0]);
    const v = new Float32Array([0]);
    const omega = omegaFor(1);
    for (let i = 0; i < 20; i++) springStep(x, v, new Float32Array([1]), 1 / 60, omega);
    const before = x[0]!;
    springStep(x, v, new Float32Array([0]), 1 / 60, omega);
    // Still moving up for a moment after the target turned round: no instant reversal.
    expect(x[0]!).toBeGreaterThan(before);
  });
});
