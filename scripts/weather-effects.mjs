/** Optical regressions and before/after captures through the shipping WebGL and SkSL shaders.
 * Run after build:lib: node scripts/weather-effects.mjs [--baseline] [--out dir] [--before dir]. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import CanvasKitInit from "canvaskit-wasm";
import { parseArgs } from "./lib/cli.mjs";
import { createRainMotion } from "./lib/rain-motion.mjs";
import { weatherCases } from "./lib/weather-cases.mjs";
import { ensureOrbConfig } from "../packages/core/dist/index.js";
import {
  compileOrb,
  OrbRuntime,
  orbShader,
  VERTEX_SHADER,
} from "../packages/core/dist/program/index.js";

const args = parseArgs(process.argv.slice(2), {
  baseline: false,
  out: "renders/weather",
  before: "",
  size: 256,
});
const out = resolve(args.out);
mkdirSync(out, { recursive: true });
const size = args.size;
const ck = await CanvasKitInit();
const renderer = await createRainMotion(size);
const pixelsOf = (bytes) => {
  const image = ck.MakeImageFromEncoded(bytes);
  const pixels = image.readPixels(0, 0, {
    width: size,
    height: size,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  });
  image.delete();
  return pixels;
};
const meanDiff = (a, b) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;
function direct(userCode, blur) {
  const source = orbShader("glsl", { contents: "shader", code: userCode });
  const start = source.indexOf("vec4 orb(");
  const end = source.indexOf("\nvoid main", start);
  return (
    source.slice(0, start) +
    `vec4 orb(vec2 frag) {
        vec2 p = (frag - 0.5 * uData[0].xy) / (0.5 * min(uData[0].x, uData[0].y));
        return orbContents(p, p, 0.005, 1.0, ${blur}, 0.0, vec4(0.0), vec4(0.0));
      }` +
    source.slice(end)
  );
}
function skia(source, uniforms) {
  const effect = ck.RuntimeEffect.Make(source, (error) => {
    throw new Error(error);
  });
  assert(effect, "SkSL compiles");
  const surface = ck.MakeSurface(size, size);
  const paint = new ck.Paint();
  const shader = effect.makeShader(uniforms);
  paint.setShader(shader);
  surface.getCanvas().drawPaint(paint);
  const image = surface.makeImageSnapshot();
  const bytes = image.encodeToBytes();
  for (const item of [image, paint, shader, surface, effect]) item.delete();
  return bytes;
}
const captures = [];
try {
  for (const item of weatherCases(ensureOrbConfig)) {
    const program = compileOrb(item.config, { shaders: ["glsl", "msl"] });
    const runtime = new OrbRuntime(program);
    runtime.seek(4);
    const uniforms = runtime.write(size, size, 1);
    await renderer.prepare(VERTEX_SHADER, program.shaders.glsl, program.slots);
    const bytes = await renderer.frame(uniforms);
    writeFileSync(resolve(out, `${item.name}.png`), bytes);
    writeFileSync(resolve(out, `${item.name}.program.json`), JSON.stringify(program));
    const reference = pixelsOf(bytes);
    const other = skia(orbShader("sksl", program), uniforms);
    const difference = meanDiff(reference, pixelsOf(other));
    assert(difference <= 1.5, `${item.name} WebGL/Skia parity: ${difference}`);
    console.log(`${item.name}: WebGL/Skia MAD ${difference.toFixed(3)}`);
    captures.push({ ...item, bytes });
  }

  if (!args.baseline) {
    // Observe the contents directly, excluding haze: whitening alone cannot pass this check.
    const code = `vec4 contents(vec2 p, float time, float level, vec4 knobs, vec3 color1, vec3 color2) {
      return vec4(vec3(step(0.0, sin(p.x * 36.0) * sin(p.y * 36.0))), 1.0);
    }`;
    const program = compileOrb(ensureOrbConfig({ contents: { type: "shader", code } }));
    const uniforms = new OrbRuntime(program).write(size, size, 1);
    const contrast = (pixels) => {
      let sum = 0,
        count = 0;
      for (let y = size / 4; y < (size * 3) / 4; y++)
        for (let x = size / 4; x < (size * 3) / 4; x++) {
          sum += Math.abs(pixels[(y * size + x) * 4] - 127.5);
          count++;
        }
      return sum / count;
    };
    await renderer.prepare(VERTEX_SHADER, direct(code, "0.0"), program.slots);
    const clear = contrast(pixelsOf(await renderer.frame(uniforms)));
    await renderer.prepare(VERTEX_SHADER, direct(code, "0.16"), program.slots);
    const blurred = contrast(pixelsOf(await renderer.frame(uniforms)));
    assert(
      blurred < clear * 0.25,
      `true diffusion reduces checker contrast: ${clear} -> ${blurred}`,
    );
    console.log(`diffusion contrast: ${clear.toFixed(2)} -> ${blurred.toFixed(2)}`);

    // Hidden red must never leak into the visible blue side of a transparent custom shader.
    const alphaCode = `vec4 contents(vec2 p, float time, float level, vec4 knobs, vec3 color1, vec3 color2) {
      return p.x > 0.0 ? vec4(1.0, 0.0, 0.0, 0.0) : vec4(0.0, 0.0, 1.0, 1.0);
    }`;
    await renderer.prepare(VERTEX_SHADER, direct(alphaCode, "0.16"), program.slots);
    const transparent = pixelsOf(await renderer.frame(uniforms));
    assert(
      transparent.every((value, i) => i % 4 !== 0 || value === 0),
      "diffusion filters premultiplied colours",
    );
    const boundary = (Math.floor(size / 2) * size + Math.floor(size / 2)) * 4;
    assert(
      transparent[boundary + 3] > 20 && transparent[boundary + 3] < 235,
      "diffusion softens the alpha boundary",
    );

    // A stationary lit surface must not acquire pinwheel motion or unrelated timer sparkles.
    const still = weatherCases(ensureOrbConfig).find((item) => item.name === "sunny-glass");
    still.config.contents.code = `vec4 contents(vec2 p, float time, float level, vec4 knobs, vec3 color1, vec3 color2) { return vec4(0.08, 0.13, 0.2, 1.0); }`;
    const stillProgram = compileOrb(still.config);
    const data = new OrbRuntime(stillProgram).write(size, size, 1);
    await renderer.prepare(VERTEX_SHADER, orbShader("glsl", stillProgram), stillProgram.slots);
    const first = pixelsOf(await renderer.frame(data));
    data[4] = 19;
    const later = pixelsOf(await renderer.frame(data));
    assert.equal(meanDiff(first, later), 0, "stationary sunny optics remain temporally coherent");
    const moved = ensureOrbConfig({
      ...still.config,
      light: { ...still.config.light, x: 0.4, y: -0.2 },
    });
    const movedData = new OrbRuntime(compileOrb(moved)).write(size, size, 1);
    assert(
      meanDiff(first, pixelsOf(await renderer.frame(movedData))) > 1,
      "sunny optics respond to the light direction",
    );
    console.log("premultiplied alpha, stationary sun and moving light: ok");
  }

  if (args.before) {
    const label = 32;
    const sheet = ck.MakeSurface(size * 4, (size + label) * 3);
    const canvas = sheet.getCanvas();
    canvas.clear(ck.Color(17, 24, 39));
    const fontPath = [
      "/System/Library/Fonts/Helvetica.ttc",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ].find(existsSync);
    assert(fontPath, "a local label font exists");
    const face = ck.Typeface.MakeTypefaceFromData(Uint8Array.from(readFileSync(fontPath)).buffer);
    const font = new ck.Font(face, 13);
    const ink = new ck.Paint();
    ink.setColor(ck.Color(218, 226, 240));
    for (let i = 0; i < captures.length; i++) {
      const item = captures[i];
      for (let j = 0; j < 2; j++) {
        const bytes = j === 0 ? readFileSync(resolve(args.before, `${item.name}.png`)) : item.bytes;
        const image = ck.MakeImageFromEncoded(bytes);
        const x = ((i % 2) * 2 + j) * size;
        const y = Math.floor(i / 2) * (size + label);
        canvas.drawText(
          `${item.label} · ${j === 0 ? "before" : "after"}`,
          x + 10,
          y + 21,
          ink,
          font,
        );
        canvas.drawImage(image, x, y + label);
        image.delete();
      }
    }
    const image = sheet.makeImageSnapshot();
    const file = resolve(out, "comparison.png");
    writeFileSync(file, image.encodeToBytes());
    for (const item of [image, ink, font, face, sheet]) item.delete();
    console.log(file);
  }
} finally {
  await renderer.close();
}
