/** Render enlarged intermediate contact frames through the actual SkSL water surface.
 * Run after build:lib: node scripts/rain-coalescence.mjs. Writes optical and silhouette sheets.
 * --motion also writes 120 Hz optical frames for inspecting sub-step continuity in motion. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import CanvasKitInit from "canvaskit-wasm";
import { parseArgs } from "./lib/cli.mjs";
import { createRainMotion } from "./lib/rain-motion.mjs";
import {
  advanceRuntime,
  compileOrb,
  createRuntimeData,
  createUniforms,
  orbShader,
  writeRuntime,
  VERTEX_SHADER,
} from "../packages/core/dist/program/index.js";
import { ensureOrbConfig } from "../packages/core/dist/index.js";

let cases = [
  [
    "Running contact",
    [
      [0, 0.2, 0.075, 1],
      [0.045, 0.095, 0.024, 0],
    ],
  ],
  [
    "Small running head",
    [
      [0, 0.18, 0.035, 1],
      [0.055, 0.08, 0.07, 0],
    ],
  ],
  [
    "Equal lobes",
    [
      [-0.048, 0.1, 0.05, 0],
      [0.048, 0.1, 0.05, 0],
    ],
  ],
  [
    "Small bead",
    [
      [0, 0.1, 0.06, 0],
      [0.073, 0.1, 0.018, 0],
    ],
  ],
  [
    "Glancing",
    [
      [0, 0.1, 0.05, 0],
      [0.063, 0.165, 0.045, 0],
    ],
  ],
  [
    "Third contact",
    [
      [0, 0.1, 0.055, 0],
      [-0.07, 0.1, 0.025, 0],
      [0.067, 0.1, 0.025, 0],
    ],
  ],
  [
    "Near the rim",
    [
      [0.82, 0.1, 0.035, 0],
      [0.853, 0.1, 0.032, 0],
    ],
  ],
];
const args = parseArgs(process.argv.slice(2), { font: "", motion: false, running: false });
if (args.running) cases = cases.slice(0, 2);
const times = [0, 0.035, 0.075, 0.11, 0.16, 0.21, 0.3];
const cell = 180;
const label = 34;
const width = cell * times.length;
const height = (cell + label) * cases.length;
const ck = await CanvasKitInit();
const sheets = [ck.MakeSurface(width, height), ck.MakeSurface(width, height)];
const ink = new ck.Paint();
ink.setColor(ck.Color(199, 208, 226));
const output = resolve(import.meta.dirname, "../renders");
mkdirSync(output, { recursive: true });
const motionDir = resolve(output, "rain-motion-frames");
if (args.motion) mkdirSync(motionDir, { recursive: true });
const motion = args.motion ? ck.MakeSurface(cell * 2, cell + label) : null;
const fontPath =
  args.font ||
  [
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "C:/Windows/Fonts/arial.ttf",
  ].find((path) => existsSync(path));
assert(fontPath, "supply a local TrueType font with --font path");
const typeface = ck.Typeface.MakeTypefaceFromData(Uint8Array.from(readFileSync(fontPath)).buffer);
assert(typeface, "load the frame-label font");
const font = new ck.Font(typeface, 14);
const motionRenderer = args.motion ? await createRainMotion(cell) : null;
function renderPixels(effect, uniforms) {
  const surface = ck.MakeSurface(cell, cell);
  const paint = new ck.Paint();
  const shader = effect.makeShader(uniforms);
  paint.setShader(shader);
  surface.getCanvas().drawPaint(paint);
  const image = surface.makeImageSnapshot();
  const pixels = image.readPixels(0, 0, {
    width: cell,
    height: cell,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  });
  image.delete();
  paint.delete();
  shader.delete();
  surface.delete();
  return pixels;
}
/** A straight film must look the same whether saved as one segment or eleven. Timestamp
 * interpolation is linear in the decoded path so this isolates optical seams at path anchors. */
