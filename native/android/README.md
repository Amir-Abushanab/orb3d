# Orb3D for Android

The orb as an Android `View`, drawn with GLES 3.0 on its own thread: the same GLSL the web runs.

Android is available as a **source preview**. Maven Central and JitPack publishing are not
configured yet; use a locally built AAR instead of a remote Maven dependency.

Clone this repository, then build with JDK 17+ and the Android SDK:

```sh
cd native/android
./gradlew :orb3d:assembleRelease
```

Copy `orb3d/build/outputs/aar/orb3d-release.aar` into your app's `app/libs` directory:

```kotlin
// app/build.gradle.kts, inside dependencies
implementation(files("libs/orb3d-release.aar"))
```

The AAR has no external dependencies. Keep it and exported `orb.program.json` files from the
same Orb3D version together.

```kotlin
val orb = OrbView(context).apply { program = OrbPreset.AURA.program }
orb.state = "thinking" // springs there
orb.level = 0.6f       // 0 to 1
```

In Compose:

```kotlin
@Composable
fun AgentOrb(state: String, modifier: Modifier = Modifier.size(96.dp)) {
    AndroidView(
        factory = { OrbView(it).apply { program = OrbPreset.AURA.program } },
        update = { it.state = state },
        modifier = modifier,
    )
}
```

- `OrbView` is a `TextureView`, so it is transparent around the orb and composites like any other
  view. It draws only while attached and visible; under "Remove animations" it holds still.
- Presets: `CLEAR` (the default), `AURA`, `LANDSCAPE`, `SUNSET`, `DAWN`, `STORM`, `NIGHT`.
- A design from Orb Studio: `OrbProgram.fromJson(assets.open("orb.program.json").bufferedReader().readText())`.
  A shader of your own travels in its program; the built-in kinds' shaders are in the library.
- A picture or clip: the program's `src` (a URL, or a file in the app's assets), or `orb.image =
  bitmap` / `orb.video = uri` in its place. Pictures are uploaded with mipmaps; clips play muted and
  looping through MediaPlayer into a SurfaceTexture.
- `OrbSnapshot.bitmap(program, state, time, level, size, image)` draws a still off the main thread.
- minSdk 21. No dependencies.

`OrbRuntime.kt` is a port of the core's `runtime.ts`, and `OrbRain.kt` of its `rain.ts`, the
simulation of 384 drops on the sphere, line for line so it steps to the same rain;
`Generated.kt` holds the shaders and the compiled presets, written by `pnpm native:generate`. Do
not edit it by hand.

Build with `./gradlew :orb3d:assembleRelease` here. The `sample` app shows the orb with a button
per state, and, launched with `--es render all`, writes every preset in every state to its files
(and any programs pushed to its `files/programs`) for `pnpm parity --images` (see CONTRIBUTING.md).

Compiled programs use format version 12. Re-export older program JSON from the matching core;
weather channels, persistent ice and the optional second uniform page use a new layout.
See [weather integration](../../docs/weather-integration.md) for shared orb/hero observations.
