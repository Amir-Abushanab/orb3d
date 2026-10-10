/** Inspect the shipping snow effect, distinct crystal identities and ice-to-water transition.
 * Optional --motion writes a close-up review clip and requires ffmpeg on PATH. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import { snowCases } from "./lib/snow-cases.mjs";
import { parseArgs } from "./lib/cli.mjs";

const args = parseArgs(process.argv.slice(2), { motion: false, size: 256 });
const size = args.size,
  out = resolve("renders/snow");
mkdirSync(out, { recursive: true });
const ck = await CanvasKitInit(),
  renderer = await createRainMotion(size);
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
try {
  for (const item of snowCases(ensureOrbConfig)) {
    const program = compileOrb(item.config, { shaders: ["glsl", "msl"] });
    writeFileSync(resolve(out, `${item.name}.program.json`), JSON.stringify(program));
    const runtime = new OrbRuntime(program);
    runtime.seek(12);
    const uniforms = runtime.write(size, size);
    await renderer.prepare(
      VERTEX_SHADER,
      program.shaders.glsl,
      program.slots,
      program.paint?.pages ?? [],
    );
    const bytes = await renderer.frame(uniforms, runtime.paintData);
    writeFileSync(resolve(out, `${item.name}.png`), bytes);
    const effect = ck.RuntimeEffect.Make(orbShader("sksl", program), (error) => {
      throw new Error(error);
    });
    assert(effect);
    const surface = ck.MakeSurface(size, size),
      paint = new ck.Paint(),
      shader = effect.makeShader([...uniforms, ...runtime.paintData]);
    paint.setShader(shader);
    surface.getCanvas().drawPaint(paint);
    const image = surface.makeImageSnapshot(),
      other = pixels(image.encodeToBytes()),
      reference = pixels(bytes);
    const mad = reference.reduce((sum, v, i) => sum + Math.abs(v - other[i]), 0) / reference.length;
    assert(mad < 1.5, `${item.name} WebGL/Skia parity ${mad}`);
    console.log(`${item.name}: MAD ${mad.toFixed(3)}`);
    for (const resource of [image, paint, shader, surface, effect]) resource.delete();
  }
  const config = snowCases(ensureOrbConfig)[0].config;
  config.glass = { ...config.glass, reflection: 0, rim: 0, bounce: 0, outline: 0, edge: 0 };
  config.snow = { ...config.snow, density: 0 };
  const program = compileOrb(config),
    runtime = new OrbRuntime(program);
  await renderer.prepare(VERTEX_SHADER, orbShader("glsl", program), program.slots);
  const sheet = ck.MakeSurface(size * 4, size * 2);
  const hashes = new Set();
  for (let i = 0; i < 8; i++) {
    const snap = runtime.snapshot(),
      s = snap.snow;
    s.live[0] = 2;
    s.radius[0] = 0.42;
    s.pradius[0] = 0.42;
    s.id[0] = i * 17 + 1;
    s.ice[0] = 0.42 ** 3;
    s.phase[0] = 1;
    s.pphase[0] = 1;
    runtime.restore(snap);
    const bytes = await renderer.frame(runtime.write(size, size));
    hashes.add(Buffer.from(bytes).toString("base64"));
    const image = ck.MakeImageFromEncoded(bytes);
    sheet.getCanvas().drawImage(image, (i % 4) * size, Math.floor(i / 4) * size);
    image.delete();
  }
  assert.equal(hashes.size, 8, "distinct crystal renderings");
  const crystalSheet = sheet.makeImageSnapshot();
  writeFileSync(resolve(out, "crystals.png"), crystalSheet.encodeToBytes());
  crystalSheet.delete();
  sheet.delete();
  const phases = [1, 0.8, 0.5, 0.2, 0];
  const melt = ck.MakeSurface(size * phases.length, size);
  for (let i = 0; i < phases.length; i++) {
    const snap = runtime.snapshot(),
      s = snap.snow;
    s.id[0] = 18;
    s.phase[0] = phases[i];
    s.pphase[0] = phases[i];
    s.ice[0] = 0.42 ** 3 * phases[i];
    s.water[0] = 0.42 ** 3 * (1 - phases[i]);
    runtime.restore(snap);
    const image = ck.MakeImageFromEncoded(await renderer.frame(runtime.write(size, size)));
    melt.getCanvas().drawImage(image, i * size, 0);
    image.delete();
  }
  const end = melt.makeImageSnapshot();
  writeFileSync(resolve(out, "melting.png"), end.encodeToBytes());
  end.delete();
  melt.delete();
  // The same saved path must draw exactly the same wet film and fog wipe for rain and snow.
  // Age a released snow path with rain.run=0, so recovery cannot depend on the rain clock.
  const runoffConfig = ensureOrbConfig({
    ...config,
    fog: { ...config.fog, amount: 1, drift: 0 },
    snow: { ...config.snow, density: 0, melt: 0 },
  });
  const runoffProgram = compileOrb(runoffConfig),
    runoff = new OrbRuntime(runoffProgram);
  const runoffSnapshot = runoff.snapshot(),
    wet = runoffSnapshot.snow;
  wet.live[0] = 2;
  wet.id[0] = 18;
  wet.radius[0] = wet.pradius[0] = 0.12;
  wet.x[0] = wet.px[0] = 0.1;
  wet.y[0] = wet.py[0] = 0.6;
  wet.water[0] = 0.12 ** 3;
  runoff.restore(runoffSnapshot);
  for (let i = 0; i < 120; i++) runoff.advance(1 / 60);
  const flowed = runoff.snapshot();
  assert(flowed.snow.y[0] < 0.6, "meltwater drains down in y-up coordinates");
  assert(flowed.rain.source.includes(-2), "snow runoff records a shared rain path");
  const glsl = orbShader("glsl", runoffProgram);
  await renderer.prepare(VERTEX_SHADER, glsl, runoffProgram.slots);
  writeFileSync(resolve(out, "runoff.png"), await renderer.frame(runoff.write(size, size)));
  flowed.snow.live[0] = 0;
  flowed.snow.radius[0] = flowed.snow.pradius[0] = 0;
  runoff.restore(flowed);
  runoff.advance(1 / 60);
  const released = runoff.write(size, size).slice();
  const maskShader = glsl.replace(
    "fragColor = orb(gl_FragCoord.xy);",
    `
    float radius = 0.5 * min(uData[0].x, uData[0].y) * ${runoffConfig.size};
    vec2 face = (gl_FragCoord.xy - uData[0].xy * 0.5) / radius;
    vec4 marks;
    rainScan(face, 1.0 / radius, uData[1], marks);
    fragColor = vec4(vec3(marks.x), 1.0);`,
  );
  await renderer.prepare(VERTEX_SHADER, maskShader, runoffProgram.slots);
  const snowMask = pixels(await renderer.frame(released));
  const asRain = released.slice();
  asRain[runoffProgram.dialSlot * 4 + runoffProgram.snow.amount] = 0;
  for (let i = 0; i < 48; i++) {
    const source = (runoffProgram.rain.trails + i * 8) * 4 + 25;
    if (asRain[source] === -2) asRain[source] = -1;
  }
  assert.deepEqual(
    pixels(await renderer.frame(asRain)),
    snowMask,
    "rain/snow wet trail equivalence",
  );
  const recovery = ck.MakeSurface(size * 4, size);
  let previous = Infinity;
  for (const [i, age] of [0, 2, 4, 9].entries()) {
    const uniforms = released.slice();
    uniforms[4] += age;
    const bytes = await renderer.frame(uniforms),
      mask = pixels(bytes);
    const coverage = mask.reduce((sum, value, at) => sum + (at % 4 === 0 ? value : 0), 0);
    assert(coverage < previous, `fog returns gradually at ${age} seconds`);
    if (age === 9) assert.equal(coverage, 0, "old snow path fully re-fogs");
    previous = coverage;
    const image = ck.MakeImageFromEncoded(bytes);
    recovery.getCanvas().drawImage(image, i * size, 0);
    image.delete();
  }
  const recovered = recovery.makeImageSnapshot();
  writeFileSync(resolve(out, "fog-wipe-recovery.png"), recovered.encodeToBytes());
  recovered.delete();
  recovery.delete();
  console.log("snow runoff: rain-identical wet film/wipe, gradual scene-time re-fogging");
  if (args.motion) {
    config.fog = { ...config.fog, amount: 1, drift: 0 };
    config.snow = { ...config.snow, melt: 0.95, density: 0, stick: 1 };
    const motionProgram = compileOrb(config),
      motionRuntime = new OrbRuntime(motionProgram);
    const snap = motionRuntime.snapshot(),
      s = snap.snow;
    for (const [i, r, x, id] of [
      [0, 0.07, -0.0175, 18],
      [1, 0.045, 0.0175, 69],
    ]) {
      s.live[i] = i === 0 ? 2 : 1;
      s.x[i] = x;
      s.px[i] = x;
      s.y[i] = 0.02;
      s.py[i] = 0.02;
      s.radius[i] = r;
      s.pradius[i] = r;
      s.id[i] = id;
      s.ice[i] = r ** 3;
      s.phase[i] = i === 0 ? 1 : 1.25;
      s.pphase[i] = s.phase[i];
      s.targetX[i] = x;
      s.targetY[i] = 0.02;
      s.incomingX[i] = 0.3;
      s.incomingY[i] = -Math.sqrt(1 - 0.3 ** 2);
      s.flight[i] = i === 0 ? 0 : 0.25;
      if (i === 1) {
        s.x[i] = x - s.incomingX[i] * 0.25;
        s.y[i] = 0.02 - s.incomingY[i] * 0.25;
        s.px[i] = s.x[i];
        s.py[i] = s.y[i];
      }
    }
    motionRuntime.restore(snap);
    const motionShader = orbShader("glsl", motionProgram).replace(
      "fragColor = orb(gl_FragCoord.xy);",
      "fragColor = orb((gl_FragCoord.xy - uData[0].xy * 0.5) * 0.25 + uData[0].xy * 0.5);",
    );
    await renderer.prepare(VERTEX_SHADER, motionShader, motionProgram.slots);
    const dir = resolve(out, "motion");
    mkdirSync(dir, { recursive: true });
    for (let frame = 0; frame < 360; frame++) {
      if (frame > 0) motionRuntime.advance(1 / 24);
      const bytes = await renderer.frame(motionRuntime.write(size, size, 4));
      writeFileSync(resolve(dir, `frame-${String(frame).padStart(4, "0")}.png`), bytes);
    }
    const video = resolve(out, "landing-merge-melt.mp4");
    const result = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-framerate",
        "24",
        "-i",
        resolve(dir, "frame-%04d.png"),
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        video,
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || "ffmpeg is required for --motion");
    console.log(video);
  }
} finally {
  await renderer.close();
}