function filmVectors(values) {
  return [0, 4, 8].map((i) => `float4(${values.slice(i, i + 4).join(", ")})`).join(",\n");
}
function checkFilm(source, uniforms) {
  const start = source.indexOf("vec4 orb(");
  const end = source.indexOf("\nhalf4 main", start);
  const profiles = [2, 12, 12].map((count, index) => {
    const points = Array.from({ length: 12 }, (_, i) => {
      const y = -0.3 + (0.6 * Math.min(i, count - 1)) / (count - 1);
      return 2048 * 4096 + Math.round(((y + 1.2) / 2.4) * 4095);
    });
    const stamps = points.map((point) => {
      const y = ((point % 4096) / 4095) * 2.4 - 1.2;
      return 0.95 - ((y + 0.3) / 0.6) * 0.8;
    });
    const profile =
      source.slice(0, start) +
      `float4 orb(float2 frag) {
        float2 face = (frag - 0.5 * uData[0].xy) / (0.5 * min(uData[0].x, uData[0].y)) * 0.4;
        float px = 0.4 / (0.5 * min(uData[0].x, uData[0].y));
        float4 hit = float4(0.0), next = float4(0.0);
        float2 near = float2(1000.0);
        float wipe = 0.0;
        ${
          index === 2
            ? `rainTrail(face, px, 1.0, ${filmVectors(points)}, ${filmVectors(stamps.map((s) => s - 3))},
          float4(0.08, -1.0, ${count}.0, 0.0), 1.0, hit, next, near, wipe);`
            : ""
        }
        rainTrail(face, px, 1.0, ${filmVectors(points)}, ${filmVectors(stamps)},
          float4(0.08, -1.0, ${count}.0, 0.0), 1.0, hit, next, near, wipe);
        float2 q = hit.w > 0.0 ? (face - hit.xy) / abs(hit.z) : float2(0.0);
        return float4(hit.w, (q.y + 0.5) * hit.w, (q.x + 0.5) * hit.w, 1.0);
      }
` +
      source.slice(end);
    const effect = ck.RuntimeEffect.Make(profile, (error) => {
      throw new Error(error);
    });
    const pixels = renderPixels(effect, uniforms);
    effect.delete();
    return pixels;
  });
  let difference = 0,
    largest = 0;
  for (let i = 0; i < profiles[0].length; i++) {
    const change = Math.abs(profiles[0][i] - profiles[1][i]);
    difference += change;
    largest = Math.max(largest, change);
  }
  assert(difference / profiles[0].length < 0.02, "saved path anchors must not add optical ribs");
  assert(largest <= 2, "a local seam must not hide in the image-wide average");
  assert.deepEqual(
    profiles[2],
    profiles[1],
    "an expired film must not hide a fresh overlapping trail",
  );
  console.log("checked film continuity: one segment and eleven have the same surface");
}
function footprint(pixels) {
  let area = 0,
    x = 0,
    loX = cell,
    hiX = 0,
    loY = cell,
    hiY = 0;
  for (let p = 0; p < cell * cell; p++) {
    const weight = pixels[p * 4] / 255;
    area += weight;
    x += ((p % cell) + 0.5) * weight;
    if (weight < 0.5) continue;
    loX = Math.min(loX, p % cell);
    hiX = Math.max(hiX, p % cell);
    loY = Math.min(loY, Math.floor(p / cell));
    hiY = Math.max(hiY, Math.floor(p / cell));
  }
  return { area, x: ((x / area - cell / 2) / (cell / 2)) * 0.1, loX, hiX, height: hiY - loY };
}
function components(pixels) {
  const visited = new Uint8Array(cell * cell);
  let count = 0;
  for (let at = 0; at < visited.length; at++) {
    if (visited[at] || pixels[at * 4] < 128) continue;
    let area = 0;
    const queue = [at];
    visited[at] = 1;
    while (queue.length) {
      const p = queue.pop();
      area++;
      const x = p % cell,
        y = Math.floor(p / cell);
      for (const next of [
        x > 0 ? p - 1 : -1,
        x + 1 < cell ? p + 1 : -1,
        y > 0 ? p - cell : -1,
        y + 1 < cell ? p + cell : -1,
      ]) {
        if (next < 0 || visited[next] || pixels[next * 4] < 128) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    if (area > 3) count++;
  }
  return count;
}
let narrow = 0;
for (const sheet of sheets) sheet.getCanvas().clear(ck.Color(17, 23, 37));

try {
  for (let row = 0; row < cases.length; row++) {
    const [name, drops] = cases[row];
    const program = compileOrb(
      ensureOrbConfig({
        contents: {
          type: "shader",
          code: "vec4 contents(vec2 p, float time, float level, vec4 knobs, vec3 color1, vec3 color2) { return vec4(mix(vec3(0.06, 0.18, 0.37), vec3(0.12, 0.6, 0.78), 0.5 + 0.35 * sin(p.x * 18.0 + p.y * 10.0)), 1.0); }",
        },
        rain: { amount: 1, mist: 0, density: 0, run: 1, drops, beads: [] },
        fog: { amount: 0 },
        glass: {
          bend: 0,
          edge: 0,
          rim: 0,
          reflection: 0,
          highlight: 0,
          glint: 0,
          outline: 0,
          bounce: 0,
        },
        states: { idle: {} },
      }),
    );
    const data = createRuntimeData(program);
    // Isolate the contact itself; residual-bead spawning is covered by rain.test.ts.
    data.rain.shed.fill(1000);
    if (row < 2) {
      data.rain.vy[0] = -0.006;
      data.rain.vz[0] = (0.006 * data.rain.y[0]) / data.rain.z[0];
      data.rain.stretch[0] = 0.9;
      data.rain.pstretch[0] = 0.9;
    }
    const uniforms = new Float32Array(createUniforms(program));
    const cx = (Math.min(...drops.map((d) => d[0])) + Math.max(...drops.map((d) => d[0]))) / 2;
    const cy = (Math.min(...drops.map((d) => d[1])) + Math.max(...drops.map((d) => d[1]))) / 2;
    const scale = name === "Near the rim" ? 0.09 : row < 2 ? 0.25 : 0.2;
    // These fixtures have only authored drops (no incoming rain or shed beads). The remaining
    // pool slots and later trail chunks are all zero; skipping them makes CPU close-ups practical.
    const raw = orbShader("sksl", program)
      .replace("i < 192;", "i < 16;")
      .replace("i < 48;", "i < 4;");
    const source = raw
      .replace(
        "vec2 face = (frag - 0.5 * head.xy) / radius;",
        `vec2 face = (frag - 0.5 * head.xy) / radius * ${scale} + float2(${cx}, ${cy});`,
      )
      .replace("float px = 1.0 / (radius * head.w);", `float px = ${scale} / (radius * head.w);`);
    const at = source.indexOf("vec4 orb(");
    const end = source.indexOf("\nhalf4 main", at);
    assert(at > 0 && end > at, "find the generated orb entry point");
    const silhouette =
      source.slice(0, at) +
      `float4 orb(float2 frag) {
    float4 head = uData[0];
    float2 face = (frag - 0.5 * head.xy) / (0.5 * min(head.x, head.y)) * ${scale} + float2(${cx}, ${cy});
    float px = ${scale} / (0.5 * min(head.x, head.y));
    float4 marks = float4(0.0);
    float4 drop = rainScan(face, px, uData[1], marks);
    return float4(float3(drop.w), 1.0);
  }
` +
      source.slice(end);
    const effects = [source, silhouette].map((s) =>
      ck.RuntimeEffect.Make(s, (error) => {
        throw new Error(error);
      }),
    );
    if (row === 0) {
      const profile =
        source.slice(0, at) +
        `float4 orb(float2 frag) {
        float2 face = (frag - 0.5 * uData[0].xy) / (0.5 * min(uData[0].x, uData[0].y)) * 0.1;
        float px = 0.1 / (0.5 * min(uData[0].x, uData[0].y));
        float3 field = contactField(face, float3(0.0, 0.0, 0.03), float3(0.0, -1.0, 0.0), float2(1.0, 0.0), uData[0].z);
        float coverage = cover(field.x, max(px, px * length(field.yz)));
        return float4(float3(coverage), 1.0);
      }
` +
        source.slice(end);
      const effect = ck.RuntimeEffect.Make(profile, (error) => {
        throw new Error(error);
      });
      writeRuntime(data, program, uniforms, cell, cell);
      checkFilm(source, uniforms);
      uniforms[2] = 0;
      const resting = footprint(renderPixels(effect, uniforms));
      uniforms[2] = 1;
      const caught = footprint(renderPixels(effect, uniforms));
      assert(
        Math.abs(caught.area / resting.area - 1) < 0.02,
        "contact deformation preserves footprint area",
      );
      assert(caught.x - resting.x > 0.006, "the whole small footprint leans toward the neck");
      assert(
        Math.abs(caught.loX - resting.loX) <= 1,
        "the far contact line remains pinned during the catch",
      );
      assert(
        caught.height < resting.height * 0.85,
        "the outline responds across the body, not just at its tip",
      );
      effect.delete();
      console.log("checked contact deformation: area, whole-body shift and pinned far edge");
    }
    if (motion && row < 2) {
      const moving = createRuntimeData(program);
      moving.rain.shed.fill(1000);
      moving.rain.vy[0] = -0.006;
      moving.rain.vz[0] = (0.006 * moving.rain.y[0]) / moving.rain.z[0];
      moving.rain.stretch[0] = 0.9;
      moving.rain.pstretch[0] = 0.9;
      const fragment = orbShader("glsl", program)
        .replace("i < 192;", "i < 16;")
        .replace("i < 48;", "i < 4;")
        .replace(
          "vec2 face = (frag - 0.5 * head.xy) / radius;",
          `vec2 face = (frag - 0.5 * head.xy) / radius * ${scale} + vec2(${cx}, ${cy});`,
        )
        .replace("float px = 1.0 / (radius * head.w);", `float px = ${scale} / (radius * head.w);`);
      await motionRenderer.prepare(VERTEX_SHADER, fragment, program.slots);
      for (let frame = 0; frame < 96; frame++) {
        if (frame) advanceRuntime(moving, program, 1 / 120);
        assert(moving.rain.live.slice(16).every((live) => live === 0));
        assert(moving.rain.count.slice(4).every((count) => count === 0));
        // Keep the real fixed-step interpolation here; the contact sheet deliberately cuts to
        // completed ticks, which cannot reveal motion quantization or abrupt direction changes.
        writeRuntime(moving, program, uniforms, cell, cell);
        const image = ck.MakeImageFromEncoded(await motionRenderer.frame(uniforms));
        const file = resolve(motionDir, `row-${row}-${String(frame).padStart(3, "0")}.png`);
        if (row === 0) {
          motion.getCanvas().clear(ck.Color(17, 23, 37));
        } else {
          const previous = ck.MakeImageFromEncoded(
            readFileSync(resolve(motionDir, `row-0-${String(frame).padStart(3, "0")}.png`)),
          );
          motion.getCanvas().drawImage(previous, 0, 0);
          previous.delete();
        }
        motion.getCanvas().drawImage(image, row * cell, label);
        motion.getCanvas().drawText(name, row * cell + 10, 22, ink, font);
        const combined = motion.makeImageSnapshot();
        writeFileSync(file, combined.encodeToBytes());
        combined.delete();
        image.delete();
      }
      console.log(`rendered 120 Hz motion: ${name}`);
    }
    let previous = 0;
    for (let col = 0; col < times.length; col++) {
      advanceRuntime(data, program, times[col] - previous);
      previous = times[col];
      data.rain.frac = 1;
      assert(data.rain.live.slice(16).every((live) => live === 0));
      assert(data.rain.count.slice(4).every((count) => count === 0));
      writeRuntime(data, program, uniforms, cell, cell);
      for (let mode = 0; mode < effects.length; mode++) {
        const surface = ck.MakeSurface(cell, cell);
        const paint = new ck.Paint();
        const shader = effects[mode].makeShader(uniforms);
        paint.setShader(shader);
        surface.getCanvas().drawPaint(paint);
        const image = surface.makeImageSnapshot();
        let pixels;
        if (mode === 1) {
          pixels = image.readPixels(0, 0, {
            width: cell,
            height: cell,
            colorType: ck.ColorType.RGBA_8888,
            alphaType: ck.AlphaType.Unpremul,
            colorSpace: ck.ColorSpace.SRGB,
          });
          if (name !== "Third contact" && col >= 2)
            assert.equal(
              components(pixels),
              1,
              `${name} at ${times[col]}: the liquid stays connected`,
            );
          if (name === "Equal lobes" && (col === 1 || col === 2)) {
            let bridge = 0;
            for (let y = 0; y < cell; y++) if (pixels[(y * cell + cell / 2) * 4] >= 128) bridge++;
            if (col === 1) narrow = bridge;
            else assert(bridge > narrow * 1.3, "the visible neck widens before water transfer");
          }
          if (name === "Running contact" && col === 4) {
            // Catching changes how soon the running head covers the bead. Test an enclosed
            // contact pose explicitly instead of assuming it must be covered after 160 ms.
            const enclosed = createRuntimeData(program);
            const r = enclosed.rain;
            r.live.fill(0);
            r.live[0] = 1;
            r.live[1] = 2;
            r.pair[0] = 1;
            r.pair[1] = 0;
            r.phase[0] = 0.7;
            r.pphase[0] = 0.7;
            r.radius0[0] = 0.08;
            r.radius0[1] = 0.024;
            r.r[1] = 0.00675;
            r.pr[1] = r.r[1];
            r.r[0] = Math.cbrt(0.08 ** 3 + 0.024 ** 3 - r.r[1] ** 3);
            r.pr[0] = r.r[0];
            r.x[0] = 0;
            r.px[0] = 0;
            r.y[0] = 0;
            r.py[0] = 0;
            r.z[0] = 1;
            r.x[1] = 0.073;
            r.px[1] = 0.073;
            r.y[1] = 0;
            r.py[1] = 0;
            r.z[1] = Math.sqrt(1 - r.x[1] ** 2);
            r.frac = 1;
            const contact = Float32Array.from(createUniforms(program));
            writeRuntime(enclosed, program, contact, cell, cell);
            const covered = renderPixels(effects[1], contact);
            const alone = contact.slice();
            alone[program.rain.pool * 4 + 5] = 0;
            const single = renderPixels(effects[1], alone);
            let protruding = 0;
            for (let p = 0; p < cell * cell; p++)
              if (covered[p * 4] >= 128 && single[p * 4] < 128) protruding++;
            assert(protruding <= 2, `covered water leaves no connector nub (${protruding} pixels)`);
          }
        }
        const canvas = sheets[mode].getCanvas();
        if (pixels)
          canvas.writePixels(pixels, cell, cell, col * cell, row * (cell + label) + label);
        else canvas.drawImage(image, col * cell, row * (cell + label) + label);
        canvas.drawText(
          `${col === 0 ? name + " · " : ""}${Math.round(times[col] * 1000)} ms`,
          col * cell + 10,
          row * (cell + label) + 22,
          ink,
          font,
        );
        image.delete();
        paint.delete();
        shader.delete();
        surface.delete();
      }
    }
    for (const effect of effects) effect.delete();
    console.log(`rendered ${name}`);
  }
} finally {
  await motionRenderer?.close();
}
const featured = sheets[0].makeImageSnapshot([0, 0, width, (cell + label) * 2]);
const featuredFile = resolve(output, "rain-running-contact-frames.png");
writeFileSync(featuredFile, featured.encodeToBytes());
featured.delete();
console.log(featuredFile);
for (let mode = 0; mode < sheets.length; mode++) {
  const image = sheets[mode].makeImageSnapshot();
  const file = resolve(output, `rain-coalescence-${mode ? "silhouettes" : "frames"}.png`);
  writeFileSync(file, image.encodeToBytes());
  console.log(file);
  image.delete();
  sheets[mode].delete();
}
font.delete();
typeface.delete();
ink.delete();
motion?.delete();
