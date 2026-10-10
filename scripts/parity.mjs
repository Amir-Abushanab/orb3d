/**
 * `pnpm parity [--metal] [--images dir] [--only case,case] [--size 256] [--time 3] [--tolerance 1.5]`:
 * draw every
 * preset in every state, plus a picture and a shader of your own, through the dialects of the one
 * shader and compare the pixels: the GLSL that WebGL and Android run (in headless Chromium) against
 * the SkSL that React Native Skia runs (through CanvasKit, Skia's own WebAssembly build, which
 * compiles SkSL with the same compiler) and, with `--metal` on a Mac, the MSL the Swift package
 * runs (through `swift run orb3d-render`). With `--images <dir>` it also compares
 * `<dir>/<case>-<state>.png` drawn elsewhere, such as the Android sample's renders from a device,
 * which draws the cases that are not presets from the programs `--programs <dir>` writes (see
 * CONTRIBUTING.md). Exits non-zero past the tolerance, a mean difference per channel on the 0–255
 * scale.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import CanvasKitInit from "canvaskit-wasm";
import { chromium } from "playwright";
import { parseArgs, run } from "./lib/cli.mjs";
import { climateCases } from "./lib/climate-cases.mjs";
import { weatherCases } from "./lib/weather-cases.mjs";
import { sunCases } from "./lib/sun-cases.mjs";
import { colorCases } from "./lib/color-cases.mjs";
import { snowCases } from "./lib/snow-cases.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = resolve(ROOT, "packages/core/dist");
const BUNDLE = resolve(DIST, "standalone/orb3d.standalone.js");
/** The picture the image case holds: the studio's sample. */
const PICTURE = resolve(ROOT, "apps/studio/public/samples/lake.jpg");

/** Mean absolute difference per channel of two same-sized RGBA arrays. */
function meanDiff(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const alpha = i - (i % 4) + 3;
    sum += Math.abs(i % 4 === 3 ? a[i] - b[i] : (a[i] * a[alpha]) / 255 - (b[i] * b[alpha]) / 255);
  }
  return sum / a.length;
}

const USAGE = `usage: node scripts/parity.mjs [--hardware] [--metal] [--images dir] [--only case,case] [--size 256] [--time 3] [--tolerance 1.5]
       node scripts/parity.mjs --programs dir   (write the cases that are not presets as programs)`;

