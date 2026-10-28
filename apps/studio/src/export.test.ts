import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTENTS,
  ensureOrbConfig,
  mergeOrbConfig,
  mergeStates,
  type SunsetContents,
} from "@orb3d/core";
import { PRESETS } from "@orb3d/core/presets";
import { transpileModule, JsxEmit } from "typescript";
import { diffConfig, exportCode, exportEmbed, exportProgram } from "./export";

afterEach(() => vi.unstubAllGlobals());

describe("diffConfig", () => {
  it("is empty for an untouched preset", () => {
    expect(diffConfig(PRESETS.dawn(), PRESETS.dawn())).toEqual({});
  });

  it("round-trips an edit through mergeOrbConfig", () => {
    const base = PRESETS.sunset();
    const contents = base.contents as SunsetContents;
    const edited = ensureOrbConfig({
      ...base,
      size: 0.8,
      contents: { ...contents, sun: { ...contents.sun, glow: 1.6 } },
      states: {
        ...mergeStates(base.states, { thinking: { rain: { run: 1 } } }),
        listening: { contents: { sun: { y: 0 } } }, // keys the preset's listening had are gone
        error: { post: { saturation: 0 } },
      },
    });
    delete edited.states.muted;
    const diff = diffConfig(base, edited);
    expect(diff.contents).toEqual({ sun: { glow: 1.6 } });
    expect(diff.states).toMatchObject({ muted: null, error: { post: { saturation: 0 } } });
    expect(ensureOrbConfig(mergeOrbConfig(base, diff))).toEqual(edited);
  });

  it("writes other contents over their own defaults", () => {
    const base = PRESETS.clear();
    const edited = ensureOrbConfig({
      ...base,
      contents: { type: "gradient", flow: 1 },
    });
    const diff = diffConfig(base, edited);
    expect(diff.contents).toEqual({ type: "gradient", flow: 1 });
    expect(ensureOrbConfig(mergeOrbConfig(base, diff))).toEqual(edited);
  });
});

describe("exportCode", () => {
  it("sets element config only after the component import has completed", () => {
    const config = ensureOrbConfig({ ...PRESETS.aura(), speed: 2 });
    const code = exportCode("element", config, "aura");
    expect(code.match(/<script/g)).toHaveLength(1);
    expect(code.indexOf('import "@orb3d/element"')).toBeLessThan(code.indexOf(".config ="));
  });

  it("escapes custom state names in React, HTML and native strings", () => {
    const name = 'busy"$name';
    const config = ensureOrbConfig({ state: name, states: { [name]: {} } });
    const react = exportCode("react", config, "clear");
    const result = transpileModule(react, {
      fileName: "orb.tsx",
      compilerOptions: { jsx: JsxEmit.ReactJSX },
      reportDiagnostics: true,
    });
    expect(result.diagnostics).toEqual([]);
    expect(exportCode("element", config, "clear")).toContain('state="busy&quot;$name"');
    expect(exportCode("android", config, "clear")).toContain('state = "busy\\"\\$name"');
    expect(exportCode("swiftui", config, "clear")).toContain('var state = "busy\\"$name"');
  });

  it("keeps shader text from closing an inline script", () => {
    const config = ensureOrbConfig({
      contents: { ...CONTENTS.shader.defaults(), code: "// </script><!--<script>" },
    });
    for (const framework of ["element", "cdn"] as const) {
      const code = exportCode(framework, config, "clear");
      expect(code.match(/<\/script>/g)).toHaveLength(1);
      expect(code).not.toContain("<!--<script>");
    }
  });

  it("names the preset and carries only the difference", () => {
    const config = ensureOrbConfig({ ...PRESETS.night(), speed: 2 });
    const code = exportCode("react", config, "night");
    expect(code).toContain('preset="night"');
    expect(code).toContain('"speed": 2');
    expect(code).not.toContain("clouds");
  });

  it("installs react-native-webgpu for React Native only when the contents are a clip", () => {
    const picture = exportCode("react-native", PRESETS.aura(), "aura");
    expect(picture).toMatch(/^\/\/ pnpm add @orb3d\/react-native react-native-skia react-native-/);
    expect(picture).not.toContain("webgpu");
    const clip = ensureOrbConfig({ contents: { type: "video", src: "https://example.com/a.mp4" } });
    expect(exportCode("react-native", clip, "custom")).toContain("// pnpm add react-native-webgpu");
  });

  it("swaps a file from this computer for a placeholder, and says so", () => {
    const config = ensureOrbConfig({
      contents: { type: "image", src: "data:image/png;base64,AAAA" },
    });
    const code = exportCode("react", config, "custom");
    expect(code).toContain("/your-image.jpg");
    expect(code).not.toContain("data:image");
    expect(code).toMatch(/^\/\/ The image came from a file/);
  });
});

describe("exportProgram", () => {
  it("carries a shader of your own for Metal and Android, and no other", () => {
    const own = JSON.parse(exportProgram(ensureOrbConfig({ contents: { type: "shader" } })));
    expect(Object.keys(own.shaders)).toEqual(["msl", "glsl"]);
    expect(JSON.parse(exportProgram(PRESETS.aura())).shaders).toBeUndefined();
  });
});

describe("exportEmbed", () => {
  it.each([
    ["image", "/samples/lake.jpg", "image/jpeg"],
    ["video", "blob:https://studio.example/local-clip", "video/mp4"],
  ] as const)("inlines %s media instead of retaining %s", async (type, src, mime) => {
    const bytes = new Uint8Array([0, 128, 255]);
    const fetcher = vi.fn(async (url: string) =>
      url === "/orb3d.standalone.js"
        ? new Response("export function mountOrb() {}")
        : new Response(bytes, { headers: { "Content-Type": mime } }),
    );
    vi.stubGlobal("fetch", fetcher);
    const config = ensureOrbConfig({ contents: { ...CONTENTS[type].defaults(), src } });
    const html = await exportEmbed(config, "#fff");
    const portable = JSON.parse(/const config = (.*);/.exec(html)![1]!);
    expect(portable.contents.src).toBe(`data:${mime};base64,AID/`);
    expect(config.contents).toMatchObject({ src });
    expect(fetcher).toHaveBeenCalledWith(src);
  });

  it("keeps an existing data URL without fetching it", async () => {
    const fetcher = vi.fn(async () => new Response("export function mountOrb() {}"));
    vi.stubGlobal("fetch", fetcher);
    const src = "data:image/png;base64,AID/";
    const html = await exportEmbed(
      ensureOrbConfig({ contents: { ...CONTENTS.image.defaults(), src } }),
      "#fff",
    );
    expect(html).toContain(src);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable media instead of downloading a broken embed", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url === "/orb3d.standalone.js"
        ? new Response("export function mountOrb() {}")
        : new Response(null, { status: 404 }),
    );
    await expect(
      exportEmbed(
        ensureOrbConfig({ contents: { ...CONTENTS.image.defaults(), src: "blob:expired" } }),
        "#fff",
      ),
    ).rejects.toThrow("Choose the file again or use a URL that allows downloads");
  });
});
