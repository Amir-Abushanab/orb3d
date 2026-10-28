---
name: orb3d
description: >
  Add a glass orb with states to an app or website: a tunable ball of glass (refraction, colour
  fringing, frost, tint, reflections, highlight, rain) holding anything (nothing, an animated
  gradient, a picture, a video, a custom GLSL shader, or a scene such as a sunset or a 3D
  landscape), that springs between named states such as idle, listening, thinking, speaking and
  muted, and reacts to an input level such as a voice's loudness. Load this when a user wants a
  @orb3d package: @orb3d/react (<Orb3D>), @orb3d/element (<orb-3d>), @orb3d/core (createOrb /
  mountOrb) or @orb3d/react-native; the Orb3D Swift package (OrbView, Metal) or the Android
  library (io.github.amirabushanab:orb3d, OrbView); or asks for an animated status orb, an AI or
  voice-agent orb, a glass marble or crystal ball with an image or video inside, a poster-first
  lazy WebGL2 orb, a CDN <script> orb, or how to reproduce an orb exported from Orb Studio.
metadata:
  type: core
  library: "@orb3d/core"
  library_version: "0.4.0"
sources:
  - "Amir-Abushanab/orb3d:README.md"
  - "Amir-Abushanab/orb3d:packages/core/README.md"
  - "Amir-Abushanab/orb3d:packages/react/README.md"
  - "Amir-Abushanab/orb3d:packages/element/README.md"
  - "Amir-Abushanab/orb3d:packages/react-native/README.md"
  - "Amir-Abushanab/orb3d:native/apple/README.md"
  - "Amir-Abushanab/orb3d:native/android/README.md"
  - "Amir-Abushanab/orb3d:packages/core/src/config/model.ts"
  - "Amir-Abushanab/orb3d:packages/core/src/config/contents.ts"
  - "Amir-Abushanab/orb3d:packages/core/src/shell/createOrb.ts"
  - "Amir-Abushanab/orb3d:packages/core/src/presets.ts"
---

# @orb3d: glass orbs with states

One fragment shader draws the orb: the contents seen through a ball of glass (or, with nothing
inside, the room behind it upside down), rain on the glass, reflections and highlights on top. A
state machine on the CPU springs every dial (how frosted the glass is, how fast a gradient flows,
how fast the rain runs) toward the current state. Every web entry shows a poster first and
upgrades only when the container nears the viewport and the browser has a GPU; the engine is
code-split out of the initial load. No three.js.

## When to use

- A status indicator that has to say "idle", "listening", "thinking", "speaking" or "off" at a
  glance: voice agents, assistants, long-running jobs.
- An animated logo or avatar that reacts to audio or progress through `setLevel`.
- A picture or clip in a glass marble (an avatar, a product), or a custom shader in a crystal ball.
- Reproducing an orb designed in Orb Studio (paste its exported code or config JSON).

## Install

```sh
pnpm add @orb3d/react     # React
pnpm add @orb3d/element   # <orb-3d> for Vue, Svelte, plain HTML
pnpm add @orb3d/core      # framework-agnostic createOrb
```

No peer dependencies beyond React for `@orb3d/react`. Everything is ESM-only.

## Choosing an entry

| Need                              | Use                                                                  |
| --------------------------------- | -------------------------------------------------------------------- |
| React                             | `import { Orb3D } from "@orb3d/react"`                               |
| Vue, Svelte, plain HTML           | `import "@orb3d/element"` then `<orb-3d>`                            |
| Framework-agnostic, own DOM       | `import { createOrb } from "@orb3d/core"` (the poster shell)         |
| The engine, no shell or poster    | `import { OrbRenderer } from "@orb3d/core/renderer"`                 |
| One `<script>` from a CDN         | `import { mountOrb } from ".../@orb3d/core/standalone"`              |
| Built-in presets                  | `import { PRESETS } from "@orb3d/core/presets"`                      |
| React Native, Expo                | `import { Orb3D } from "@orb3d/react-native"` (Skia)                 |
| SwiftUI, UIKit, AppKit            | Swift package `Orb3D`: `OrbView(preset: .aura, state:)`              |
| Android views, Compose            | Source preview / local AAR: `OrbView(context)`                       |
| Another platform, your own GPU    | `compileOrb`, `OrbRuntime`, `orbShader` from `@orb3d/core/program`   |
| Your own WebGL2 context, a worker | `import { OrbGL } from "@orb3d/core/renderer"`                       |
| A poster file, in a build         | `orb3d poster --preset sunset --size 96 --out mark.png` (Playwright) |

