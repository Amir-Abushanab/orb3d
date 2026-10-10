# Launch review — October 9, 2026

Reviewed the core config model, runtime and renderer, framework wrappers, Studio, native renderers,
build helpers and release workflows for obvious bugs, unnecessary duplication and launch issues.
The fixes are in the working tree, with a changeset for the published packages.

## Fixed

| Area                      | Problem and change                                                                                                                                                                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React                     | An earlier asynchronous preset could overwrite a newer design. Config revisions now discard stale completions, and an explicit state prop remains authoritative. Preset resolution shares the synchronous base helper.                                                                         |
| Custom element            | Older config fetches could overwrite newer settings. Revision checks now protect updates and pending mounts, failed HTTP responses are rejected, and non-object JSON falls back safely.                                                                                                        |
| Custom-element lifecycle  | Config assigned before registration could shadow the accessor; custom tags reused an already registered constructor; removal during a phase event could leak the mount. Properties are replayed through the setter, custom tags get their own subclass, and disconnected mounts are destroyed. |
| WebGL recovery            | A browser restore event cleared the fallback timer even when shader rebuilding failed. The timer is now cleared only after the renderer has recovered.                                                                                                                                         |
| Apple renderer            | The main uniform array exceeded the supported inline byte size. A shared binding helper now uses Metal buffers for large arrays, pipeline-state caching is locked, and snapshot command failures are reported.                                                                                 |
| Native media              | A late image could reappear after switching contents, and a newly loaded Apple video could ignore pause. Media tickets and remembered playback settings now preserve the current design. Android also rejects stale video callbacks.                                                           |
| Android lifecycle         | Updates before render-thread startup were dropped, and queued work could continue after shutdown. Startup updates are queued; shutdown invalidates callbacks and prevents further drawing or media work. Very narrow scaled images retain a one-pixel minimum dimension.                       |
| React Native              | Compiled pause settings were ignored, static levels bypassed clamping, and paused redraws missed media-height changes. Pause settings, reduced-motion settling and static uniforms now follow the current program and inputs.                                                                  |
| Studio microphone         | A delayed permission grant could switch the app back to Mic after another source was selected. Stale streams are stopped, setup failures release their streams, and the UI follows the actual mode.                                                                                            |
| Studio local files        | Choosing another large image or video revoked the previous file URL, breaking undo. Earlier files now remain available for the browser session.                                                                                                                                                |
| Exports                   | HTML snippets could assign config before the component import completed. They now use one module script. Custom state names, native string literals and shader text are escaped for their output context.                                                                                      |
| Shared constants and docs | Studio now uses the core colour-point limit. The program-version error message and native uniform-layout documentation match format 12. The README has a shorter introduction and workflow, with detailed material moved to the design reference.                                              |

The remaining duplicate-export notices from Knip are public aliases: `createOrb` / `mountOrb`
and the React Native named / default component exports. They are intentional API compatibility.
The Swift and Kotlin simulation ports and generated shaders are intentional cross-platform copies,
checked against the shared runtime rather than separate design implementations.

Apple documents the inline buffer limit in
[setFragmentBytes](<https://developer.apple.com/documentation/metal/mtlrendercommandencoder/setfragmentbytes(_:length:index:)>).

## Validation

- `pnpm check`: formatting, lint, types, 248 unit tests, dependency rules, unused-code analysis,
  skill validation and generated native-source checks passed.
- `pnpm build` and packed-package smoke checks passed. Published exports and SSR imports work;
  strict consumer types pass with Skia 2 and Skia 3 installed separately.
- Built-wrapper browser checks passed: React StrictMode, controlled state, stale preset loads,
  custom-element upgrades, out-of-order fetches, custom tags and removal during mounting.
- Built Studio checks passed for every preset, local-video undo, all seven framework exports,
  poster downloads, a standalone HTML embed and the mobile layout, with no page errors.
- `swift test`: five tests passed, including real Metal renders of every preset with large uniforms.
- Android library and sample builds passed after the lifecycle changes.
- The complete WebGL / Skia matrix passed: 76 state renders across 40 non-media cases at 96 pixels,
  including weather, snow, sunlight and all colour-field types.
- Standard-size WebGL / Skia / Metal comparisons passed for sunset, image media and a custom shader.
  Clear and aura also passed the earlier Metal comparison. Media sampling varies slightly by backend;
  all standard-size comparisons stay within the existing 1.5/255 mean-channel tolerance.
- The README header is a locally recorded Studio preview: 72 frames, 1280×720, 5.976 seconds,
  infinite loop, 715,066 bytes. It was visually inspected and its animation and local links verified.

Physical iOS, Android and React Native app sessions were not exercised in this review. Native builds,
Swift rendering tests and shader comparisons cover the checks performed here.
