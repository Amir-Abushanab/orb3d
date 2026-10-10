/**
 * `node scripts/ensure-standalone.mjs [--force]`: build the standalone bundle only when something
 * it is built from is newer than it, then copy it into apps/studio/public/, where the studio serves
 * it for the embed export.
 *
 * The studio's pre-scripts and `pnpm render` all need the bundle; building it unconditionally
 * would run the same Vite build several times over in one `pnpm check && pnpm build`.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CORE = resolve(ROOT, "packages/core");
const BUNDLE = resolve(CORE, "dist/standalone/orb3d.standalone.js");
const STUDIO_PUBLIC = resolve(ROOT, "apps/studio/public");
const INPUTS = [
  resolve(CORE, "src"),
  resolve(CORE, "vite.standalone.config.ts"),
  resolve(CORE, "package.json"),
  resolve(CORE, "tsconfig.json"),
  resolve(ROOT, "pnpm-lock.yaml"),
];

/** The newest mtime under a path. A directory's own mtime ignores edits inside it. */
function newest(path) {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let latest = 0;
  for (const entry of readdirSync(path)) latest = Math.max(latest, newest(resolve(path, entry)));
  return latest;
}

const force = process.argv.includes("--force");
const stale = force || !existsSync(BUNDLE) || INPUTS.some((p) => newest(p) > newest(BUNDLE));
if (stale) {
  const result = spawnSync("pnpm", ["--filter", "@orb3d/core", "build:standalone"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
mkdirSync(STUDIO_PUBLIC, { recursive: true });
copyFileSync(BUNDLE, resolve(STUDIO_PUBLIC, basename(BUNDLE)));
