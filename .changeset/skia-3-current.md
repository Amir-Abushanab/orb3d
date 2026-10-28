---
"@orb3d/react-native": minor
---

`@orb3d/react-native` runs on current React Native Skia 3.x: the `react-native-skia` peer is `>=3 <4` (tested from 3.0.0 to 3.7.2) instead of `>=3 <3.0.5`. The APIs later 3.x releases rename or remove are looked up rather than assumed: the blank image comes from `Skia.Image.MakeRaster`, `MakeRasterImage` or `MakeImage`, whichever this Skia has, and the orb's size from a view around the canvas, since Skia 3.5 removed the canvas's `onSize`. `@shopify/react-native-skia` 2.x is still supported.

Video contents on `react-native-skia` 3.0.5 and later, which removed `useVideo`, play through React Native WebGPU, a new optional peer (`react-native-webgpu` 0.11.1 or later, the version paired with your Skia): its player decodes the clip into a texture on the GPU device Skia shares, and Skia samples it without a copy. Without it, video contents throw an error naming the package. Skia 2 and 3.0.0 to 3.0.4 keep using Skia's `useVideo`.