`OrbGL` draws a compiled program on a WebGL2 context you own, with no DOM, such as an
`OffscreenCanvas` in a worker: `use(program)` links its shader once per kind of contents, then
`draw(runtime, width, height)` each frame after `runtime.advance(dt)`. Pictures and clips need
`OrbRenderer`. Don't copy the uniform layout into a renderer of your own: it changes with the
program format.

## Quick starts

React:

```tsx
import { Orb3D } from "@orb3d/react";

<Orb3D preset="aura" state={status} poster="/orb.png" style={{ width: 96, height: 96 }} />;
<Orb3D config={{ contents: { type: "image", src: "/avatar.jpg" } }} state={status} />;
```

Custom element:

```html
<script type="module">
  import "@orb3d/element";
</script>
<orb-3d preset="aura" state="idle" poster="/orb.png" style="width:96px;height:96px"></orb-3d>
```

Core:

```ts
import { createOrb } from "@orb3d/core";
import { PRESETS } from "@orb3d/core/presets";

const orb = createOrb(document.getElementById("orb")!, PRESETS.aura(), { poster: "/orb.png" });
orb.setState("thinking"); // springs there
orb.setLevel(0.6); // 0 to 1
// orb: { phase, state, renderer, setState, setLevel, set(partial), snapshot({ time }), play, pause, destroy }
```

Presets: `clear` (the default: an empty glass ball, the room mirrored at its rim and seen upside
down through it), `aura` (a swirling gradient, the voice-agent look), `landscape` (hills round a
lake in 3D), `sunset` (the Plovent mark), `dawn`, `storm`, `night`. Each has the states `idle`,
`listening`, `thinking`, `speaking` and `muted`. In React a string preset lazy-loads the presets
chunk; a function (`preset={PRESETS.night}`) is tree-shakeable.

## What goes in the glass

All color dials accept a hex string or `GradientColor` from `gradientColor("linear" | "radial" | "conic" | "mesh")`. Fields hold at most eight stops/points, with normalized y-up coordinates. States replace and crossfade whole fields. Studio provides one Sunset Sky color editor; old `sky.stops` inputs still migrate. Large halos/shadows automatically reduce the sphere frame inside the supplied canvas so their tails fit.

`contents: { type, ...its dials }`, one of:

- `none`: clear glass. The room (`environment`) shows through it upside down.
- `gradient`: `colors` (four), `base`, `flow`, `spin` (degrees a second), `scale`, `warp`, `core`,
  `pulse` (how much the level swells and stirs it).
- `image` / `video`: `src` (a URL; on Swift and Android also an app asset), `fit` (`cover` or
  `contain`), `zoom`, `x`, `y`, `angle`, `spin`, `pulse`. Cross-origin pictures need CORS on the
  web. Clips play muted and looping.
- `shader`: `code` defining `vec4 contents(vec2 p, float time, float level, vec4 knobs, vec3
  color1, vec3 color2)` (straight alpha; `p` from -1 to 1, y up), plus `knobs` (four, 0 to 1),
  `color1`, `color2`, all dials. Keep to what GLSL ES 1.0, SkSL and Metal share: constant loop
  bounds, no textures or derivatives, no names GLSL builds in. A shader that does not compile
  leaves clear glass (`renderer.shaderError`, the `onShaderError` option).
- `sunset`: `sky` (`color`, `horizon`, `height`; legacy six `stops` migrate to a linear fill), `sun`, `wisps`, `clouds`, `sea` (layouts of
  puffs), `react` (`glow`, `billow`). The Plovent mark at rest.
