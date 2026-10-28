// What leaves the studio: code for each framework, the config, a poster, a share link and a
// self-contained embed page. Code carries only what differs from the preset, so a light edit
// makes a short snippet rather than a wall of every value.
import { CONTENTS, stateNames, type OrbConfig } from "@orb3d/core";
import { compileOrb } from "@orb3d/core/program";
import { PRESETS, isPresetName } from "@orb3d/core/presets";

export type Framework =
  | "react"
  | "element"
  | "vanilla"
  | "cdn"
  | "react-native"
  | "swiftui"
  | "android";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** What `value` changes over `before`: objects all the way down, arrays and values whole. */
function diffValue(before: unknown, value: unknown): unknown {
  if (same(before, value)) return undefined;
  if (!isPlainObject(value) || !isPlainObject(before)) return value;
  const block: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    const change = diffValue(before[key], inner);
    if (change !== undefined) block[key] = change;
  }
  return block;
}

/**
 * What `next` changes over `base`, in the shape `mergeOrbConfig` reads back: blocks as deep as
 * they go, arrays whole, and changed states whole (a merge replaces a state by name; a removed one
 * is null). Contents of another kind are written over that kind's defaults, with their type.
 */
export function diffConfig(base: OrbConfig, next: OrbConfig): Partial<OrbConfig> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (key === "states" || key === "state" || key === "contents") continue;
    const change = diffValue((base as unknown as Record<string, unknown>)[key], value);
    if (change !== undefined) out[key] = change;
  }
  const { type } = next.contents;
  if (type !== base.contents.type) {
    out.contents = { type, ...(diffValue(CONTENTS[type].defaults(), next.contents) as object) };
  } else {
    const change = diffValue(base.contents, next.contents);
    if (change !== undefined) out.contents = change;
  }
  const states: Record<string, unknown> = {};
  for (const name of new Set([...stateNames(base), ...stateNames(next)])) {
    const now = next.states[name];
    if (!now) states[name] = null;
    else if (!same(base.states[name], now)) states[name] = now;
  }
  if (Object.keys(states).length > 0) out.states = states;
  if (next.state !== base.state) out.state = next.state;
  return out as Partial<OrbConfig>;
}

/** The preset a config is closest to: the one it was loaded from, if that still exists. */
function presetBase(preset: string): OrbConfig {
  return isPresetName(preset) ? PRESETS[preset]() : PRESETS.clear();
}

function indent(text: string, by: number): string {
  return text.replace(/\n/g, "\n" + " ".repeat(by));
}

/**
 * The config compiled for Swift and Kotlin, which run a program rather than the config model:
 * the shader's uniform array with the structure written in, and each state's dials. Their
 * libraries carry the shader for every built-in kind of contents; a shader of your own travels
 * in the program, written out for Metal and for Android.
 */
export function exportProgram(config: OrbConfig): string {
  const own = config.contents.type === "shader";
  return JSON.stringify(compileOrb(config, own ? { shaders: ["msl", "glsl"] } : {}));
}

/** A picture or clip from this browser only (a file picked in the studio) cannot ship as is. */
function localMedia(config: OrbConfig): boolean {
  const { contents } = config;
  return (
    (contents.type === "image" || contents.type === "video") && /^(?:data|blob):/.test(contents.src)
  );
}

/** The config to export: a local file's source swapped for a placeholder to replace. */
function shippable(config: OrbConfig): OrbConfig {
  if (!localMedia(config)) return config;
  const ext = config.contents.type === "video" ? "mp4" : "jpg";
  return {
    ...config,
    contents: {
      ...config.contents,
      src: `/your-${config.contents.type}.${ext}`,
    } as OrbConfig["contents"],
  };
}

export function exportCode(framework: Framework, config: OrbConfig, preset: string): string {
  const code = frameworkCode(framework, shippable(config), preset);
  if (!localMedia(config)) return code;
  const note =
    framework === "element" || framework === "cdn"
      ? `<!-- The ${config.contents.type} came from a file on this computer: host it and put its URL in src. -->\n`
      : `// The ${config.contents.type} came from a file on this computer: host it and put its URL in src.\n`;
  return note + code;
}

