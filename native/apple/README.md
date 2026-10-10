# Orb3D for Swift

The orb for SwiftUI, UIKit and AppKit, on Metal. The Swift package lives at the repository root
(SwiftPM only resolves one there) and its sources here.

```swift
// Package.swift
.package(url: "https://github.com/Amir-Abushanab/orb3d", from: "0.1.0")
```

```swift
import Orb3D
import SwiftUI

struct AgentOrb: View {
    var state: String
    var loudness: Double

    var body: some View {
        OrbView(preset: .aura, state: state, level: loudness)
            .frame(width: 96, height: 96)
    }
}
```

- `OrbView(preset:state:level:paused:media:)` for a built-in look (`.clear`, the default, `.aura`,
  `.landscape`, `.sunset`, `.dawn`, `.storm`, `.night`), or `OrbView(program:...)` for a design
  exported from Orb Studio (`orb.program.json`, decoded with `OrbProgram(json:)`).
- A picture or clip: the program's `src` (a URL, or an image or file in the app's bundle), or
  `media: .image(cgImage)` / `media: .url(url)` in its place. Pictures are uploaded with mipmaps;
  clips play muted and looping through AVPlayer.
- A shader of your own travels in its program (Studio exports it written out for Metal); the
  built-in kinds' shaders are in the package.
- Changing `state` springs the orb to it; under Reduce Motion it holds still and cuts.
- `OrbMetalRenderer` drives any `MTKView` for UIKit or AppKit, and `OrbSnapshot.image(...)` draws a
  still without a view, for posters.
- iOS 15, macOS 12, tvOS 15, visionOS 1. The Metal shader is compiled from source at run time, so
  there is no `.metal` build step.

`OrbRuntime.swift` is a line-for-line port of the core's `runtime.ts`, and `OrbRain.swift` of its
`rain.ts`, the simulation of 384 drops on the sphere; `Generated.swift` holds the
shader for each built-in kind of contents in Metal's dialect and the compiled presets, written by
`pnpm native:generate`. Do not edit it by hand. `swift run orb3d-render --preset aura --state all
--out orb.png` (or `--program orb.program.json --image picture.jpg`) renders stills from the
command line, which `pnpm parity --metal` compares with WebGL.

Compiled programs use format version 12. Re-export older program JSON from the matching core;
weather channels, persistent ice and the optional second uniform page use a new layout.
See [weather integration](../../docs/weather-integration.md) for shared orb/hero observations.
