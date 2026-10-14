#!/usr/bin/env node
// `orb3d poster`: render an orb's poster to a file, in headless Chromium, with no browser window.
//
//   orb3d poster --preset sunset --size 96 --out public/mark.png
//   orb3d poster --config orb.json --state thinking --time 2 --out thinking.webp
//
// It draws through the engine directly, because the shell (rightly) refuses the software
// rasterizer headless Chromium has, and draws on SwiftShader on every machine, so the same config
// gives the same file wherever it runs. Playwright is an optional peer: install it, then its
// Chromium once (`pnpm exec playwright install chromium`).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const HELP = `orb3d poster: render an orb's poster to a file

  --preset <name>     a built-in preset (clear, aura, landscape, sunset, dawn, storm, night)
  --config <file>     a config as JSON, such as Orb Studio's export; over the preset if both
  --state <name>      the state to draw (default: the config's opening state)
  --time <seconds>    the moment to draw (default 0, the frame the orb opens on)
  --level <0-1>       the input level (default 0)
  --size <px>         the poster's width and height (default 256)
  --supersample <n>   draw at n times the size and scale down (default 4; 1 to draw at size)
  --quality <0-1>     encoder quality for .webp and .jpg
  --out <file>        where to write it: .png, .webp or .jpg (default poster.png)

A picture or clip the config names by a relative path is read from the config's folder.`;

const TYPES = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};
const ORIGIN = "http://orb3d.poster";

function fail(message) {
  console.error(`orb3d: ${message}`);
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
if (command !== "poster") {
  console.log(HELP);
  process.exit(command === undefined || command === "--help" || command === "-h" ? 0 : 1);
}
const { values } = parseArgs({
  args: rest,
  options: {
    preset: { type: "string" },
    config: { type: "string" },
    state: { type: "string" },
    time: { type: "string", default: "0" },
    level: { type: "string", default: "0" },
    size: { type: "string", default: "256" },
    supersample: { type: "string", default: "4" },
    quality: { type: "string" },
    out: { type: "string", default: "poster.png" },
    help: { type: "boolean", short: "h" },
  },
});
if (values.help) {
  console.log(HELP);
  process.exit(0);
}
const number = (name, min, max) => {
  const value = Number(values[name]);
  if (!Number.isFinite(value) || value < min || value > max)
    fail(`--${name} wants ${min} to ${max}`);
  return value;
};
const size = Math.round(number("size", 1, 4096));
const scale = Math.round(number("supersample", 1, 8));
if (size * scale > 8192) fail("--size × --supersample is past 8192 pixels");
const out = resolve(values.out);
const type =
  TYPES[extname(out).toLowerCase()] ?? fail(`--out must end in ${Object.keys(TYPES).join(", ")}`);
if (!values.preset && !values.config) fail("name a --preset or a --config");
const config = values.config ? JSON.parse(readFileSync(values.config, "utf8")) : undefined;
const folder = values.config ? dirname(resolve(values.config)) : process.cwd();
const engine = fileURLToPath(new URL("../dist/standalone/orb3d.standalone.js", import.meta.url));
if (!existsSync(engine)) fail(`the engine is missing at ${engine}: build @orb3d/core first`);

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  fail("orb3d poster needs Playwright: install it beside @orb3d/core (`pnpm add -D playwright`)");
}
let browser;
try {
  browser = await chromium.launch({
    // SwiftShader, asked for by name: the same pixels on every machine.
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
} catch (error) {
  fail(
    `Playwright's Chromium did not start (\`pnpm exec playwright install chromium\`):\n${error.message}`,
  );
}
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path === "/")
      return route.fulfill({ contentType: "text/html", body: "<!doctype html><body>" });
    if (path === "/orb3d.js") {
      return route.fulfill({ contentType: "text/javascript", body: readFileSync(engine) });
    }
    // A picture or clip named by a relative path, from the config's folder.
    const file = resolve(folder, `.${path}`);
    const inside = relative(folder, file);
    if (inside.startsWith("..") || isAbsolute(inside) || !existsSync(file)) {
      return route.fulfill({ status: 404 });
    }
    return route.fulfill({ body: readFileSync(file) });
  });
  await page.goto(`${ORIGIN}/`);
  const bytes = await page.evaluate(
    async (ask) => {
      // A variable, not a literal: the page imports it, and tooling should not chase it.
      const runtime = "/orb3d.js";
      const orb = await import(runtime);
      const base = ask.preset === undefined ? undefined : orb.PRESETS[ask.preset]?.();
      if (ask.preset !== undefined && !base) {
        throw new Error(`no preset "${ask.preset}": ${Object.keys(orb.PRESETS).join(", ")}`);
      }
      const full = base && ask.config ? orb.mergeOrbConfig(base, ask.config) : (ask.config ?? base);
      const host = document.body.appendChild(document.createElement("div"));
      host.style.width = host.style.height = `${ask.size * ask.scale}px`;
      const renderer = new orb.OrbRenderer(host, full, { respectReducedMotion: false });
      if (ask.state !== undefined) renderer.setState(ask.state, { immediate: true });
      renderer.setLevel(ask.level);
      for (let waited = 0; renderer.mediaLoading && waited < 15000; waited += 50) {
        await new Promise((done) => setTimeout(done, 50));
      }
      let blob = await renderer.captureImage("image/png", undefined, ask.time);
      renderer.dispose();
      if (ask.scale > 1 || ask.type !== "image/png") {
        const bitmap = await createImageBitmap(blob, {
          resizeWidth: ask.size,
          resizeHeight: ask.size,
          resizeQuality: "high",
          premultiplyAlpha: "premultiply",
        });
        const canvas = new OffscreenCanvas(ask.size, ask.size);
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        blob = await canvas.convertToBlob({ type: ask.type, quality: ask.quality });
      }
      return [...new Uint8Array(await blob.arrayBuffer())];
    },
    {
      preset: values.preset,
      config,
      state: values.state,
      time: number("time", 0, 86400),
      level: number("level", 0, 1),
      size,
      scale,
      type,
      quality: values.quality === undefined ? undefined : number("quality", 0, 1),
    },
  );
  if (errors.length) throw new Error(errors.join("\n"));
  writeFileSync(out, Uint8Array.from(bytes));
  console.log(`${basename(out)}: ${size}×${size}, ${bytes.length} bytes`);
} catch (error) {
  // The page's own error, without Playwright's prefix and the evaluated script's stack.
  console.error(
    `orb3d: ${error.message.replace(/^page\.evaluate: (?:Error: )?/, "").split("\n")[0]}`,
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
