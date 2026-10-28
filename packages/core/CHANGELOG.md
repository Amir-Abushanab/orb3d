# @orb3d/core

## 0.3.1

### Patch Changes

- [#13](https://github.com/Amir-Abushanab/orb3d/pull/13) [`d89a24a`](https://github.com/Amir-Abushanab/orb3d/commit/d89a24ae04edec0d6d9d752dd4cd3fbba1e25e48) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - `OrbConfigInput`, the type of every partial config (`ensureOrbConfig`, `compileOrb`, `createOrb`,
  `setConfig` and the components' `config`), now takes every block partially, all the way down, as
  the runtime already filled it out. The documented
  `config={{ contents: { type: "image", src: "/avatar.jpg" }, glass: { frost: 0.15 } }}` failed to
  type-check under strict TypeScript because `contents` and each block had to be complete. Arrays and
  colours are still taken whole, and a value of the wrong kind (`fit: "fill"`) is still an error. The
  new `OrbContentsInput` type names the contents part.

## 0.3.0

### Minor Changes

- [#9](https://github.com/Amir-Abushanab/orb3d/pull/9) [`29fade6`](https://github.com/Amir-Abushanab/orb3d/commit/29fade6a510f8970711ae5dd544cccf621e538cf) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add `legible` to the weather options of `weatherState`, `weatherConfig` and `setWeather`. It lifts
  light rain, snow and hail so they read on a small orb or behind a page, with bigger drops and
  flakes and the air carrying them, without changing the observation's rates.

- [#9](https://github.com/Amir-Abushanab/orb3d/pull/9) [`cfdd90e`](https://github.com/Amir-Abushanab/orb3d/commit/cfdd90e52b9221de537f8b843e04234e68cc39d2) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add `OrbGL` to `@orb3d/core/renderer`: a compiled orb's shader on a WebGL2 context you own, with
  no DOM, such as an `OffscreenCanvas` in a worker. `use(program)` links the shader its contents
  need and binds its uniform blocks; `draw(runtime, width, height)` uploads the runtime's frame and
  draws it. `OrbRenderer` now draws through it, so a renderer in a worker no longer copies the
  uniform layout, which changes with the program format.

- [#9](https://github.com/Amir-Abushanab/orb3d/pull/9) [`300cb3b`](https://github.com/Amir-Abushanab/orb3d/commit/300cb3b179db484ea3b9d56ef6e2bd2806a6e311) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add the `orb3d poster` command, which renders an orb's poster to a PNG, WebP or JPEG file from a
  preset or a config. It draws through the engine in headless Chromium on SwiftShader, so a config
  gives the same file on every machine; by default it draws at four times the size and scales down.
  It takes the state, time and level to draw, and reads pictures named by a relative path from the
  config's folder. Playwright is an optional peer dependency.

### Patch Changes

- [#9](https://github.com/Amir-Abushanab/orb3d/pull/9) [`15b6280`](https://github.com/Amir-Abushanab/orb3d/commit/15b6280fa69a3650fcdd1a4128ac4a0f9c7cf1bc) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Document that Safari paints no WebGL canvas inside an SVG `<foreignObject>`, so an orb mounted
  there stays blank, and that an orb meant as part of an SVG, such as the o of a wordmark, belongs
  over the SVG instead. The agent skill lists it among the common mistakes.

- [#9](https://github.com/Amir-Abushanab/orb3d/pull/9) [`54d0d91`](https://github.com/Amir-Abushanab/orb3d/commit/54d0d91862f28cfde7cfb336e9e5242469f8b20e) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Draw the trail and beads of drops authored with `runs: 1` again. The rain rewrite in 0.2.0 stopped
  drawing them, so the `sunset` preset lost the two run trails of the mark it reproduces. A drop that
  has run shows the clearer path it wiped above it and the beads it shed there while it rests where
  it was put; once the rain moves it, its simulated trail takes over. The shader change reaches
  React Native, Swift and Android with the regenerated native sources.

## 0.2.2

### Patch Changes

- [#5](https://github.com/Amir-Abushanab/orb3d/pull/5) [`2ffe72f`](https://github.com/Amir-Abushanab/orb3d/commit/2ffe72fac8cb526dbe3af3392aa0ff6f75b0c966) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Keep attached raindrops draining with gravity after wind impacts and contact merges. Release overloaded drops from the glass before dense rain can feed a single oversized collector. Apply the same simulation fix on the web, React Native, Swift and Android.

## 0.2.1

### Patch Changes

- [#3](https://github.com/Amir-Abushanab/orb3d/pull/3) [`1aad5d4`](https://github.com/Amir-Abushanab/orb3d/commit/1aad5d492a3837eac98811e584fbacca78584074) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Give cloudy and overcast weather layered drift, billowing contours and thickness-based lighting.
  API observations now drive cloud drift with crosswind while preserving cloud positions across
  weather refreshes. Calm skies retain gentle motion, and reduced motion freezes both cloud layers.

## 0.2.0

### Minor Changes

- [`081150b`](https://github.com/Amir-Abushanab/orb3d/commit/081150bf4c5a6ad6dc8b8ebe754a411467cbc409) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Add state-aware snow controls for snowfall, landing spread and angle, fall speed, size, adhesion
  and melting. Persistent seeded crystals tumble into the curved glass, settle, interlock and
  compact gradually. Fine branches erode before thicker ice while meltwater develops in branch
  hollows, coalesces on liquid contact and runs under surface gravity. Ice and water volumes are
  conserved through contact transfers. Shader geometry, surface normals and water optics are
  shared by all renderers; Swift and Kotlin carry matching fixed-step surface simulations.

  Program exports use format 8 for the snow dials and 64 packed surface-particle slots, within the
  guaranteed 1024-slot uniform budget. Re-export earlier program JSON with the matching libraries.
  Existing config links default to snow disabled.

- [`081150b`](https://github.com/Amir-Abushanab/orb3d/commit/081150bf4c5a6ad6dc8b8ebe754a411467cbc409) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Simulate rain on the spherical surface, with pinning, tangential gravity, volume-conserving
  contact absorption, brief settling pauses, curved trails, rim foreshortening and bottom runoff.
  Join contacting borders while the running head continues with brief drag and tangent deflection.
  Shade the shared meniscus and connection as pinned water integrates without centre attraction.
  Combine water heights and gradients across contact, and retire the connector as the running
  footprint covers the donor, so an obsolete lens endpoint cannot linger as a small bump.
  Add an immediate contact catch: the smaller footprint leans and stretches toward the meniscus
  with its far edge briefly pinned, while adhesion slows the running body before it releases.
  Deform moving footprints with a broad front and tapered tail; reduce volume unevenly into the
  wet film as well as whenever a residual bead is shed.
  Shade deposited water as a continuous shallow film with irregular width, without optical ribs
  at saved path anchors.
  Leave residual beads intermittently with varied sizes and positions, and vary replenished paths.
  Increase maximum rain density and preserve timestamped trail sections so fog returns gradually.
  WebGL and Android now upload the larger water layout through a std140 uniform buffer.

  Add Spawn distribution (scattered arrivals through to the incoming edge) and Flow direction
  (0° down, 90° right, −90° left, ±180° up), now labelled Glass tilt. Tangent gravity, resting
  contacts, bead shedding and runoff follow the glass tilt.
  Add independent Rain angle for wind-driven arrivals: steer the incoming edge and briefly carry
  impact momentum on the glass before friction and gravity take over. Existing attached water
  keeps following the glass gravity. All three controls support state overrides.

  Compiled programs now use format version 7. Re-export existing program JSON for the new rain
  layout and use matching Swift and Android implementations.

### Patch Changes

- [`081150b`](https://github.com/Amir-Abushanab/orb3d/commit/081150bf4c5a6ad6dc8b8ebe754a411467cbc409) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Keep the latest React and custom-element settings when asynchronous presets or configs finish
  loading. Preserve properties assigned before custom-element registration and support custom tags.
  Recover to the poster when a restored WebGL context cannot rebuild its resources. Respect paused
  programs and reduced motion in React Native, and clamp static input levels.

  Use Metal buffers for large uniform data, retain playback settings while media loads, and discard
  stale native media callbacks. Queue Android updates during render-thread startup and stop work
  after shutdown.

- [`081150b`](https://github.com/Amir-Abushanab/orb3d/commit/081150bf4c5a6ad6dc8b8ebe754a411467cbc409) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Retain the latest input level while the web renderer loads, so initial React levels survive
  lazy mounting. Keep React Native's public image-source types independent of optional Skia
  peers and prefer built declarations in TypeScript, allowing Skia 2 and Skia 3 consumers to
  typecheck with only their chosen version installed.

- [`081150b`](https://github.com/Amir-Abushanab/orb3d/commit/081150bf4c5a6ad6dc8b8ebe754a411467cbc409) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Upload video textures on decoded frames and reuse texture storage. Add opt-in adaptive live
  web resolution with full-resolution captures. Reduce rain collision comparisons through
  deterministic spatial buckets on TypeScript, Swift and Kotlin. Reuse React Native uniform
  bindings and gradient pages while preserving Skia subscriber notifications.

- [`081150b`](https://github.com/Amir-Abushanab/orb3d/commit/081150bf4c5a6ad6dc8b8ebe754a411467cbc409) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Allow the shared light source outside the glass (X/Y −3 to 3), and add a state-aware elevation
  offset for its incoming angle. Glass highlights, reflections and water glints follow the angle;
  sunny glare, rays and lens flare keep following the source position. A zero offset preserves the
  existing incidence. Use the final reserved format-7 dial channel without moving contents or
  structure slots, so earlier format-7 programs retain zero elevation.

- [`081150b`](https://github.com/Amir-Abushanab/orb3d/commit/081150bf4c5a6ad6dc8b8ebe754a411467cbc409) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Diffuse custom shader contents through fog and frosted glass with a bounded 25-tap filter,
  premultiplying each sample to preserve transparent edges. Broaden gradient colour pools
  analytically. Clear glass and water lenses retain the single-sample custom contents path.

  Replace bright condensation dots with soft microtexture anchored to the glass. The existing
  fog drift control now develops local coverage while rain trails keep gradually re-fogging.
  Soften sunny glare and lens ghosts, keep rays aligned with the source, and replace timer-driven
  sparkles with glints selected by the light and glass/water normals. All renderers share these
  changes without new config fields or uniform-layout changes.
