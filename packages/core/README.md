# @orb3d/core

The engine behind Orb Studio: a WebGL2 glass orb with states, the presets, the config model and
the poster-first shell. Framework-agnostic; [`@orb3d/react`](../react) and
[`@orb3d/element`](../element) wrap it.

```sh
pnpm add @orb3d/core
```

## The shell

```ts
import { createOrb } from "@orb3d/core";
import { PRESETS } from "@orb3d/core/presets";

const orb = createOrb(document.getElementById("orb")!, PRESETS.aura(), {
  poster: "/orb.png",
});

orb.setState("thinking"); // springs there; staged if the engine is not live yet
orb.setLevel(0.6); // 0 to 1, smoothed, drives the `react` amounts
orb.set({ glass: { frost: 0.4 } }); // merged block by block, applied at once
orb.set({ contents: { type: "image", src: "/photo.jpg" } }); // other contents replace the old
await orb.snapshot({ time: 0 }); // a PNG of the opening frame
orb.destroy();
```

`createOrb` shows the poster at once, waits until the box nears the viewport, probes for a WebGL2
context on a real GPU, then fetches the engine through a dynamic import and crossfades in. Options:
`poster`, `posterFit`, `fadeMs`, `lazy`, `rootMargin`, `webgl` (`auto` | `force` | `off`),
`respectReducedMotion`, `reducedMotionBehavior` (`static` | `poster`), `respectSaveData`,
`minSizeForWebGL`, `paused`, `onReady`, `onFallback`, `onPhaseChange`. The handle's `phase` is
where the shell is (`poster`, `loading`, `running`, `fallback`); its `state` is what the orb shows.

For a large interactive orb, pass `adaptiveQuality: true` to the shell or renderer. It targets
60 fps by lowering live resolution after sustained slow frames, then recovering gradually.
It respects the authored `quality` / `dprMax` ceiling, never goes below half scale or a
192-pixel shorter side, and leaves small avatars sharp. It is off by default; Studio enables it
for its live preview. Captures and explicit output sizes always use the authored resolution.
`renderer.resolutionScale` reports the current live multiplier.

## The engine

```ts
import { OrbRenderer } from "@orb3d/core/renderer";

const renderer = new OrbRenderer(container, config, { respectReducedMotion: true });
renderer.start();
renderer.setState("speaking", { immediate: false });
```

`setState`, `setLevel`, `setWeather`, `setConfig`, `setPaused`, `seek(time)`, `renderOnce()`,
`captureImage(type, quality, time)`, `setOutputSize({ width, height })`, `resize()`, `dispose()`;
`isContextLost` remains true until a lost context has successfully rebuilt its resources;
`mediaLoading` while a picture or clip is on its way, and `shaderError` (with the
`onShaderError` option) when a shader of your own does not compile. It keeps the last working
shader, or shows clear glass if there is none. It pauses offscreen and in hidden tabs (a clip with it), clamps DPR (`dprMax`, `quality`),
restores a lost context and, under `prefers-reduced-motion`, holds a still frame and cuts between
states.

## The config

`OrbConfig` is plain JSON: `contents` (what is in the glass, by `type`: `none`, `gradient`,
`image`, `video`, `shader`, `sunset`, `landscape` or `celestial`), the glass round it (`glass`, `light`,
`environment`, `weather`, `halo`, `shadow`, `post`, `react`), `states` and a few settings.
`createDefaultConfig()` is clear glass; `createContentsConfig(type)` is the same glass holding
`type`'s defaults, with its state overrides. `ensureOrbConfig(partial)` fills and clamps a partial
config; `mergeOrbConfig(a, b)` merges block by block (arrays whole, contents of another type
replacing the old, states replaced by name, `null` removing a state); `mergeStates(states,
changes)` changes part of some states. `dialsFor(type)` lists every number and colour a state can
move in an orb holding `type`, with its range and group, and `writeStateDials(config, state)` packs
what a state resolves to. `CONTENTS` holds each kind's model: its label, dials, defaults and
states.

A state:

```ts
{
  duration: 0.9, // seconds to settle into it
  glass: { frost: 0.4, dispersion: 0.8 },
  environment: { spin: 70 }, // degrees a second the room turns
  contents: { flow: 1.4, spin: 40 }, // the contents' own dials, here a gradient's
  react: { exposure: 0.3 }, // how much the level adds
}
```

## Programs

`@orb3d/core/program` compiles a config to a program (`compileOrb`), the JSON other platforms run:
the uniform array's structure, each state's dials, and the clocks. `OrbRuntime` steps it, and
`orbShader(dialect, program)` writes its shader as GLSL, SkSL or MSL;
`compileOrb(config, { shaders: ["msl", "glsl"] })` carries it, which Swift and Android need for a
shader of your own.

## The CDN build

`@orb3d/core/standalone` is one file with the engine and the presets bundled, for a plain
`<script type="module">`; `mountOrb` there upgrades with no second request.

## Weather observations

`weatherConfig(observation)` creates a weather orb; `{ target: "hero" }` creates a full-canvas
sky and `{ target: "overlay" }` creates transparent airborne effects. The shell handle and
renderer expose `setWeather(observation)` to transition observations without resetting surface
water or ice. `normalizeWeather`, `weatherState`, `fromOpenMeteo`, `solarPosition` and `lunarPhase`
are exported from both the package entry and standalone bundle. See
[weather integration](../../docs/weather-integration.md) for units, controls and native export guidance.