- `landscape`: `sky` (`zenith`, `horizon`, `clouds`, `cloudColor`), `sun` (`azimuth`, `elevation`
  in degrees, `color`, `glow`), `land` (`height`, `grass`, `rock`, `snow`, `snowline`), `water`
  (`color`, `waves`), `haze`, `speed` (glide), `wind`, `altitude`, `react` (`waves`, `sun`).
  Raymarched: keep it small on low-end phones.

`createContentsConfig(type)` is the default glass holding `type`'s defaults and state overrides;
`CONTENTS[type]` is its model (label, dials, defaults, states).

## React Native, Swift and Android

The same orb on every platform: one shader in three dialects (GLSL for WebGL2 and Android, SkSL
for React Native Skia, MSL for Metal) and one small runtime (springs, level, clocks, and the
running rain's simulation).

- React Native: `pnpm add @orb3d/react-native react-native-skia react-native-reanimated react-native-worklets`,
  then `<Orb3D preset="aura" state={state} style={{ width: 96, height: 96 }} />`. Props:
  `preset`, `config`, `program`, `source` (a picture as `useImage` takes it, a `require` included,
  or a clip's URI, instead of the contents' `src`), `state`, `level`, `paused`, `style`; a ref has
  `setLevel` and `setState`. The frame loop runs on the UI thread (Reanimated). It uses whichever React Native
  Skia is installed: `react-native-skia` 3.x (Graphite: Vulkan on Android API 26+, needs a
  development build) or `@shopify/react-native-skia` 2.x (what Expo Go ships). Video contents on
  `react-native-skia` 3.0.5 and later also need `react-native-webgpu` (0.11.1+, the version paired
  with that Skia), an optional peer; without it they throw an error naming it.
- Swift: `.package(url: "https://github.com/Amir-Abushanab/orb3d", from: "0.1.0")`, then
  `OrbView(preset: .aura, state: state, level: level)`; `media: .image(cgImage)` or `.url(url)`
  puts a picture or clip in it. `OrbMetalRenderer` drives an `MTKView`;
  `OrbSnapshot.image(program:state:time:level:size:image:)` draws a still.
- Android is a source preview until remote publishing is configured. Build
  `native/android` with `./gradlew :orb3d:assembleRelease`, copy `orb3d-release.aar` from
  `orb3d/build/outputs/aar` into the app's `libs`, then
  `implementation(files("libs/orb3d-release.aar"))` and
  `OrbView(context).apply { program = OrbPreset.AURA.program }` and set `state` and `level`
  (`image = bitmap` or `video = uri` for a picture or clip). In Compose, wrap it in `AndroidView`.
  `OrbSnapshot.bitmap(...)` draws a still off the main thread.
- Swift and Android run a compiled program, not a config: for a custom design, export
  `orb.program.json` from Orb Studio (or `JSON.stringify(compileOrb(config))`; a shader of your own
  needs `compileOrb(config, { shaders: ["msl", "glsl"] })`) and load it with `OrbProgram(json:)` or
  `OrbProgram.fromJson(...)`. Built-in presets need no file.

## States

- `state` (React prop, element attribute, `setState(name)`) moves the orb to a state. It SPRINGS
  there: a critically damped spring per dial, settling in the state's `duration` (default
  `transition.duration`, 1.1 s), carrying any motion already under way, so switching states
  rapidly never jolts. Under reduced motion it cuts instead.
- A state is a set of dial overrides over the base config, e.g.
  `{ glass: { frost: 0.5 }, environment: { spin: 70 }, contents: { flow: 1.4 }, duration: 0.9 }`.
  States cannot change the layout (what is in the glass, which drops), only numbers and colours.
- An unknown state name falls back to the config's opening `state` (default `idle`).
- Custom states are just more keys: `states: { ...PRESETS.aura().states, error: { post: { saturation: 0.2 } } }`.

## The level

