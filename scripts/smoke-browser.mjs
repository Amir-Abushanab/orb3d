// Run the built wrappers in Chromium: actual React effects, custom-element upgrades and fetches.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { run } from "./lib/cli.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const require = createRequire(resolve(ROOT, "package.json"));
const reactRequire = createRequire(resolve(ROOT, "packages/react/package.json"));
const fixture = "/orb3d-review.js";

await run(async (defer) => {
  const server = await createServer({
    root: ROOT,
    configFile: false,
    server: { host: "127.0.0.1", port: 0 },
    resolve: {
      alias: [
        { find: /^react$/, replacement: reactRequire.resolve("react") },
        { find: /^react-dom\/client$/, replacement: require.resolve("react-dom/client") },
        { find: /^react-dom$/, replacement: require.resolve("react-dom") },
        ...[
          ["@orb3d/core/presets", "packages/core/dist/presets.js"],
          ["@orb3d/core/renderer", "packages/core/dist/renderer/index.js"],
          ["@orb3d/core", "packages/core/dist/index.js"],
          ["@orb3d/react", "packages/react/dist/index.js"],
          ["@orb3d/element", "packages/element/dist/index.js"],
        ].map(([find, file]) => ({ find, replacement: resolve(ROOT, file) })),
      ],
    },
    plugins: [
      {
        name: "review-fixture",
        resolveId: (id) => (id === fixture ? fixture : undefined),
        load: (id) =>
          id === fixture
            ? `
        import { createElement, createRef, StrictMode } from "react";
        import { createRoot } from "react-dom/client";
        import { flushSync } from "react-dom";
        import { Orb3D } from "@orb3d/react";
        const root = createRoot(document.getElementById("root"));
        window.orb = createRef();
        window.renderOrb = ({ functionPreset, ...props }) => flushSync(() => root.render(
          createElement(StrictMode, null, createElement(Orb3D, {
            webgl: "force", lazy: false, style: { width: 96, height: 96 },
            ...props, ...(functionPreset ? {preset: () => ({speed: 3})} : {}), ref: window.orb,
          }))
        ));
        window.ready = true;
      `
            : undefined,
      },
    ],
  });
  defer(() => server.close());
  await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, "");
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  defer(() => browser.close());
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route(`${origin}/fixture`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<div id="root"></div><script type="module" src="${fixture}"></script>`,
    }),
  );
  let releasePreset;
  let presetRequested;
  const requested = new Promise((done) => {
    presetRequested = done;
  });
  const released = new Promise((done) => {
    releasePreset = done;
  });
  await page.route("**/presets.js", async (route) => {
    presetRequested();
    await released;
    await route.continue();
  });
  await page.goto(`${origin}/fixture`);
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => window.renderOrb({ preset: "aura", config: { speed: 2 } }));
  await requested;
  await page.evaluate(() =>
    window.renderOrb({ functionPreset: true, state: "thinking", config: { state: "muted" } }),
  );
  releasePreset();
  await page.waitForFunction(() => window.orb.current?.renderer?.getConfig().speed === 3);
  await page.waitForFunction(() => window.orb.current?.state === "thinking");
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => window.orb.current.renderer.getConfig().contents.type),
    "none",
  );
  assert.equal(await page.locator("#root canvas").count(), 1, "StrictMode leaked a canvas");
  await page.evaluate(() => {
    window.renderOrb({ preset: "aura", config: { speed: 2 } });
    window.renderOrb({ functionPreset: true, config: { speed: 4 } });
  });
  await page.waitForFunction(() => window.orb.current?.renderer?.getConfig().speed === 4);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.orb.current.renderer.getConfig().speed), 4);
  console.log(
    "React: latest config wins async preset loads; controlled state and StrictMode passed",
  );

  await page.evaluate(async () => {
    const el = document.createElement("orb-3d");
    el.id = "element";
    el.style.cssText = "width:96px;height:96px";
    el.setAttribute("webgl", "force");
    el.setAttribute("lazy", "false");
    el.config = { speed: 2 };
    document.body.append(el);
    const module = "/packages/element/dist/index.js";
    const { register } = await import(module);
    const tag = "launch-orb";
    register(tag);
    document.body.append(document.createElement(tag));
  });
  await page.waitForFunction(
    () => document.getElementById("element").handle?.renderer?.getConfig().speed === 2,
  );
  assert.equal(
    await page.evaluate(() => Object.hasOwn(document.getElementById("element"), "config")),
    false,
  );
  assert.equal(await page.evaluate(() => !!customElements.get("launch-orb")), true);

  let finishOld;
  let oldRequested;
  const oldRequest = new Promise((done) => {
    oldRequested = done;
  });
  const oldResponse = new Promise((done) => {
    finishOld = done;
  });
  await page.route("**/old.json", async (route) => {
    oldRequested();
    await oldResponse;
    await route.fulfill({ json: { speed: 1, glass: { frost: 0.7 } } });
  });
  await page.route("**/new.json", (route) =>
    route.fulfill({ json: { speed: 4, glass: { frost: 0.2 } } }),
  );
  await page.evaluate(() => {
    const el = document.getElementById("element");
    el.config = {};
    el.setAttribute("src", "/old.json");
  });
  await oldRequest;
  await page.evaluate(() => document.getElementById("element").setAttribute("src", "/new.json"));
  await page.waitForFunction(
    () => document.getElementById("element").handle.renderer.getConfig().speed === 4,
  );
  finishOld();
  await page.waitForTimeout(150);
  assert.equal(
    await page.evaluate(() => document.getElementById("element").handle.renderer.getConfig().speed),
    4,
  );
  await page.evaluate(() => document.getElementById("element").setAttribute("config", "null"));
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const element = document.createElement("orb-3d");
    element.style.cssText = "width:96px;height:96px";
    element.setAttribute("webgl", "force");
    element.setAttribute("lazy", "false");
    element.addEventListener("orb3d-phase", () => element.remove(), { once: true });
    window.removedOrb = element;
    document.body.append(element);
  });
  await page.waitForFunction(() => !window.removedOrb.isConnected);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.removedOrb.handle), null);
  assert.equal(await page.evaluate(() => window.removedOrb.querySelectorAll("canvas").length), 0);
  console.log(
    "Custom element: pre-upgrade config, custom tags, invalid JSON and stale fetches passed",
  );
  assert.deepEqual(errors, []);

  // The poster command: a preset drawn to a small PNG through the engine it ships with.
  const scratch = mkdtempSync(join(tmpdir(), "orb3d-poster-"));
  defer(() => rmSync(scratch, { recursive: true, force: true }));
  const poster = join(scratch, "sunset.png");
  const bin = resolve(ROOT, "packages/core/bin/orb3d.mjs");
  const args = ["--preset", "sunset", "--size", "32", "--supersample", "2", "--out", poster];
  execFileSync(process.execPath, [bin, "poster", ...args]);
  const png = readFileSync(poster);
  assert.equal(png.toString("latin1", 12, 16), "IHDR");
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [32, 32]);
  console.log("Poster command: a preset drawn to a 32px PNG passed");
});
