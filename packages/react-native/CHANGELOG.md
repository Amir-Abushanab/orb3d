# @orb3d/react-native

## 0.2.2

### Patch Changes

- [#5](https://github.com/Amir-Abushanab/orb3d/pull/5) [`2ffe72f`](https://github.com/Amir-Abushanab/orb3d/commit/2ffe72fac8cb526dbe3af3392aa0ff6f75b0c966) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Keep attached raindrops draining with gravity after wind impacts and contact merges. Release overloaded drops from the glass before dense rain can feed a single oversized collector. Apply the same simulation fix on the web, React Native, Swift and Android.
- Updated dependencies [[`2ffe72f`](https://github.com/Amir-Abushanab/orb3d/commit/2ffe72fac8cb526dbe3af3392aa0ff6f75b0c966)]:
  - @orb3d/core@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [[`1aad5d4`](https://github.com/Amir-Abushanab/orb3d/commit/1aad5d492a3837eac98811e584fbacca78584074)]:
  - @orb3d/core@0.2.1

## 0.2.0

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
- Updated dependencies [[`081150b`](https://github.com/Amir-Abushanab/orb3d/commit/081150bf4c5a6ad6dc8b8ebe754a411467cbc409), [`081150b`](https://github.com/Amir-Abushanab/orb3d/commit/081150bf4c5a6ad6dc8b8ebe754a411467cbc409), [`081150b`](https://github.com/Amir-Abushanab/orb3d/commit/081150bf4c5a6ad6dc8b8ebe754a411467cbc409), [`081150b`](https://github.com/Amir-Abushanab/orb3d/commit/081150bf4c5a6ad6dc8b8ebe754a411467cbc409), [`081150b`](https://github.com/Amir-Abushanab/orb3d/commit/081150bf4c5a6ad6dc8b8ebe754a411467cbc409), [`081150b`](https://github.com/Amir-Abushanab/orb3d/commit/081150bf4c5a6ad6dc8b8ebe754a411467cbc409), [`081150b`](https://github.com/Amir-Abushanab/orb3d/commit/081150bf4c5a6ad6dc8b8ebe754a411467cbc409)]:
  - @orb3d/core@0.2.0
