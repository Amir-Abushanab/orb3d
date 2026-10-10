# Weather configuration and effect gates

`weather` owns the shared surface gravity, incoming wind and water optics. Rain, Snow, Fog and
Sunny each have an `enabled` switch and their own intensity/input response. Incoming rain/snow
use the shared wind plus their angle offset, clamped to ±80°. Gravity independently controls
water attached to the glass. Legacy root blocks and dial paths migrate to this object on input;
config JSON contains only the canonical shape. Compiled programs use format 12.

| Before                                                                     | After                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Glass tilt and shared water optics hidden in Rain                          | Shared controls at the top of Weather, above the four effect folders                             |
| Effects controlled only through intensity                                  | Immediate enable switches, with intensity retained for fades and cleanup                         |
| Empty rain still scanned/packed a reserved pool; mist scanned even at zero | Empty/off pools skip simulation, packing and fragment loops; zero mist skips bead scans          |
| Snow intensity zero hid deposits and their wipe                            | Deposited snow finishes melting and draining; meltwater survives Rain being disabled             |
| Dial edits recreated rain and its paths                                    | Recompilation preserves particles and wet paths when authored drop layouts match                 |
| All library shader functions emitted                                       | Effects unused across all configured states are removed, followed by unreachable library helpers |

## Implemented gates

- **Rain/Snow:** hard-off skips fixed-step particle simulation and pool packing/rendering. Simulation
  clocks rebase while off, and contact timing rebases on resume. Intensity zero keeps existing
  generated water and deposited snow finishing their motion/melt. Empty zero-intensity simulations
  skip stepping. Cached particles resume after re-enabling; released trails continue aging on the
  scene clock. Rain and Snow share a timestamped wet-film pool, gated per source.
- **Mist:** zero/off skips the bead loop. Mist can still render alone while the liquid pool is empty.
- **Fog/Sunny:** hard-off skips the effect, including fog blur and sunshine's warm transmission tint.
  Across-state zero intensity and zero input response allow their shader functions to be removed.
- **Sun rays, flare ghosts, sparkle:** each has its own guard and can be removed when unused in all
  enabled sunny states. Basic glare remains independently available.
- **Reflection:** zero skips environment sampling; all-state zero removes the reflection function.
- **Halo/Shadow:** skip unused outside layers; unused layers disappear from specialized shaders.
- **Bounce, rim, highlight, glint, outline:** guard individual layers at zero; omit unused layer
  code. The highlight/glint shared light setup is omitted when neither is used.
- **Blur:** omit custom contents' 24-tap blur when neither frost nor fog is possible. Clear contents
  still take their single-sample path at runtime.
- **Dispersion:** all-state zero specializes to one colour sample. Without liquid effects, that
  also removes the water-lens sampling loop. The GPU compiler folds remaining constant branches.
- **Post:** all-state identity skips saturation/exposure math; final colour clamping remains.
- **Bend/Wobble:** zero bend skips the five-iteration inverse bend; zero wobble skips its sine.

Capability analysis includes every resolved state and input-response coefficient. Runtime frame
flags carry the active subset, so an effect needed in a later state is retained. Shader caches
include capabilities. User shader functions remain roots for library reachability, so custom
contents can still call helpers such as `fbm` even when weather is absent.

## Outdoor weather gates

Clouds, atmosphere, lightning, ice, celestial bodies and airborne precipitation have independent
enable guards and state-aware shader pruning. Coverage/amount zero skips procedural cloud/haze
work. Persistent ice retains its shader capability while enabled, even when accumulation is zero;
it returns immediately if no ice remains. Hail shares the frozen-particle pool and wet trails,
with per-source enable gates. Full-canvas sky/overlay views skip the CPU glass-particle simulation.
Reduced motion suppresses airborne motion and lightning pulses.

## Costs that remain

Uniform slots and CPU particle capacity stay reserved for a stable layout across states and
native universal shader fallbacks. Gates reduce stepping, packing and fragment work; they do not
shrink the fixed allocation or the uniform-buffer upload. Swift/Kotlin built-in shaders retain
universal source with frame guards; explicitly exported shaders and browser/Skia programs can
use specialized source. These are shader-code optimizations, not removal of weather modules from
the JavaScript bundle. Existing lazy renderer imports and function presets provide bundle-level
splitting/tree shaking.

The orb still draws its contents, glass silhouette and background. Arbitrary custom shaders,
media, landscape raymarches, and the animated sunset have their own work; hiding weather cannot
prove they are static. The render loop therefore keeps running rather than automatically sleeping
on a guess. Existing pause, offscreen/document visibility and poster/fallback behavior remain the
appropriate gates for a whole orb. Transparent contents still need the refracted environment even
when surface reflection is zero.

CPU benchmarks and exact simulation comparisons are available through `pnpm benchmark`; see
[performance](performance.md) for scope and results. Validation covers migration/round trips, immediate switches,
paused/resumed particles, retained meltwater, skipped disabled buffer access, state-aware shader
pruning, custom helper reachability, and cross-dialect rendered output.

Spatial colors allocate separate uniform pages only when a color uses a gradient in a configured
state. Solid-only colors keep their existing three dial channels and omit the field sampler.
Gradient shader layouts remain cached while point colors/positions change. Only active state
fields are sampled; unused field helpers are removed by normal shader reachability.