`setLevel(0..1)` feeds one input: a voice's loudness, a progress pulse. It is smoothed by
`level.attack` and `level.release` (seconds), then added to dials through `react` (`exposure`,
`halo`, `rain`, `fog`: breath on the glass, `sunny`, `wobble`) and the contents' own (`contents.pulse` for a gradient or picture,
`contents.react` for the scenes). The default `speaking` state reacts; `idle` does not.
For audio, call `setLevel` from your analyser loop through the ref or handle, not through React
state, so nothing re-renders per frame:

```tsx
const orb = useRef<OrbHandle>(null);
// in the audio loop: orb.current?.setLevel(rms * 6);
<Orb3D ref={orb} preset="aura" state="speaking" />;
```

## Weather API observations

Use `weatherConfig(snapshot, { target: "orb" | "hero" | "overlay" })` for a navbar orb, full-canvas
hero sky or transparent weather layer. `handle.setWeather(snapshot)` springs new observations into
the current state without resetting deposits. `legible: true` (in the same options) lifts light
rain, snow and hail so they read on a small orb or behind a page; the rates stay as observed.
`weatherState` produces a state override. Canonical
units: epoch milliseconds, Celsius, metres, m/s, wind **from** compass bearing, rain/snow/hail
mm/hour water equivalent, cloud cover 0–1. Probability does not create precipitation.
`fromOpenMeteo(row, { time, latitude, longitude, intervalSeconds })` converts explicit km/h/cm/mm
units, using a 3600-second hourly interval by default; pass the current response interval.
Shared windSpeed/gusts/turbulence affect arrivals independently of glass gravity. Weather includes
clouds, atmosphere, lightning, hail, persistent ice/rime and airborne
precipitation. Celestial day/night/moon/stars is `contents.type: "celestial"`; weather never replaces
an explicitly selected contents scene. Rain arrivals continue at runoff speed zero. Fog remains glass condensation. Provider fetch/caching stays in the host project.

## Config model

One JSON object, `OrbConfig`, drives the renderer, the studio and every export.
`ensureOrbConfig(partial)` fills and clamps one; `mergeOrbConfig(a, b)` merges block by block
(arrays whole, contents of another `type` replacing the old, states replaced by name, a state set
to `null` removed); `mergeStates(states, changes)` changes part of some states.

- `contents` (structure: its `type`, a picture's `src` and `fit`, a shader's `code`, the sunset's
  layouts; the rest are dials). See above.
- Weather is canonical under `weather`: shared `gravity` (formerly `rain.direction`), `wind`
  (adds to each incoming angle, without tilting gravity), and `water: { lens, shade }`.
  `weather.rain`, `.snow`, `.fog` and `.sunny` each have `enabled` (default true) and `react`
  (input response). False immediately skips simulation/rendering; rain/snow preserve and resume
  particles without catching up. Zero amount permits natural cleanup. Rain off keeps snow meltwater.
  Old root weather blocks, water optics and `react` weather fields are accepted as legacy inputs;
  export only canonical `weather` JSON. State overrides use the same nested structure.
