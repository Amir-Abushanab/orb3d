# Snow on glass: prior art and implementation

Reviewed 7 October 2026 before implementation. The target is a close view of snow landing on
curved glass, with readable individual crystals, accumulation, and a continuous ice-to-water
transition.

| Reference                                                                                                                                                                            | Useful observation                                                                                                                                   | Adaptation for the orb                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Libbrecht's snow crystal guide](https://www.snowcrystals.com/guide/guide.html)                                                                                                      | Natural snow includes plates, dendrites, rimed crystals and damaged/unequal branches. Fernlike crystals need not be perfectly symmetrical.           | Give each arrival its own persistent seed, morphology, branch lengths, thickness, defects and orientation. Preserve that identity while it lands and melts.                                                                       |
| [Reiter's cellular model](https://webbox.lafayette.edu/~reiterc/mvp/sfn/index.html), [Gravner–Griffeath's growth model](https://www.math.ucdavis.edu/~gravner/papers/h3l.pdf)        | Diffusion and attachment on a hexagonal lattice generate varied sixfold branching.                                                                   | Use hexagonal branching and variation rather than a repeated snowflake icon. Crystal growth itself is outside this surface effect's scope.                                                                                        |
| [Disney's MPM snow paper](https://www.disneyanimation.com/publications/a-material-point-method-for-snow-simulation/) and [Azmisov's implementation](https://github.com/Azmisov/snow) | Snow combines solid and fluid behavior, with packing and cohesive contact.                                                                           | Keep dry crystals pinned and visible through overlap; slowly compact contacting aggregates. Increase mobility and liquid coalescence as ice melts. A volumetric MPM solver would exceed this small shared shader/runtime's scope. |
| [Leinonen & von Lerber's SPH melting paper](https://agupubs.onlinelibrary.wiley.com/doi/full/10.1002/2017JD027909)                                                                   | Melting starts at fine extremities. Water gathers in concavities, pockets merge, and a liquid shell forms around an ice core before becoming a drop. | Erode fine branches before the core, develop connected meltwater with shared surface normals, and conserve ice plus liquid during contact transfers.                                                                              |
| [Particle-based Vulkan snow implementation](https://github.com/giaosame/RealTimeParticleBasedSnowSimulation)                                                                         | Separates neighborhood/contact calculation from visualization, including cohesive and compressive interactions.                                      | Keep deterministic fixed-step surface state on the CPU/worklet and reconstruct crystals and material optics in the existing shader.                                                                                               |

This is a bounded surface model inspired by those observations, rather than an implementation
of crystal growth, MPM, SPH, or a calibrated heat solver. It shares the orb's surface projection,
light direction, and water optics across WebGL, Skia, Metal and GLES.

Controls will cover snow amount, arrival density, landing spread, incoming angle, fall speed,
flake size, adhesion and melting. Incoming angle changes new arrivals; surface gravity remains
independent. Each flake consumes one packed vec4, leaving room for 64 surface particles within
the guaranteed 1024-slot uniform budget even with sunset contents. The new dials and structure
first introduced program format 9; current exports use format 10.

## Implemented behavior and review

| Before                                                                      | After                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No persistent snow surface state.                                           | A seeded 60 Hz simulation tracks incoming, attached and contacting crystals, with interpolation between steps and separate ice/water volumes.                                                                                                                                           |
| Repeated flat snowflake icons would lose identity and depth.                | Each arrival has a persistent morphology seed, unequal branches, fine secondary twigs and a plate/dendrite/rimed family. Incoming flakes tumble out of plane and settle onto the glass's tangent surface. Thin ice transmits the view while edges and growth ridges scatter more light. |
| A fixed contact timer compacted two flakes into an opaque lump too quickly. | Compaction follows collected material volume. The original crystal's size is preserved as bulk volume grows, while larger accumulations become denser.                                                                                                                                  |
| Dry aggregation could transfer separated water pockets.                     | Ice compacts at contact, but liquid transfer waits for the smaller liquid footprints to meet. Separate pockets stay in place.                                                                                                                                                           |
| Uniform fading or a circular puddle would hide the melting sequence.        | Fine twigs recede first. Angular water pockets fill branch hollows, gradually round into liquid caps, and share an analytic height/normal through contact. Larger wet deposits move under tangential gravity.                                                                           |
| A larger upper deposit could collect a lower deposit uphill.                | The downstream deposit receives the contacting material, following the glass's gravity direction even when it is smaller. Separated water pockets still stay in place.                                                                                                                  |
| Meltwater wiped only its current footprint, leaving no persistent streak.   | Snow runoff records into rain's existing bounded path history. Both effects use the same uneven wet film, fog/mist wipe and scene-time recovery. Released paths remain after a particle merges or exits; the old tail re-fogs without depending on rain speed.                          |

## Validation

- `pnpm check` passes: 145 core tests and 18 Studio tests.
  The new tests cover conservation, unique identities, frozen ice, melting with stopped
  snowfall, contact-only liquid transfer, independent incoming wind, frame-rate consistency,
  capture restoration and preservation through config edits. Runoff tests also cover collection
  in four gravity directions, shared trail interpolation with rain stopped, retained timestamps,
  dry ice leaving no wiped path, and conservation including deposited wet film.
- `pnpm snow:frames --motion` captures eight distinct enlarged crystals, melting stages,
  four surface fixtures, and a fifteen-second continuous landing/contact/melting/re-fogging review. The
  optional movie uses ffmpeg; the still checks do not require it.
- A rendered wipe mask is pixel-identical when the same path is tagged as rain or snow.
  Its coverage decreases at 0, 2 and 4 seconds after release and returns completely by 9
  seconds, with rain stopped. `renders/snow/fog-wipe-recovery.png` records those masks;
  `renders/snow/runoff.png` shows the meltwater and wet streak on fully fogged glass.
- Four fixtures at scene time 12 and 128 pixels pass WebGL/Skia/Metal/Android parity. Maximum
  mean difference per channel on the 0–255 scale: Skia 0.280, Metal 0.004, Android below 0.001.
  The sunset fixture uses the largest layout: 1014 vec4 slots within the 1024-slot budget.
- Swift's three library tests and Android release/sample builds pass. Existing weather
  diffusion, alpha, stationary-sun and moving-light checks pass; the six old weather fixtures
  have before/after mean differences below 0.00001 with snow disabled.
- Studio commits landing-angle edits to the selected state's snow override, leaves the base
  angle intact, and undoes the edit. The preview offers cold, wind and thaw states.

The surface simulation does not solve volumetric snow, crystal growth, freezing of existing
water, or calibrated heat transport. Crystal families and the visible phase transition adapt
the research to a small portable renderer.
