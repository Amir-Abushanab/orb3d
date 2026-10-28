#!/usr/bin/env node
// Exercise pnpm's publish manifests and tarballs outside the workspace. In particular, each
// React Native consumer sees only ONE Skia peer, so optional peers cannot mask missing types.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = mkdtempSync(join(realpathSync(tmpdir()), "orb3d-package-smoke-"));
const packages = readdirSync(join(root, "packages"))
  .map((dir) => ({ dir, ...JSON.parse(readFileSync(join(root, "packages", dir, "package.json"))) }))
  .filter((pkg) => !pkg.private);

function linkPeer(modules, name, owner) {
  const target = join(modules, name);
  mkdirSync(resolve(target, ".."), { recursive: true });
  symlinkSync(
    realpathSync(join(root, "packages", owner, "node_modules", name)),
    target,
    "junction",
  );
}

function checkTypes(fixture, source, native = false) {
  const file = join(fixture, "consumer.ts");
  writeFileSync(file, source);
  const program = ts.createProgram([file], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    customConditions: native ? ["react-native"] : [],
    lib: native ? ["lib.es2022.d.ts"] : ["lib.es2022.d.ts", "lib.dom.d.ts"],
    types: ["react"],
    typeRoots: [join(fixture, "node_modules", "@types")],
    strict: true,
    skipLibCheck: false,
    noEmit: true,
  });
  // Keep declaration checking on for our tarballs, including unresolved optional imports.
  // React Native's own declarations currently have strict errors; those belong upstream and
  // must not prevent checking the consumer and every declaration we actually publish.
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => !diagnostic.file || diagnostic.file.fileName.startsWith(`${fixture}/`));
  if (diagnostics.length) {
    throw new Error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => fixture,
        getCanonicalFileName: (name) => name,
        getNewLine: () => "\n",
      }),
    );
  }
}

function checkExportFiles(value, dir) {
  if (typeof value === "string") {
    assert(value.startsWith("./"), `Non-local package export: ${value}`);
    assert(existsSync(join(dir, value)), `Missing packed export: ${dir}/${value}`);
  } else {
    for (const nested of Object.values(value)) checkExportFiles(nested, dir);
  }
}

try {
  const archives = new Map();
  for (const pkg of packages) {
    const archive = join(scratch, `${pkg.dir}.tgz`);
    execFileSync("pnpm", ["pack", "--out", archive], {
      cwd: join(root, "packages", pkg.dir),
      stdio: "pipe",
    });
    archives.set(pkg.name, archive);
  }

  function consumer(name) {
    const fixture = join(scratch, name);
    const modules = join(fixture, "node_modules");
    mkdirSync(modules, { recursive: true });
    writeFileSync(join(fixture, "package.json"), '{"private":true,"type":"module"}');
    for (const pkg of packages) {
      const dir = join(modules, pkg.name);
      mkdirSync(dir, { recursive: true });
      execFileSync("tar", ["-xzf", archives.get(pkg.name), "--strip-components=1", "-C", dir]);
      const manifest = JSON.parse(readFileSync(join(dir, "package.json")));
      checkExportFiles(manifest.exports, dir);
      for (const version of Object.values(manifest.dependencies ?? {})) {
        assert(!version.startsWith("workspace:"), `Unrewritten dependency in ${pkg.name}`);
      }
    }
    return { fixture, modules };
  }

  const web = consumer("web");
  linkPeer(web.modules, "react", "react");
  linkPeer(web.modules, "@types/react", "react");
  const require = createRequire(join(web.fixture, "package.json"));
  for (const name of [
    "@orb3d/core",
    "@orb3d/core/program",
    "@orb3d/core/presets",
    "@orb3d/core/renderer",
    "@orb3d/core/standalone",
    "@orb3d/react",
    "@orb3d/element",
  ]) {
    await import(pathToFileURL(require.resolve(name)));
  }
  assert.match(readFileSync(require.resolve("@orb3d/react"), "utf8"), /^\s*["']use client["']/);
  const help = execFileSync(process.execPath, [join(web.modules, "@orb3d/core/bin/orb3d.mjs")], {
    encoding: "utf8",
  });
  assert.match(help, /orb3d poster/);
  checkTypes(
    web.fixture,
    `import { createElement } from "react";
import { createOrb } from "@orb3d/core";
import { compileOrb } from "@orb3d/core/program";
import { PRESETS } from "@orb3d/core/presets";
import { Orb3D } from "@orb3d/react";
import { Orb3DElement } from "@orb3d/element";
export const component = createElement(Orb3D, { preset: "aura", level: 0.8 });
// The documented partial config: the rest of the contents and the glass come from the defaults.
export const picture = createElement(Orb3D, {
  config: { contents: { type: "image", src: "/avatar.jpg" }, glass: { frost: 0.15 } },
});
// @ts-expect-error A partial config must still reject values its kind does not take.
export const stretched = createElement(Orb3D, { config: { contents: { type: "image", fit: "fill" } } });
export const program = compileOrb(PRESETS.aura());
export const mount = createOrb;
export const element = Orb3DElement;
`,
  );
  console.log("Packed web packages: exports, SSR imports and strict consumer types passed");

  for (const skia of ["@shopify/react-native-skia", "react-native-skia"]) {
    const { fixture, modules } = consumer(skia.startsWith("@") ? "skia2" : "skia3");
    for (const peer of [
      "react",
      "@types/react",
      "react-native",
      "react-native-reanimated",
      "react-native-worklets",
      skia,
    ]) {
      linkPeer(modules, peer, "react-native");
    }
    checkTypes(
      fixture,
      `import { createElement } from "react";
import { Orb3D, type OrbSource } from "@orb3d/react-native";
const sources: OrbSource[] = ["https://example.com/image.jpg", 1, new Uint8Array(4),
  {uri: "asset.jpg", width: 10, height: 10}, {__esModule: true, default: 1}, null];
export const component = createElement(Orb3D, { source: sources[0], preset: "aura" });
export const picture = createElement(Orb3D, { config: { contents: { type: "image" } }, source: 1 });
// @ts-expect-error Source must remain typed, rather than degrading to any.
export const invalid: OrbSource = false;
`,
      true,
    );
    console.log(`Packed React Native package: strict types with only ${skia} passed`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
