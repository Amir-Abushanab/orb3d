# Rendering performance

The renderer draws one triangle per orb, prunes unused effects, pauses offscreen and in hidden
tabs, and reuses simulation and GPU buffers. The performance pass adds:

- Video textures update on decoded-frame callbacks, with playback-time fallback when that API
  is absent. Texture storage is reused with `texSubImage2D`, sampling parameters are set once,
  and mipmaps regenerate only for a new frame. Paused seeks, resolution changes and context
  restoration still repaint; disposal cancels the callback.
- `adaptiveQuality: true` adjusts live web resolution after a one-second window of slow frame
  pacing. It targets 60 fps, drops by 15% per slow window, and recovers in 5% steps after four
  healthy seconds. Scale never falls below 0.5 or a 192-pixel shorter side. It remains below the
  authored `quality` / `dprMax` ceiling. Small avatars remain sharp. Captures and explicit output
  sizes bypass adaptation. The shell, React and custom element expose the option; Studio opts
  in for its preview. Fixed quality remains the default for embedded orbs. These are pacing
  measurements, not GPU timings; pages with unrelated sustained load can also cause adaptation.
- Rain contacts use reusable 16×16 XY buckets with conservative footprint bounds. Candidate
  masks preserve ascending drop IDs, retaining the original collision order, random sequence
  and water state. TypeScript/worklets, Swift and Kotlin use the same algorithm. Broad-phase
  scratch is rebuilt per step and is excluded from the physical state comparison.
- React Native reuses uniform objects, arrays and static gradient pages. Reanimated's `modify`
  forces subscriber updates after mutation. Media dimensions update in place, and unchanged
  video dimensions no longer allocate a new media descriptor each frame.

## CPU benchmark

`pnpm benchmark` runs the built runtime, warms up 600 frames, and reports the median of five
1200-frame samples at a fixed 1/60 simulation step. Use `--frames` to change the sample length
and `--output renders/performance.json` to save a report. `--baseline /path/to/old/core/dist`
also compares every physical state field and packed uniform exactly at checkpoints across
2400 variable-time frames, with input-level and state changes, before measuring both versions.

One desktop run on October 9, 2026:

| Workload         | Before, CPU ms/frame | After, CPU ms/frame | Reduction |
| ---------------- | -------------------: | ------------------: | --------: |
| Light rain       |               0.0627 |              0.0323 |     48.5% |
| Dense rain       |               0.4407 |              0.2593 |     41.2% |
| Wind-driven rain |               0.3694 |              0.2956 |     20.0% |
| Rain and snow    |               0.4858 |              0.3118 |     35.8% |

The comparison includes simulation and uniform packing only. Basic clear/gradient presets
remain around 0.001 ms in this test. Sub-microsecond differences are noise, and results vary by
machine and workload. These numbers exclude GPU work, browser frame pacing, React Native
subscriber processing and physical-phone measurements; they are not an FPS or battery claim.

Tests cover decoded-frame upload counts and fallback, adaptive quality bounds and capture
resolution, gradient buffer identity and updates, conservative bucket coverage, original pair
ordering, physics and rendered platform parity. A real phone is still needed to assess sustained
frame pacing, battery use and thermals.