- The glass's dials (what states move): `speed`, `wobble`; `glass` (`bend`, `ior`, `dispersion`,
  `frost`, `tint`, `opacity`, `reflection`, `highlight`, `glint`, `edge`, `edgeColor`, `rim`,
  `bounce`, `bounceColor`, `outline`, `outlineColor`); `light` (`x`, `y`: source position in
  orb-radius units, −3 to 3; `elevation`: incidence offset −90° to 90°, 0 follows position,
  positive turns toward the viewer, negative away; `color`, `size`). Glare follows the source,
  reflections and glass/water glints follow incidence. All are state dials. Studio's Move sun
  handle and Sunny Direction/Distance controls edit the same X/Y position;
  `environment` (`sky`, `horizon`, `ground`, `spin`: the room it mirrors);
  `weather.rain` (`amount`, `mist`, `density`: a simulated downpour on the sphere, `run`,
  `spawn`: 0 scattered arrivals, 1 incoming edge; `angle`: incoming rain, −80° to 80°, positive
  slants right, negative slants left; `direction`: glass gravity, 0° down, 90° right, −90° left,
  ±180° up; `lens`, `shade`); `weather.snow` (`amount`, `density`: new snowfall, `dispersion`: landing
  spread from incoming edge 0 to scattered 1, `angle`: incoming wind −80° to 80°, `fall`, `size`,
  `stick`: adhesion, `melt`: heat, zero keeps ice frozen, `color`). Seeded crystals settle on the
  curved glass and compact gradually at contact. Fine ice erodes before the core, and water
  pockets coalesce only when their liquid surfaces meet. Meltwater follows the glass's gravity;
  melting continues when fall speed is zero. Stop new arrivals with density zero. All are state
  dials; `weather.snow.react` adds the input level to snow amount. Program exports now use format 12;
  re-export older programs with matching native libraries. `weather.fog`
  (`amount`, `color`, `drift`: local condensation growth over fixed patches, diffusing all
  contents including custom shaders; running drops wipe it); `weather.sunny`
  (`amount`, `color`, `rays`, `sparkle`, `flare`: soft glare and aligned rays from the light,
  with glints following the glass and water normals); `halo` (`amount`,
  `color`, `radius`);
  `shadow` (`amount`, `color`, `caustic`); `post` (`saturation`, `exposure`); `react` (see above).
  `dialsFor(type)` lists them all, the contents' included, with ranges.
- Structure of the glass: `rain.drops` (`[x, y, size, runs]` on the orb's face; `runs: 1` drops
  start with a wet trail and beads; when `rain.run` > 0, all drops follow surface gravity,
  merge on contact, conserve water volume and leave curved trails) and `rain.beads`.
- Canvas: `size` (diameter as a share of the box; below 1 leaves room for a `halo` or `shadow`),
  `background` (`"transparent"` or a colour), `quality`, `dprMax`, `paused`.

## Shell behaviour

Poster first (adopts an SSR `<img data-orb3d-poster>`), lazy (IntersectionObserver, `rootMargin`
200px), WebGL2 probe that refuses software rasterizers (`webgl: "force"` overrides, `"off"` stays
a poster), falls back on Save-Data, `minSizeForWebGL`, repeated context loss and load errors. The
shell's lifecycle is the `phase` (`poster`, `loading`, `running`, `fallback`), not to be confused
with the orb's `state`. A `setState` before the upgrade is staged, so the orb opens in it.

For large interactive web orbs, opt into `adaptiveQuality: true` (React prop / shell or renderer
option), or the element's `adaptive-quality` attribute. It reduces live resolution during
sustained slow frames and recovers gradually; captures and explicit output sizes stay at the
authored resolution. Studio enables it for the preview. Embedded orbs default to fixed quality.

## Common mistakes

- Passing the state inside `config` to switch it: a config change CUTS the dials; use the `state`
  prop, attribute or `setState`, which springs.
- Driving `level` from React state at 60 fps: use the handle's `setLevel`.
- A `halo` or `shadow` with `size: 1`: there is no room outside the orb to draw it; use `size`
  around 0.8.
- Expecting clear glass to bend the page behind it: a canvas cannot read the page. It shows its
  own room; lower `glass.opacity` to let the page show through, unbent.
- A picture from another origin without CORS: WebGL cannot read it, and the glass stays clear.
- Changing `contents.type` in a state: states only move dials; set the contents in the config.
- Expecting the canvas to show in headless Chromium: the shell refuses software renderers by design.
  Use `webgl="force"` for tests, or the engine directly.
- Mounting the orb inside an SVG `<foreignObject>`, to make it a letter of a wordmark say: Safari
  paints no WebGL canvas there, so the orb is blank or drawn at the wrong place and scale.
  Position it over the SVG instead, sized from the SVG's geometry.
- Posters: capture with `snapshot({ time: 0 })`, Orb Studio's poster.png or `orb3d poster` in a
  build, in the opening state, so the poster and the first live frame match.
