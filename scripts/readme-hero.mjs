// Record Studio itself as the animated README header. Requires Chromium and libwebp's img2webp.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { run } from "./lib/cli.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const FPS = 12;
const FRAMES = 72;

await run(async (defer) => {
  const server = await createServer({
    root: resolve(ROOT, "apps/studio"),
    server: { host: "127.0.0.1", port: 0, hmr: false },
    plugins: [
      {
        name: "readme-capture",
        transform(code, id) {
          // Expose the existing preview only in this recording server, so it can be stepped
          // directly without wall-clock drift or adaptive resolution reacting to the encoder.
          if (id.endsWith("/src/main.ts"))
            return code.replace("renderer.start();", "window.orbReadmeRenderer = renderer;");
        },
      },
    ],
  });
  defer(() => server.close());
  await server.listen();
  const browser = await chromium.launch({
    args:
      process.platform === "darwin"
        ? ["--use-angle=metal", "--ignore-gpu-blocklist"]
        : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  defer(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForSelector("#orb canvas");
  await page
    .locator("#pane select")
    .first()
    .evaluate((select) => {
      select.value = "sunset";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  await page
    .getByRole("button", { name: "thinking", exact: true })
    .evaluate((button) => button.click());
  const frames = mkdtempSync(join(tmpdir(), "orb3d-readme-"));
  defer(() => rmSync(frames, { recursive: true, force: true }));
  for (let i = 0; i < FRAMES; i++) {
    await page.evaluate((time) => window.orbReadmeRenderer.seek(time), i / FPS);
    await page.screenshot({ path: join(frames, `${String(i).padStart(4, "0")}.png`) });
    if ((i + 1) % 24 === 0) console.log(`Recorded ${i + 1}/${FRAMES} frames`);
  }
  if (errors.length) throw new Error(errors.join("\n"));
  mkdirSync(resolve(ROOT, "assets"), { recursive: true });
  const file = resolve(ROOT, "assets/hero.webp");
  execFileSync(
    "img2webp",
    [
      "-loop",
      "0",
      "-lossy",
      "-q",
      "82",
      "-m",
      "6",
      "-d",
      String(Math.round(1000 / FPS)),
      ...Array.from({ length: FRAMES }, (_, i) =>
        join(frames, `${String(i).padStart(4, "0")}.png`),
      ),
      "-o",
      file,
    ],
    { stdio: "inherit" },
  );
  console.log(
    `assets/hero.webp: 1280×720, ${FRAMES} frames, ${(statSync(file).size / 1024 / 1024).toFixed(2)} MiB`,
  );
});
