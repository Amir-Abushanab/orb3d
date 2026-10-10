---
"@orb3d/core": patch
---

Diffuse custom shader contents through fog and frosted glass with a bounded 25-tap filter,
premultiplying each sample to preserve transparent edges. Broaden gradient colour pools
analytically. Clear glass and water lenses retain the single-sample custom contents path.

Replace bright condensation dots with soft microtexture anchored to the glass. The existing
fog drift control now develops local coverage while rain trails keep gradually re-fogging.
Soften sunny glare and lens ghosts, keep rays aligned with the source, and replace timer-driven
sparkles with glints selected by the light and glass/water normals. All renderers share these
changes without new config fields or uniform-layout changes.
