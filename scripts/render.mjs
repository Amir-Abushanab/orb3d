/**
 * `pnpm render [--preset sunset] [--states idle,thinking] [--time 0] [--size 640] [--level 0]`:
 * render orbs to PNG with headless Chromium, no browser window, into renders/.
 *
 * Draws through the engine directly, not the shell, because the shell (rightly) refuses the
 * software rasterizer headless Chromium has; and with preserveDrawingBuffer so the screenshot reads
 * the frame. Needs `pnpm exec playwright install chromium` once.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const ROOT = resolve(import.meta.dirname, "..");
const BUNDLE = resolve(ROOT, "packages/core/dist/standalone/orb3d.standalone.js");
const OUT = resolve(ROOT, "renders");

const { values } = parseArgs({
  options: {
    preset: { type: "string", default: "sunset" },
    states: { type: "string", default: "all" },
    time: { type: "string", default: "0" },
    size: { type: "string", default: "640" },
    level: { type: "string", default: "0" },
    background: { type: "string", default: "transparent" },
  },
});
const size = Number(values.size);
const ORIGIN = "http://orb3d.render";

const browser = await chromium.launch({
  // Chrome only hands SwiftShader to WebGL when asked to; this is the headless path, not a GPU.
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error(`[page] ${msg.text()}`);
  });
  page.on("pageerror", (err) => console.error(`[page] ${err.message}`));
  await page.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/orb3d.js") {
      return route.fulfill({ contentType: "text/javascript", body: readFileSync(BUNDLE) });
    }
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body style="margin:0;background:${values.background}">
<div id="orb" style="width:${size}px;height:${size}px"></div></body></html>`,
    });
  });
  await page.goto(`${ORIGIN}/`);
  const states = await page.evaluate(
    async ({ preset }) => {
      // A variable, not a literal: this import runs in the page, and tooling should not chase it.
      const runtime = "/orb3d.js";
      const orb = await import(runtime);
      const config = orb.PRESETS[preset]();
      window.orbRenderer = new orb.OrbRenderer(document.getElementById("orb"), config, {
        preserveDrawingBuffer: true,
        respectReducedMotion: false,
      });
      return Object.keys(config.states);
    },
    { preset: values.preset },
  );
  const wanted = values.states === "all" ? states : values.states.split(",");
  mkdirSync(OUT, { recursive: true });
  for (const state of wanted) {
    await page.evaluate(
      ({ name, time, level }) => {
        window.orbRenderer.setState(name, { immediate: true });
        window.orbRenderer.setLevel(level);
        window.orbRenderer.seek(time);
      },
      { name: state, time: Number(values.time), level: Number(values.level) },
    );
    const png = await page.locator("#orb").screenshot({ omitBackground: true });
    const file = resolve(OUT, `${values.preset}-${state}-t${values.time}.png`);
    writeFileSync(file, png);
    console.log(file);
  }
} finally {
  await browser.close();
}