await run(async (defer) => {
  const args = parseArgs(process.argv.slice(2), {
    metal: false,
    hardware: false,
    images: "",
    size: 256,
    time: 3,
    tolerance: 1.5,
    only: "",
    programs: "",
  });
  if (args.help) return void console.log(USAGE);
  const only = args.only ? args.only.split(",") : null;
  const { size, time, tolerance } = args;

  // Built output, as every script here reads: what ships is what is checked.
  const { compileOrb, OrbRuntime, orbShader, paintKey } = await import(
    resolve(DIST, "program/index.js")
  );
  const { ensureOrbConfig, gradientColor } = await import(resolve(DIST, "index.js"));
  const { PRESETS, PRESET_NAMES } = await import(resolve(DIST, "presets.js"));

  /** What is drawn: every preset, a picture in the glass, and the default shader of your own. */
  const cases = [
    ...PRESET_NAMES.map((name) => ({ name, preset: name, config: PRESETS[name]() })),
    {
      name: "image",
      config: ensureOrbConfig({ contents: { type: "image", src: "/lake.jpg" } }),
      picture: PICTURE,
    },
    { name: "shader", config: ensureOrbConfig({ contents: { type: "shader" } }) },
    ...weatherCases(ensureOrbConfig),
    ...climateCases(ensureOrbConfig),
    ...sunCases(ensureOrbConfig),
    ...snowCases(ensureOrbConfig),
    ...colorCases(ensureOrbConfig, gradientColor),
  ];

  // For a platform that runs programs rather than configs (the Android sample): the cases that are
  // not presets, as programs, with the picture beside them. Then stop.
  if (args.programs) {
    mkdirSync(args.programs, { recursive: true });
    for (const item of cases.filter((c) => !c.preset)) {
      const own = item.config.contents.type === "shader";
      const program = compileOrb(item.config, own ? { shaders: ["glsl", "msl"] } : {});
      writeFileSync(join(args.programs, `${item.name}.program.json`), JSON.stringify(program));
    }
    copyFileSync(PICTURE, join(args.programs, "picture.jpg"));
    return true;
  }

  const ck = await CanvasKitInit();
  const effects = new Map();
  const effectFor = (program) => {
    const key = `${program.features}:${program.contents}:${paintKey(program.paint)}:${program.code ?? ""}`;
    if (!effects.has(key)) {
      effects.set(
        key,
        ck.RuntimeEffect.Make(orbShader("sksl", program), (error) => {
          throw new Error(`SkSL for ${program.contents} did not compile: ${error}`);
        }),
      );
    }
    return effects.get(key);
  };

  const browser = await chromium.launch({
    args: args.hardware
      ? process.platform === "darwin"
        ? ["--use-angle=metal", "--ignore-gpu-blocklist"]
        : ["--ignore-gpu-blocklist"]
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  defer(() => browser.close());
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const origin = "http://orb3d.parity";
  await page.route(`${origin}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/orb3d.js") {
      return route.fulfill({ contentType: "text/javascript", body: readFileSync(BUNDLE) });
    }
    if (path === "/lake.jpg") {
      return route.fulfill({ contentType: "image/jpeg", body: readFileSync(PICTURE) });
    }
    return route.fulfill({
      contentType: "text/html",
      body: `<body style="margin:0"><div id="orb" style="width:${size}px;height:${size}px"></div>`,
    });
  });
  await page.goto(`${origin}/`);

  /** RGBA bytes, unpremultiplied, of an encoded image. */
  const decode = (bytes) => {
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

  const skia = (config, state, picture) => {
    const program = compileOrb(config);
    const runtime = new OrbRuntime(program, state);
    const owned = [];
    const children = [];
    if (picture) {
      // As React Native does: the picture scaled toward the orb's size, so Skia picks a mipmap.
      const image = ck.MakeImageFromEncoded(readFileSync(picture));
      const scale = Math.min(1, size / Math.min(image.width(), image.height()));
      runtime.setMedia(image.width() * scale, image.height() * scale);
      const shader = image.makeShaderOptions(
        ck.TileMode.Clamp,
        ck.TileMode.Clamp,
        ck.FilterMode.Linear,
        ck.MipmapMode.Linear,
        ck.Matrix.scaled(scale, scale),
      );
      children.push(shader);
      owned.push(image, shader);
    }
    runtime.seek(time);
    const effect = effectFor(program);
    const uniforms = [...runtime.write(size, size, 1), ...runtime.paintData];
    const shader = children.length
      ? effect.makeShaderWithChildren(uniforms, children)
      : effect.makeShader(uniforms);
    const surface = ck.MakeSurface(size, size);
    const canvas = surface.getCanvas();
    canvas.clear(ck.TRANSPARENT);
    const paint = new ck.Paint();
    paint.setShader(shader);
    canvas.drawPaint(paint);
    const image = surface.makeImageSnapshot();
    const pixels = decode(image.encodeToBytes());
    for (const item of [image, paint, shader, surface, ...owned]) item.delete();
    return pixels;
  };

  const webgl = async (config, state) => {
    await page.evaluate(
      async (frame) => {
        const runtime = "/orb3d.js";
        const orb = await import(runtime);
        window.orbRenderer?.dispose();
        const renderer = new orb.OrbRenderer(
          document.getElementById("orb"),
          { ...frame.config, state: frame.state },
          { preserveDrawingBuffer: true, respectReducedMotion: false },
        );
        window.orbRenderer = renderer;
        // A picture loads in the background: draw the frame to compare once it has.
        for (let waited = 0; renderer.mediaLoading && waited < 5000; waited += 25) {
          await new Promise((done) => setTimeout(done, 25));
        }
        renderer.seek(frame.time);
      },
      { config, state, time },
    );
    return decode(await page.locator("#orb").screenshot({ omitBackground: true }));
  };

  /** Every state of a case through the Swift package's Metal pipeline, by state name. */
  const metal = (item) => {
    const dir = mkdtempSync(join(tmpdir(), "orb3d-metal-"));
    defer(() => rmSync(dir, { recursive: true, force: true }));
    const out = join(dir, `${item.name}.png`);
    let source = ["--preset", item.preset];
    if (!item.preset) {
      const file = join(dir, `${item.name}.program.json`);
      const own = item.config.contents.type === "shader";
      writeFileSync(file, JSON.stringify(compileOrb(item.config, own ? { shaders: ["msl"] } : {})));
      source = ["--program", file];
    }
    const result = spawnSync(
      "swift",
      [
        "run",
        "-c",
        "release",
        "orb3d-render",
        ...source,
        ...(item.picture ? ["--image", item.picture] : []),
        "--state",
        "all",
        "--time",
        String(time),
        "--size",
        String(size),
        "--out",
        out,
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    if (result.status !== 0) throw new Error(`orb3d-render failed:\n${result.stderr}`);
    return (state) => decode(readFileSync(join(dir, `${item.name}-${state}.png`)));
  };

  let failed = false;
  for (const item of cases.filter((c) => !only || only.includes(c.name))) {
    const fromMetal = args.metal ? metal(item) : null;
    for (const state of Object.keys(item.config.states)) {
      const reference = await webgl(item.config, state);
      const results = [["skia", meanDiff(skia(item.config, state, item.picture), reference)]];
      if (fromMetal) results.push(["metal", meanDiff(fromMetal(state), reference)]);
      if (args.images) {
        const file = resolve(args.images, `${item.name}-${state}.png`);
        results.push(["images", meanDiff(decode(readFileSync(file)), reference)]);
      }
      const ok = results.every(([, mean]) => mean <= tolerance);
      failed ||= !ok;
      const report = results.map(([name, mean]) => `${name} ${mean.toFixed(3)}`).join("  ");
      console.log(`${ok ? "ok  " : "FAIL"} ${`${item.name}/${state}`.padEnd(20)} ${report}`);
    }
  }
  for (const effect of effects.values()) effect.delete();
  return !failed;
});
