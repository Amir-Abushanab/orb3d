/** Render the sun controls and probe the shipping shader at extreme positions/angles. */
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
import { sunCases } from "./lib/sun-cases.mjs";

const size = 128;
const out = resolve("renders/sun");
mkdirSync(out, { recursive: true });
const ck = await CanvasKitInit();
const renderer = await createRainMotion(size);
function pixelsOf(bytes) {
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
}
try {
  for (const item of sunCases(ensureOrbConfig)) {
    const program = compileOrb(item.config, { shaders: ["glsl", "msl"] });
    const runtime = new OrbRuntime(program);
    runtime.seek(4);
    await renderer.prepare(VERTEX_SHADER, program.shaders.glsl, program.slots);
    writeFileSync(
      resolve(out, `${item.name}.png`),
      await renderer.frame(runtime.write(size, size)),
    );
    writeFileSync(resolve(out, `${item.name}.program.json`), JSON.stringify(program));
  }

  const program = compileOrb(ensureOrbConfig({}));
  const shader = orbShader("glsl", program);
  const start = shader.indexOf("vec4 orb(");
  const end = shader.indexOf("\nvoid main", start);
  const probe =
    shader.slice(0, start) +
    `vec4 orb(vec2 frag) {
    vec3 incoming = lightDir();
    vec2 spot = lightSpot();
    bool valid = abs(length(incoming) - 1.0) < 0.0001 && length(spot) <= 1.001;
    return valid ? vec4(incoming * 0.5 + 0.5, 1.0) : vec4(1.0, 0.0, 1.0, 0.0);
  }` +
    shader.slice(end);
  await renderer.prepare(VERTEX_SHADER, probe, program.slots);
  for (const x of [-3, -0.36, 0, 1, 3]) {
    for (const y of [-3, 0, 0.5, 3]) {
      for (const elevation of [-90, 0, 90]) {
        const config = ensureOrbConfig({ light: { x, y, elevation }, states: { idle: {} } });
        const data = new OrbRuntime(compileOrb(config)).write(size, size);
        const rgba = pixelsOf(await renderer.frame(data)).slice(0, 4);
        assert.equal(
          rgba[3],
          255,
          `finite unit light and half-vector at ${x},${y},${elevation}: ${rgba}`,
        );
        if (elevation === 0 && Math.hypot(x, y) < 0.999) {
          const z = Math.sqrt(1 - x * x - y * y);
          const legacy = [2 * z * x, 2 * z * y, 2 * z * z - 1];
          legacy.forEach((value, i) => assert(Math.abs(rgba[i] - (value * 0.5 + 0.5) * 255) <= 1));
        }
      }
    }
  }
  // Changing incidence must move the specular lighting while keeping the source in place.
  const config = sunCases(ensureOrbConfig)[1].config;
  config.sunny = { ...config.sunny, rays: 0, flare: 0, sparkle: 1 };
  const lit = compileOrb(config);
  await renderer.prepare(VERTEX_SHADER, orbShader("glsl", lit), lit.slots);
  const first = pixelsOf(await renderer.frame(new OrbRuntime(lit).write(size, size)));
  config.light.elevation = -35;
  const second = pixelsOf(
    await renderer.frame(new OrbRuntime(compileOrb(config)).write(size, size)),
  );
  const difference =
    first.reduce((sum, value, i) => sum + Math.abs(value - second[i]), 0) / first.length;
  let changedPixels = 0;
  for (let i = 0; i < first.length; i += 4) {
    if ([0, 1, 2].some((channel) => Math.abs(first[i + channel] - second[i + channel]) > 12))
      changedPixels++;
  }
  assert(changedPixels >= 128, `incidence changes visible highlights: ${changedPixels} pixels`);
  console.log(
    `60 extreme-angle probes, legacy incidence and independent elevation: ok (${changedPixels} changed pixels; MAD ${difference.toFixed(3)})`,
  );
} finally {
  await renderer.close();
}
