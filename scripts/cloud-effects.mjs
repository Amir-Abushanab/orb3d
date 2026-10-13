/** Cloud shape, motion and reduced-motion regressions through the shipping WebGL/SkSL shaders.
 * node scripts/cloud-effects.mjs [--baseline] [--out dir] [--before dir] */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import CanvasKitInit from "canvaskit-wasm";
import { weatherConfig } from "../packages/core/dist/index.js";
import {
  compileOrb,
  OrbRuntime,
  orbShader,
  VERTEX_SHADER,
} from "../packages/core/dist/program/index.js";
import { parseArgs } from "./lib/cli.mjs";
import { createRainMotion } from "./lib/rain-motion.mjs";

const args = parseArgs(process.argv.slice(2), {
  baseline: false,
  out: "renders/clouds",
  before: "",
});
const out = resolve(args.out),
  size = 256,
  times = [0, 2, 8];
mkdirSync(out, { recursive: true });
const ck = await CanvasKitInit(),
  gl = await createRainMotion(size);
const observation = {
  solarElevation: 30,
  solarAzimuth: 140,
  temperature: 15,
  dewPoint: 5,
  visibility: 20000,
};
const base = { environment: { spin: 0 } };
const cases = [
  { name: "scattered", cover: 0.45, wind: 3, target: "orb" },
  { name: "cloudy", cover: 0.8, wind: 6, target: "orb" },
  { name: "overcast", cover: 1, wind: 0, target: "orb" },
  { name: "hero-overcast", cover: 1, wind: 8, target: "hero" },
];
function pixels(bytes) {
  const image = ck.MakeImageFromEncoded(bytes);
  const data = image.readPixels(0, 0, {
    width: size,
    height: size,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  });
  image.delete();
  return data;
}
// Central disk excludes glass edges, transparent pixels and the sky's steep horizon gradient.
function values(data) {
  const result = [];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if ((x - size / 2) ** 2 + (y - size / 2) ** 2 > (size * 0.3) ** 2) continue;
      const k = (y * size + x) * 4;
      result.push(data[k] * 0.2126 + data[k + 1] * 0.7152 + data[k + 2] * 0.0722);
    }
  return result;
}
const difference = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
const spread = (a) => {
  const sorted = a.toSorted((x, y) => x - y);
  return sorted[Math.floor(a.length * 0.95)] - sorted[Math.floor(a.length * 0.05)];
};
// Local relief distinguishes cloud structure from a smooth sky or glass-lighting gradient.
function relief(data) {
  const luminance = (x, y) => {
    const k = (y * size + x) * 4;
    return data[k] * 0.2126 + data[k + 1] * 0.7152 + data[k + 2] * 0.0722;
  };
  let sum = 0,
    count = 0;
  for (let y = 80; y < 176; y++)
    for (let x = 80; x < 176; x++) {
      sum +=
        Math.abs(luminance(x, y) - luminance(x + 8, y)) +
        Math.abs(luminance(x, y) - luminance(x, y + 8));
      count += 2;
    }
  return sum / count;
}
const captures = [];
try {
  for (const item of cases) {
    const config = weatherConfig(
      {
        ...observation,
        cloudCover: item.cover,
        windSpeed: item.wind,
        windGust: item.wind * 1.5,
        windDirection: 90,
      },
      { target: item.target },
      base,
    );
    const program = compileOrb(config),
      runtime = new OrbRuntime(program);
    await gl.prepare(VERTEX_SHADER, orbShader("glsl", program), program.slots);
    const frames = [];
    let definition = 0;
    for (const time of times) {
      runtime.seek(time);
      const uniforms = runtime.write(size, size),
        bytes = await gl.frame(uniforms);
      writeFileSync(resolve(out, `${item.name}-${time}.png`), bytes);
      frames.push(values(pixels(bytes)));
      if (time === 0) definition = relief(pixels(bytes));
      captures.push({ name: `${item.name}-${time}`, label: `${item.name} / ${time}s`, bytes });
      const effect = ck.RuntimeEffect.Make(orbShader("sksl", program), (error) => {
        throw new Error(error);
      });
      assert(effect, "SkSL compiles");
      const surface = ck.MakeSurface(size, size),
        paint = new ck.Paint(),
        shader = effect.makeShader(uniforms);
      paint.setShader(shader);
      surface.getCanvas().drawPaint(paint);
      const image = surface.makeImageSnapshot();
      assert(
        difference(values(pixels(image.encodeToBytes())), frames.at(-1)) < 1.5,
        `${item.name} / ${time}s WebGL/SkSL parity`,
      );
      for (const obj of [image, shader, paint, surface, effect]) obj.delete();
    }
    const contrast = spread(frames[0]),
      motion = difference(frames[0], frames[1]);
    console.log(
      `${item.name}: relief ${definition.toFixed(2)}, luminance spread ${contrast.toFixed(2)}, 2s motion ${motion.toFixed(2)}, 8s motion ${difference(frames[0], frames[2]).toFixed(2)}`,
    );
    if (!args.baseline) {
      assert(contrast > 12, `${item.name} retains cloud definition`);
      if (item.cover === 1)
        assert(definition > 6.5, `${item.name} retains local relief at full coverage`);
      assert(motion > 1.5, `${item.name} moves visibly within two seconds`);
    }
    // A provider-driven, fully cloudy sky must stay still when the caller requests it.
    const reduced = compileOrb(
      weatherConfig(
        { ...observation, cloudCover: item.cover, windSpeed: item.wind },
        { target: item.target, reducedMotion: true },
        base,
      ),
    );
    const still = new OrbRuntime(reduced);
    await gl.prepare(VERTEX_SHADER, orbShader("glsl", reduced), reduced.slots);
    const first = pixels(await gl.frame(still.write(size, size)));
    still.seek(8);
    assert.equal(
      difference(first, pixels(await gl.frame(still.write(size, size)))),
      0,
      "reduced motion freezes clouds",
    );
  }
  const cols = args.before ? 6 : 3,
    labelHeight = 32;
  const sheet = ck.MakeSurface(size * cols, (size + labelHeight) * cases.length),
    canvas = sheet.getCanvas();
  canvas.clear(ck.Color(18, 24, 34));
  const fontPath = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ].find(existsSync);
  assert(fontPath, "label font exists");
  const face = ck.Typeface.MakeTypefaceFromData(Uint8Array.from(readFileSync(fontPath)).buffer),
    font = new ck.Font(face, 13),
    ink = new ck.Paint();
  ink.setColor(ck.Color(218, 226, 240));
  for (let i = 0; i < captures.length; i++) {
    const item = captures[i];
    for (let j = 0; j < (args.before ? 2 : 1); j++) {
      const before = args.before && j === 0;
      const image = ck.MakeImageFromEncoded(
        before ? readFileSync(resolve(args.before, `${item.name}.png`)) : item.bytes,
      );
      const x = ((i % 3) + (args.before ? j * 3 : 0)) * size,
        y = Math.floor(i / 3) * (size + labelHeight);
      canvas.drawText(
        `${item.label}${args.before ? (before ? " / before" : " / after") : ""}`,
        x + 10,
        y + 21,
        ink,
        font,
      );
      canvas.drawImage(image, x, y + labelHeight);
      image.delete();
    }
  }
  const image = sheet.makeImageSnapshot();
  writeFileSync(resolve(out, "comparison.png"), image.encodeToBytes());
  if (args.before) {
    const pair = ck.MakeSurface(size * 2, size + labelHeight),
      pairCanvas = pair.getCanvas();
    pairCanvas.clear(ck.Color(18, 24, 34));
    const item = captures.find((capture) => capture.name === "overcast-0");
    for (let i = 0; i < 2; i++) {
      const picture = ck.MakeImageFromEncoded(
        i === 0 ? readFileSync(resolve(args.before, "overcast-0.png")) : item.bytes,
      );
      pairCanvas.drawText(
        i === 0 ? "Overcast / before" : "Overcast / after",
        i * size + 10,
        21,
        ink,
        font,
      );
      pairCanvas.drawImage(picture, i * size, labelHeight);
      picture.delete();
    }
    const picture = pair.makeImageSnapshot();
    writeFileSync(resolve(out, "overcast-comparison.png"), picture.encodeToBytes());
    picture.delete();
    pair.delete();
  }
  for (const obj of [image, ink, font, face, sheet]) obj.delete();
} finally {
  await gl.close();
}
