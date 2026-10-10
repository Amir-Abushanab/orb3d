#!/usr/bin/env node
// CPU simulation/packing only. GPU frame time and physical-phone performance need device traces.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, run } from "./lib/cli.mjs";

const load = async (dir) => ({
  ...(await import(pathToFileURL(resolve(dir, "index.js")))),
  ...(await import(pathToFileURL(resolve(dir, "program/index.js")))),
});
const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];

await run(async () => {
  const args = parseArgs(process.argv.slice(2), { baseline: "", output: "", frames: 1200 });
  if (args.help)
    return void console.log(
      "usage: pnpm benchmark [--baseline old-core-dist] [--output report.json] [--frames 1200]",
    );
  assert(args.frames >= 120 && Number.isInteger(args.frames), "frames must be an integer >=120");
  const currentDir = resolve(import.meta.dirname, "../packages/core/dist");
  const current = await load(currentDir);
  const baseline = args.baseline ? await load(resolve(args.baseline)) : null;
  const cases = [
    ["clear", {}],
    ["aura", { contents: { type: "gradient" } }],
    ["rain-light", { rain: { amount: 1, density: 0.2, run: 1 } }],
    ["rain-dense", { rain: { amount: 1, density: 1, run: 1 } }],
    [
      "rain-wind",
      { weather: { windSpeed: 20, gusts: 35 }, rain: { amount: 1, density: 1, angle: 45, run: 1 } },
    ],
    ["snow", { snow: { amount: 1, density: 1, melt: 0.4 } }],
    [
      "rain-snow",
      { rain: { amount: 1, density: 1, run: 1 }, snow: { amount: 1, density: 1, melt: 0.7 } },
    ],
  ];
  const measure = (engine, program) => {
    const runtime = new engine.OrbRuntime(program);
    for (let i = 0; i < 600; i++) {
      runtime.advance(1 / 60);
      runtime.write(256, 256);
    }
    const samples = [];
    for (let sample = 0; sample < 5; sample++) {
      const start = performance.now();
      for (let frame = 0; frame < args.frames; frame++) {
        runtime.advance(1 / 60);
        runtime.write(256, 256);
      }
      samples.push((performance.now() - start) / args.frames);
    }
    return median(samples);
  };
  const results = [];
  for (const [name, input] of cases) {
    const config = current.ensureOrbConfig(input);
    const program = current.compileOrb(config);
    if (baseline) {
      const before = new baseline.OrbRuntime(program),
        after = new current.OrbRuntime(program);
      for (let frame = 0; frame < 2400; frame++) {
        const dt = [1 / 60, 1 / 30, 1 / 120, 0.05][frame % 4];
        const level = (frame % 90) / 89;
        const state =
          frame === 600 ? "muted" : frame === 900 ? "speaking" : frame === 1200 ? "idle" : null;
        if (state) {
          before.setState(state);
          after.setState(state);
        }
        before.setLevel(level);
        after.setLevel(level);
        before.advance(dt);
        after.advance(dt);
        if (frame % 120 === 0 || frame === 2399) {
          assert.deepEqual(
            after.write(256, 256),
            before.write(256, 256),
            `${name}: uniforms at frame ${frame}`,
          );
          const snapshot = after.snapshot();
          // Broad-phase scratch is rebuilt each step and is not simulated water.
          delete snapshot.rain.contacts;
          assert.deepEqual(snapshot, before.snapshot(), `${name}: physics at frame ${frame}`);
        }
      }
      console.log(
        `${name}: exact physics and uniforms match the baseline over 2400 variable-time frames`,
      );
    }
    const beforeMs = baseline ? measure(baseline, program) : null;
    const afterMs = measure(current, program);
    const result = {
      name,
      cpuMs: afterMs,
      baselineCpuMs: beforeMs,
      uniformBytes: program.slots * 16,
    };
    results.push(result);
    console.log(
      `${name}: ${afterMs.toFixed(4)} ms/frame${beforeMs === null ? "" : ` (before ${beforeMs.toFixed(4)}, ${(100 * (1 - afterMs / beforeMs)).toFixed(1)}% less CPU time)`}`,
    );
  }
  if (args.output) {
    mkdirSync(dirname(resolve(args.output)), { recursive: true });
    writeFileSync(
      args.output,
      JSON.stringify(
        {
          scope: "CPU simulation and uniform packing; excludes GPU and physical devices",
          framesPerSample: args.frames,
          results,
        },
        null,
        2,
      ) + "\n",
    );
  }
});
