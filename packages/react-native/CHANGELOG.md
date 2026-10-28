# @orb3d/react-native

## 0.4.0

### Minor Changes

- [#18](https://github.com/Amir-Abushanab/orb3d/pull/18) [`1f55af7`](https://github.com/Amir-Abushanab/orb3d/commit/1f55af743fa7d6d667a556181b0b07fcd3552df2) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - `@orb3d/react-native` runs on current React Native Skia 3.x: the `react-native-skia` peer is `>=3 <4` (tested from 3.0.0 to 3.7.2) instead of `>=3 <3.0.5`. The APIs later 3.x releases rename or remove are looked up rather than assumed: the blank image comes from `Skia.Image.MakeRaster`, `MakeRasterImage` or `MakeImage`, whichever this Skia has, and the orb's size from a view around the canvas, since Skia 3.5 removed the canvas's `onSize`. `@shopify/react-native-skia` 2.x is still supported.

  Video contents on `react-native-skia` 3.0.5 and later, which removed `useVideo`, play through React Native WebGPU, a new optional peer (`react-native-webgpu` 0.11.1 or later, the version paired with your Skia): its player decodes the clip into a texture on the GPU device Skia shares, and Skia samples it without a copy. Without it, video contents throw an error naming the package. Skia 2 and 3.0.0 to 3.0.4 keep using Skia's `useVideo`.

### Patch Changes

- Updated dependencies []:
  - @orb3d/core@0.4.0

## 0.3.1

### Patch Changes

- [#13](https://github.com/Amir-Abushanab/orb3d/pull/13) [`871284d`](https://github.com/Amir-Abushanab/orb3d/commit/871284d56d88fd857350861ccab9f03827f3fe0e) Thanks [@Amir-Abushanab](https://github.com/Amir-Abushanab)! - Narrow the `react-native-skia` peer range from `>=3` to `>=3 <3.0.5`. Later 3.x releases remove
  APIs the orb draws with (`useVideo` from 3.0.5, `Skia.Image.MakeImage` from 3.4.2, the `Canvas`'s
  `onSize` from 3.5.0), so an app on the current Skia 3 got a package that could not run. With a newer
  `react-native-skia` installed, the orb now throws a clear error naming the supported versions
  instead of failing later with "useVideo is not a function". The install command in the docs pins
  `react-native-skia@3.0.4`. `@shopify/react-native-skia` 2.x is unchanged.
- Updated dependencies [[`d89a24a`](https://github.com/Amir-Abushanab/orb3d/commit/d89a24ae04edec0d6d9d752dd4cd3fbba1e25e48)]:
  - @orb3d/core@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies [[`15b6280`](https://github.com/Amir-Abushanab/orb3d/commit/15b6280fa69a3650fcdd1a4128ac4a0f9c7cf1bc), [`29fade6`](https://github.com/Amir-Abushanab/orb3d/commit/29fade6a510f8970711ae5dd544cccf621e538cf), [`cfdd90e`](https://github.com/Amir-Abushanab/orb3d/commit/cfdd90e52b9221de537f8b843e04234e68cc39d2), [`300cb3b`](https://github.com/Amir-Abushanab/orb3d/commit/300cb3b179db484ea3b9d56ef6e2bd2806a6e311), [`54d0d91`](https://github.com/Amir-Abushanab/orb3d/commit/54d0d91862f28cfde7cfb336e9e5242469f8b20e)]:
  - @orb3d/core@0.3.0

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
