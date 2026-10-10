# Contributing

## Prerequisites

Node 20.19+ and pnpm (the version is pinned in `package.json`'s `packageManager`). `pnpm install`
also points git at `.githooks`, whose pre-commit formats and lints the staged files.

## Layout

```
packages/core      the engine, presets, config model and the poster-first shell
packages/react         <Orb3D>
packages/element       <orb-3d>
packages/react-native  <Orb3D> for React Native, on Skia
native/apple           the Swift package's sources (Package.swift is at the root)
native/android         the Android library and a sample app
apps/studio            Orb Studio, the design tool
scripts                build helpers, renderers, parity checks and the release script
```

Inside the core, `config/` is engine-free and safe to import anywhere; `program/` compiles a config
to a program, runs the springs and clocks, and writes the shader in each dialect; `renderer/` is the
WebGL2 engine; `shell/` is the poster-first wrapper, which reaches the engine only through the dynamic
import in `core-loader.ts`, so a consumer's first load carries no engine. `pnpm depcruise` enforces
that layering.

## The check gate

`pnpm check` is what CI runs: oxfmt, oxlint, TypeScript in every package, vitest, dependency-cruiser,
knip and the agent skill's validation. Run it before a pull request.

`pnpm benchmark` measures built-runtime CPU simulation/packing. Pass `--baseline` a saved
core `dist` directory for exact physics comparison and before/after timings; see
[performance](docs/performance.md). GPU and physical-phone performance need device traces.

## Dev loop

`pnpm dev` runs the studio, which imports the packages from source, so an edit to the engine shows
on save. The studio's embed export needs the standalone bundle, which its `predev` builds when the
core has changed since (`scripts/ensure-standalone.mjs`).

## Adding a dial

A dial of the glass goes in `GLASS_DIALS` in `packages/core/src/config/model.ts`, with its range and
group and a default in `clearGlass`; a dial of some contents goes in that kind's `dials` in
`config/contents.ts`, with a default in its `defaults`. Read it in the shader as `$D(key)` or
`$C(key)`. The studio's panel, state overrides, the springs, validation and every platform's
runtime come from those lists; none of the native code names a dial.

## Adding a kind of contents

1. A model in `config/contents.ts`: its `type`, the `shader` that draws it, its `dials`, up to four
   `clocks` (dials integrated as rates), `defaults`, its overrides for the five standard `states`,
   and `structure` (checking what is not a dial). Add it to `CONTENTS`.
2. Its shader in `program/shaders/`: GLSL defining
   `vec4 orbContents($U vec2 s, vec2 face, float w, float k, float blur, float level, vec4 clock, vec4 m)`,
   the premultiplied colour at `s` (see the comment at the top of `shaders/glass.ts`), and
   optionally `dropLook`/`dropView` for what the rain shows. Hook it up in `contentsCode` in
   `program/shader.ts`, and give `CONTENTS_BLOCKS` in `program/layout.ts` any structure it writes
   (and `compile.ts` the code that writes it).
3. `pnpm native:generate`, then `pnpm parity` with a case for it.

## The shader and the native code

`program/shaders/` is the one shader, the glass (`glass.ts`) round one file per kind of contents,
written in the subset GLSL ES 3.00, SkSL and MSL share: loops with constant bounds that exit with
`break`, array indices built from constants and loop indices, no names GLSL reserves or builds in
(Android's compiler still knows `noise2`), and `$U`/`$u` where Metal needs the uniform array (and a
picture) passed in. The contents are sampled from one call site in `orb()`, a loop over the colour
channels and the drop's lens: Metal inlines everything, and a second call site doubles what it has
to compile. After changing a shader, or a preset, run:

```sh
pnpm native:generate   # rewrite native/apple/.../Generated.swift and native/android/.../Generated.kt
pnpm parity            # every preset in every state, a picture and a shader: SkSL against WebGL
pnpm parity --metal    # and Metal, through `swift run orb3d-render` (macOS)
pnpm parity --hardware # use the browser's GPU for larger local runs (Metal on macOS)
```

`pnpm test:packages` builds and packs every published package, then tests its exports, SSR imports
and strict consumer types outside the workspace, with Skia 2 and Skia 3 installed separately.
CI and the local release command run this gate before publishing. CI and the release workflow
also share `.github/workflows/native.yml`, so publishing waits for Swift and Android builds.

`pnpm test:browser` checks the built React and custom-element wrappers in Chromium, including
StrictMode, asynchronous presets, config fetches and custom-element upgrades. Install the browser
once with `pnpm exec playwright install chromium`; CI runs these checks too.

`pnpm readme:hero` records Studio at 1280×720 and writes the animated `assets/hero.webp` used in
the README. It needs Chromium and `img2webp` from libwebp (`brew install webp` on macOS).

`pnpm check` fails when the generated files are stale. `swift build` builds the Swift package; in
`native/android`, `./gradlew :orb3d:assembleRelease :sample:assembleDebug` builds the library and
the sample (JDK 17+, the Android SDK).

The rain running down the glass is a simulation, `program/rain.ts`, ported line for line to
`OrbRain.swift` and `OrbRain.kt`. It has to step to the same rain everywhere, so it works in
doubles with `+`, `-`, `*`, `/`, square roots and a fixed Newton iteration for cube roots, and
uses one seeded 32-bit generator. Config and dial inputs are rounded to single precision before
physics, matching the native programs. Its 384-drop pool, snow particles and timestamped trails
share a portable uniform layout. WebGL and Android split the data into std140 blocks, each
within the guaranteed 16 KiB block budget; Metal binds large arrays through buffers. A
change to `rain.ts` goes into both ports in the same order of operations; parity shows a port
that has drifted as a drop out of place.

To compare Android on a device or emulator with WebGL:

```sh
node scripts/parity.mjs --programs renders/programs   # the picture and shader cases, as programs
cd native/android && ./gradlew :sample:installDebug
app=io.github.amirabushanab.orb3d.sample
adb shell run-as $app mkdir -p files/programs
for f in ../../renders/programs/*; do
  adb push "$f" /data/local/tmp/ && adb shell run-as $app cp "/data/local/tmp/$(basename "$f")" files/programs/
done
adb shell am start -n $app/.MainActivity --es render all --ef time 3 --ei size 256
mkdir -p ../../renders/android
for f in $(adb shell run-as $app ls files/parity | tr -d '\r' | grep png); do
  adb exec-out run-as $app cat files/parity/$f > ../../renders/android/$f
done
cd ../.. && pnpm parity --images renders/android
```

## Rendering without a browser window

```sh
pnpm exec playwright install chromium   # once
pnpm render --preset aura --time 4      # every state, 4 seconds in, into renders/
pnpm render --states speaking --level 0.8
```

It draws through the engine directly (the shell refuses the software rasterizer headless Chromium
has) and writes `renders/<preset>-<state>-t<time>.png`.

## The agent skill

`packages/core/skills/orb3d/SKILL.md` ships in the core package for coding agents. Keep it true when
the public surface changes; `pnpm skill:validate` checks its shape, and `pnpm run version` keeps its
`library_version` in step with the package.

## Changesets

Describe a change to a published package with `pnpm changeset`. The npm packages version together,
and the Swift package and the Android library take the core's version. See [DEPLOY.md](DEPLOY.md) for how a release goes out.