function frameworkCode(framework: Framework, config: OrbConfig, preset: string): string {
  const name = isPresetName(preset) ? preset : "clear";
  const diff = diffConfig(presetBase(name), config);
  const hasDiff = Object.keys(diff).length > 0;
  const json = literal(diff, 2);
  const opening = literal(config.state);
  switch (framework) {
    case "react":
      return `// pnpm add @orb3d/react
import { Orb3D } from "@orb3d/react";

export function Orb({ state = ${opening} }: { state?: string }) {
  return (
    <Orb3D
      preset="${name}"
      state={state}${hasDiff ? `\n      config={${indent(json, 6)}}` : ""}
      poster="/orb.png"
      style={{ width: 96, height: 96 }}
    />
  );
}
`;
    case "element":
      return `<!-- pnpm add @orb3d/element -->
<orb-3d
  id="orb"
  preset="${name}"
  state="${attribute(config.state)}"
  poster="/orb.png"
  style="width: 96px; height: 96px"
></orb-3d>
<script type="module">
  import "@orb3d/element";${hasDiff ? `\n  document.getElementById("orb").config = ${indent(json, 2)};` : ""}
</script>
<!-- Later: orb.setAttribute("state", "thinking"), orb.setLevel(0.6) -->
`;
    case "vanilla":
      return `// pnpm add @orb3d/core
import { createOrb, mergeOrbConfig } from "@orb3d/core";
import { PRESETS } from "@orb3d/core/presets";

const orb = createOrb(
  document.getElementById("orb"),
  mergeOrbConfig(PRESETS.${name}(), ${indent(json, 2)}),
  { poster: "/orb.png" },
);

orb.setState("thinking"); // springs there
orb.setLevel(0.6); // 0 to 1: drives the state's react amounts
`;
    case "react-native":
      return `// pnpm add @orb3d/react-native react-native-skia@3.0.4 react-native-reanimated react-native-worklets
// (In Expo Go, which ships React Native Skia 2, it uses @shopify/react-native-skia instead.)
import { Orb3D } from "@orb3d/react-native";

export function Orb({ state = ${opening} }: { state?: string }) {
  return (
    <Orb3D
      preset="${name}"
      state={state}${hasDiff ? `\n      config={${indent(json, 6)}}` : ""}
      style={{ width: 96, height: 96 }}
    />
  );
}
`;
    case "swiftui": {
      const install = `// Package.swift: .package(url: "https://github.com/Amir-Abushanab/orb3d", from: "0.1.0")
import Orb3D
import SwiftUI
`;
      if (!hasDiff) {
        return `${install}
struct Orb: View {
    var state = ${nativeString(config.state, "swift")}

    var body: some View {
        OrbView(preset: .${name}, state: state)
            .frame(width: 96, height: 96)
    }
}
`;
      }
      return `${install}
// Your design, compiled: add orb.program.json (Export, program.json) to the app target.
private let program = try! OrbProgram(
    json: Data(contentsOf: Bundle.main.url(forResource: "orb.program", withExtension: "json")!)
)

struct Orb: View {
    var state = ${nativeString(config.state, "swift")}

    var body: some View {
        OrbView(program: program, state: state)
            .frame(width: 96, height: 96)
    }
}
`;
    }
    case "android": {
      const program = hasDiff
        ? `OrbProgram.fromJson(context.assets.open("orb.program.json").bufferedReader().readText())`
        : `OrbPreset.${name.toUpperCase()}.program`;
      return `// Android preview: build orb3d-release.aar from native/android in the Orb3D repository.
// Copy it to app/libs, then: implementation(files("libs/orb3d-release.aar"))${
        hasDiff
          ? `\n// Your design, compiled: add orb.program.json (Export, program.json) to src/main/assets.`
          : ""
      }
${hasDiff ? "import io.github.amirabushanab.orb3d.OrbProgram" : "import io.github.amirabushanab.orb3d.OrbPreset"}
import io.github.amirabushanab.orb3d.OrbView

// A View:
val orb = OrbView(context).apply {
    program = ${program}
    state = ${nativeString(config.state, "kotlin")}
}
orb.state = "thinking" // springs there
orb.level = 0.6f // 0 to 1

// In Compose:
@Composable
fun Orb(state: String, modifier: Modifier = Modifier.size(96.dp)) {
    AndroidView(
        factory = { context -> OrbView(context).apply { program = ${program} } },
        update = { it.state = state },
        modifier = modifier,
    )
}
`;
    }
    case "cdn":
      return `<div id="orb" style="width: 96px; height: 96px"></div>
<script type="module">
  import { mountOrb, mergeOrbConfig, PRESETS } from "https://esm.sh/@orb3d/core/standalone";

  const orb = mountOrb(
    document.getElementById("orb"),
    mergeOrbConfig(PRESETS.${name}(), ${indent(json, 4)}),
  );
</script>
`;
  }
}

/** Escape HTML parser tokens as well as quotes inside an inline script. */
function literal(value: unknown, space?: number): string {
  return JSON.stringify(value, null, space).replace(/</g, "\\u003c");
}

function attribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function nativeString(value: string, language: "swift" | "kotlin"): string {
  const text = JSON.stringify(value).replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) =>
    language === "swift" ? `\\u{${hex}}` : `\\u${hex}`,
  );
  return language === "kotlin" ? text.replace(/\$/g, "\\$") : text;
}

/** Freeze media into the downloaded page, including samples and temporary file URLs. */
async function inlineMedia(config: OrbConfig): Promise<OrbConfig> {
  const { contents } = config;
  if (contents.type !== "image" && contents.type !== "video") return config;
  if (contents.src.startsWith("data:")) return config;
  try {
    if (!contents.src) throw new Error("missing source");
    const response = await fetch(contents.src);
    if (!response.ok) throw new Error(`media: ${response.status}`);
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    // Bounded spreads work for large clips too, without overflowing the argument stack.
    for (let i = 0; i < bytes.length; i += 32768) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    }
    const mime = blob.type || (contents.type === "video" ? "video/mp4" : "image/jpeg");
    return {
      ...config,
      contents: { ...contents, src: `data:${mime};base64,${btoa(binary)}` },
    };
  } catch {
    throw new Error(
      `Could not include the ${contents.type} in the HTML. Choose the file again or use a URL that allows downloads.`,
    );
  }
}

/** A page with the runtime and media inlined: open it anywhere, nothing else to ship. */
export async function exportEmbed(config: OrbConfig, background: string): Promise<string> {
  const [runtime, portable] = await Promise.all([
    fetch("/orb3d.standalone.js")
      .then((r) => {
        if (!r.ok) throw new Error(`runtime: ${r.status}`);
        return r.text();
      })
      .catch(() => {
        throw new Error("Could not load the HTML export. Reload Studio and try again.");
      }),
    inlineMedia(config),
  ]);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Orb</title>
    <style>
      html, body { height: 100%; margin: 0; }
      body { display: grid; place-items: center; background: ${background}; }
      #orb { width: min(70vmin, 480px); aspect-ratio: 1; }
      nav { position: fixed; bottom: 16px; display: flex; gap: 6px; font: 13px system-ui; }
      button { border: 1px solid #8884; border-radius: 99px; background: #fff8; padding: 6px 12px; }
    </style>
  </head>
  <body>
    <div id="orb"></div>
    <nav></nav>
    <script type="module">
      const runtime = URL.createObjectURL(new Blob([${literal(runtime)}], { type: "text/javascript" }));
      const { mountOrb } = await import(runtime);
      URL.revokeObjectURL(runtime);
      const config = ${literal(portable)};
      const orb = mountOrb(document.getElementById("orb"), config, { lazy: false });
      const nav = document.querySelector("nav");
      for (const name of Object.keys(config.states)) {
        const button = document.createElement("button");
        button.textContent = name;
        button.onclick = () => orb.setState(name);
        nav.append(button);
      }
    </script>
  </body>
</html>
`;
}

export function download(name: string, data: Blob | string, type = "text/plain"): void {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
