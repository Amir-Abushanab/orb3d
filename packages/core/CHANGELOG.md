# @orb3d/core

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
