# @orb3d/react-native

A glass orb with states for React Native, drawn with React Native Skia. The same orb as the web
packages: one shader, compiled to Skia's dialect, and the same runtime, run on the UI thread.

```sh
pnpm add @orb3d/react-native react-native-skia react-native-reanimated react-native-worklets
```

It runs on either React Native Skia, and uses whichever the app has installed:

- **Skia 3**, the `react-native-skia` package: Graphite, on Vulkan on Android (API 26 and up) and
  Metal on iOS. It is native code, so it needs a development build, not Expo Go.
- **Skia 2**, the `@shopify/react-native-skia` package: OpenGL ES on Android, Metal on iOS. This is
  the one Expo Go ships, so it is what runs there.

```tsx
import { Orb3D } from "@orb3d/react-native";

<Orb3D preset="aura" state={agent.state} style={{ width: 96, height: 96 }} />;
```

Props: `preset` (`clear`, the default, `aura`, `landscape`, `sunset`, `dawn`, `storm`, `night`),
`config` (merged over the preset, block by block), `program` (a compiled orb from Orb Studio's
export or `compileOrb`, instead of preset and config), `source`, `state`, `level` (0 to 1),
`paused` and `style`. Changing `state` springs the orb to it.

For a picture or clip in the glass, the contents' `src` is a URL; `source` takes its place with
anything `useImage` takes, a `require`d asset included, or for a clip a local file URI:

```tsx
<Orb3D config={{ contents: { type: "image" } }} source={require("./avatar.jpg")} />
<Orb3D config={{ contents: { type: "video", src: "https://example.com/loop.mp4" } }} />
```

A picture is drawn through a child image shader, scaled toward the orb's size so Skia samples a
mipmap; a clip through Skia's `useVideo`. A shader of your own is compiled to SkSL on the device; if
it does not compile there, the orb shows clear glass and warns.

The frame loop runs on the UI thread through Reanimated, so a busy JS thread does not stall it. For
audio, drive the level through the ref, so nothing re-renders per frame:

```tsx
const orb = useRef<Orb3DHandle>(null);
// in your audio loop:
orb.current?.setLevel(rms * 6);
<Orb3D ref={orb} preset="aura" state="speaking" />;
```

Uniform objects and their arrays are reused between frames. Reanimated's `modify` explicitly
notifies Skia after an in-place update; gradient definitions are copied only when the program
changes, while their state weights remain reactive.

Under Reduce Motion it holds a still frame and cuts between states. The worklets Babel plugin, which
Expo configures for you, turns the runtime in `@orb3d/core` into UI-thread code.

Metro reads this package from its source (the `react-native` condition), because the choice
between the two Skia packages is an optional `require` that Metro has to see as written.
TypeScript reads the built declarations first. The public `OrbSource` type describes the
image sources shared by both Skia versions, so either installation typechecks on its own.
