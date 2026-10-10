import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import CanvasKitInit from "canvaskit-wasm";
import { ensureOrbConfig, gradientColor } from "../packages/core/dist/index.js";
import {
  compileOrb,
  OrbRuntime,
  orbShader,
  VERTEX_SHADER,
} from "../packages/core/dist/program/index.js";
import { createRainMotion } from "./lib/rain-motion.mjs";
import { colorCases } from "./lib/color-cases.mjs";
const size = 256,
  out = resolve("renders/colors");
mkdirSync(out, { recursive: true });
const renderer = await createRainMotion(size),
  ck = await CanvasKitInit();
const pixels = (bytes) => {
  const img = ck.MakeImageFromEncoded(bytes);
  const p = img.readPixels(0, 0, {
    width: size,
    height: size,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  });
  img.delete();
  return p;
};
try {
  for (const item of colorCases(ensureOrbConfig, gradientColor)) {
    const program = compileOrb(item.config),
      runtime = new OrbRuntime(program);
    runtime.seek(0);
    await renderer.prepare(
      VERTEX_SHADER,
      orbShader("glsl", program),
      program.slots,
      program.paint?.pages ?? [],
    );
    const uniforms = runtime.write(size, size),
      bytes = await renderer.frame(uniforms, runtime.paintData);
    writeFileSync(resolve(out, `${item.name}.png`), bytes);
    writeFileSync(resolve(out, `${item.name}.program.json`), JSON.stringify(program));
    if (item.name === "color-mesh")
      writeFileSync(resolve(out, "studio.config.json"), JSON.stringify(item.config));
    const effect = ck.RuntimeEffect.Make(orbShader("sksl", program), (error) => {
      throw new Error(error);
    });
    assert(effect);
    const surface = ck.MakeSurface(size, size),
      paint = new ck.Paint(),
      shader = effect.makeShader([...uniforms, ...runtime.paintData]);
    paint.setShader(shader);
    surface.getCanvas().clear(ck.TRANSPARENT);
    surface.getCanvas().drawPaint(paint);
    const image = surface.makeImageSnapshot();
    writeFileSync(resolve(out, `${item.name}-skia.png`), image.encodeToBytes());
    const reference = pixels(bytes),
      other = pixels(image.encodeToBytes());
    const mad =
      reference.reduce(
        (sum, v, i) =>
          sum +
          Math.abs(
            i % 4 === 3
              ? v - other[i]
              : (v * reference[i - (i % 4) + 3]) / 255 - (other[i] * other[i - (i % 4) + 3]) / 255,
          ),
        0,
      ) / reference.length;
    assert(mad < 1.5, `${item.name}: ${mad}`);
    let edge = 0;
    for (let i = 0; i < size; i++)
      for (const at of [
        i * 4 + 3,
        ((size - 1) * size + i) * 4 + 3,
        i * size * 4 + 3,
        (i * size + size - 1) * 4 + 3,
      ])
        edge = Math.max(edge, reference[at]);
    assert(edge <= 1, `${item.name}: clipped halo/shadow edge alpha ${edge}`);
    console.log(`${item.name}: WebGL/Skia MAD ${mad.toFixed(3)}, edge alpha ${edge}`);
    for (const resource of [image, shader, paint, surface, effect]) resource.delete();
  }
} finally {
  await renderer.close();
}
