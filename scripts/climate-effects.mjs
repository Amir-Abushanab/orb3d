import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import CanvasKitInit from "canvaskit-wasm";
import { ensureOrbConfig } from "../packages/core/dist/index.js";
import {
  compileOrb,
  OrbRuntime,
  orbShader,
  VERTEX_SHADER,
} from "../packages/core/dist/program/index.js";
import { createRainMotion } from "./lib/rain-motion.mjs";
import { climateCases } from "./lib/climate-cases.mjs";
const out = resolve("renders/climate");
mkdirSync(out, { recursive: true });
const size = 256,
  ck = await CanvasKitInit(),
  gl = await createRainMotion(size);
const sheet = ck.MakeSurface(size * 3, size * 4),
  paint = new ck.Paint();
function pixels(bytes) {
  const image = ck.MakeImageFromEncoded(bytes);
  const values = image.readPixels(0, 0, {
    width: size,
    height: size,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  });
  image.delete();
  return values;
}
try {
  let i = 0;
  for (const item of climateCases(ensureOrbConfig)) {
    const program = compileOrb(item.config, { shaders: ["glsl", "msl"] }),
      runtime = new OrbRuntime(program);
    runtime.seek(
      item.name === "climate-lightning-sunset"
        ? 2.82
        : item.name === "climate-snow-sunset"
          ? 40
          : item.name === "climate-storm"
            ? 2.82
            : 12,
    );
    const uniforms = runtime.write(size, size);
    await gl.prepare(
      VERTEX_SHADER,
      program.shaders.glsl,
      program.slots,
      program.paint?.pages ?? [],
    );
    const bytes = await gl.frame(uniforms, runtime.paintData);
    writeFileSync(resolve(out, item.name + ".png"), bytes);
    writeFileSync(resolve(out, item.name + ".program.json"), JSON.stringify(program));
    const effect = ck.RuntimeEffect.Make(orbShader("sksl", program), (error) => {
      throw new Error(error);
    });
    assert(effect);
    const shader = effect.makeShader([...uniforms, ...runtime.paintData]),
      surface = ck.MakeSurface(size, size);
    paint.setShader(shader);
    surface.getCanvas().drawPaint(paint);
    const img = surface.makeImageSnapshot();
    writeFileSync(resolve(out, item.name + "-skia.png"), img.encodeToBytes());
    const other = pixels(img.encodeToBytes()),
      reference = pixels(bytes);
    const mad =
      reference.reduce((sum, v, k) => {
        const a = k - (k % 4) + 3;
        return (
          sum +
          Math.abs(
            k % 4 === 3 ? v - other[k] : (v * reference[a]) / 255 - (other[k] * other[a]) / 255,
          )
        );
      }, 0) / reference.length;
    assert(mad < 1.5, `${item.name}: parity ${mad}`);
    console.log(`${item.name}: MAD ${mad.toFixed(3)}; slots ${program.slots}`);
    if (item.name === "climate-overlay")
      assert(
        reference.some((v, k) => k % 4 === 3 && v === 0),
        "overlay retains transparency",
      );
    const image = ck.MakeImageFromEncoded(bytes);
    sheet.getCanvas().drawImage(image, (i % 3) * size, Math.floor(i / 3) * size);
    i++;
    image.delete();
    for (const obj of [img, shader, surface, effect]) obj.delete();
  }
  const img = sheet.makeImageSnapshot();
  writeFileSync(resolve(out, "weather-sheet.png"), img.encodeToBytes());
  img.delete();
  // Prove the largest scene's second uniform page compiles and renders with weather.
  const sunset = ensureOrbConfig({
    contents: { type: "sunset" },
    weather: {
      clouds: { coverage: 0.6 },
      rain: { density: 0.3 },
      hail: { enabled: true, amount: 0.3 },
      ice: { amount: 0.2 },
    },
    states: { idle: {} },
  });
  const p = compileOrb(sunset),
    r = new OrbRuntime(p);
  r.seek(3);
  assert(p.slots > 1024);
  await gl.prepare(VERTEX_SHADER, orbShader("glsl", p), p.slots, p.paint?.pages ?? []);
  writeFileSync(resolve(out, "sunset-page.png"), await gl.frame(r.write(size, size), r.paintData));
  writeFileSync(
    resolve(out, "sunset-page.program.json"),
    JSON.stringify(compileOrb(sunset, { shaders: ["glsl", "msl"] })),
  );
} finally {
  paint.delete();
  sheet.delete();
  await gl.close();
}
