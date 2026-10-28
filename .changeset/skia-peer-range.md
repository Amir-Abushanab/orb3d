---
"@orb3d/react-native": patch
---

Narrow the `react-native-skia` peer range from `>=3` to `>=3 <3.0.5`. Later 3.x releases remove
APIs the orb draws with (`useVideo` from 3.0.5, `Skia.Image.MakeImage` from 3.4.2, the `Canvas`'s
`onSize` from 3.5.0), so an app on the current Skia 3 got a package that could not run. With a newer
`react-native-skia` installed, the orb now throws a clear error naming the supported versions
instead of failing later with "useVideo is not a function". The install command in the docs pins
`react-native-skia@3.0.4`. `@shopify/react-native-skia` 2.x is unchanged.
