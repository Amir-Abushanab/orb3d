# Fog and sunny effects: prior-art review

Reviewed 6 October 2026 against the original shader and isolated WebGL renders. The review
below records the starting point; the implemented adaptations are documented at the end.

The strongest improvement is fog diffusion for custom contents. Sunny would benefit from
more coherent lighting, but its basic glare/ghost construction is usable.

## Findings and proposed adaptations

| Area                    | Current behavior                                                                                                                                                                                                                                                                                | Recommended adaptation                                                                                                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fog diffusion           | `glass.ts` passes a fog-dependent blur to `orbContents`, but `customContents` in `contents.ts` samples `contents` once and ignores that argument. The gradient also ignores blur; media, sunset and the environment have their own approximations. A checker shader stays sharp at maximum fog. | Give custom contents an explicit diffusion path, with a bounded sample count or a cached contents image when necessary. This is a functional gap, distinct from how much white haze is blended over the image.                                                                    |
| Condensation appearance | Fog combines drifting broad noise, a white veil and bright discs from a jittered regular grid. The small discs dominate at high fog.                                                                                                                                                            | Use softer, less conspicuous microtexture with several scales and uneven coverage. Keep the surface texture anchored while its coverage develops. This is an artistic adaptation of rough-glass scattering and fine-droplet compositing, not a thermodynamic condensation solver. |
| Sunny sparkles          | Grid locations are stationary, but each star blinks on a random timer. Visibility does not depend on a reflected light direction or a droplet's surface.                                                                                                                                        | Use the light/view/surface relationship to select glints, incorporating water normals where useful. Surface movement should drive most sparkle changes; retain decorative twinkling as a restrained stylistic option.                                                             |
| Sunny rays and flare    | Rays phase and rotate with time. Three same-colored ghosts already lie along the light-to-center axis. The effect blends a warm color over the contents.                                                                                                                                        | Reduce autonomous ray motion, soften the brightest core, and preserve texture contrast. Keep the ghost-axis construction; any chromatic variation should be subtle. A full screen-space flare pipeline is unnecessary for the first pass.                                         |

The existing timestamped rain clearing and gradual re-fogging are useful and should be preserved.
Fog here represents condensation on the glass, so atmospheric depth fog and volumetric god rays
would address a different visual problem.

## Primary prior art

- [Lucas Bebber / Codrops: Rain & Water Effect Experiments](https://tympanus.net/codrops/2015/11/04/rain-water-effect-experiments/)
  separates small surface droplets from moving water, uses moving drops to clear them, and
  separates the in-focus droplets from an out-of-focus background. The transferable lesson is
  the distinction between surface detail and the softened view behind it.
- [Mitsuba: rough dielectric material](https://mitsuba.readthedocs.io/en/stable/src/generated/plugins_bsdfs.html#rough-dielectric-material-roughdielectric)
  models rough glass using microfacet scattering, with roughness controlling the interface.
  This supports treating diffusion and reflection as material responses rather than white specks.
- [Jakob et al.: Discrete Stochastic Microfacet Models](https://www.cs.cornell.edu/projects/stochastic-sg14/)
  models glints that respond to lighting/view geometry, with spatial and temporal coherence
  across viewing distances. Borrow that principle, rather than implementing the entire model.
- [John Chapman: Screen Space Lens Flare](https://john-chapman.github.io/2017/11/05/pseudo-lens-flare.html)
  generates ghosts along a center-crossing axis from bright source regions, blurs/composites
  them, and connects starburst phase to camera rotation. He recommends judicious use and
  favors bloom/glare for general perceived brightness. This is useful guidance for restrained
  sunny styling; its multipass architecture is not a necessary dependency for this orb.

## Verification

`renders/fog-sunny-current.png` contains six current-effect captures: clear blue contents,
fog at 0.6 and 1, sunny at 1, and a sharp custom checker shader with fog off/on. They use the
shipping WebGL shader at 256 pixels and scene time 4 seconds. The captures isolate the effects
with rain and reflective highlights disabled; the Studio configuration was not changed.

The recommendations above are judgments about adapting the prior art to this orb. Custom-content
diffusion should bound its sampling work or cache the contents image, since arbitrary contents
shaders have different costs.

## Implemented adaptations

| Before                                                                         | After                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Custom contents ignored fog and frost blur.                                    | A weighted 25-tap spiral diffuses custom contents, with premultiplication before filtering. Clear glass and water lenses still sample once. The spiral replaced a smaller stencil that produced visible diagonal echoes on the checker fixture. |
| Gradient pools ignored blur.                                                   | Gaussian colour pools and the core broaden analytically without repeated shader evaluations.                                                                                                                                                    |
| Condensation translated over the glass and caught light as dense bright discs. | Fixed patches develop their coverage slowly, with restrained, pixel-aware microtexture. Rain clearing and timestamped re-fogging remain intact.                                                                                                 |
| Sunny rays turned with time and stars blinked on unrelated timers.             | Softer glare and quieter, source-aligned rays surround restrained lens ghosts. Glass facets select stars by the light/view relationship; the shared water height gradient selects moving water glints.                                          |

There are no new config fields or uniform-layout changes. `fog.drift` now advances local
coverage development instead of translating the condensation texture. The bounded filter is
an approximation, and unusually detailed custom patterns can retain some sampling texture;
it is not a cached, fully convolved image. No performance benchmarks were run.

`pnpm weather:frames` renders six shared weather fixtures through WebGL and SkSL. It also
checks diffusion without the haze overlay, transparent colour boundaries, a stationary sun,
and light-direction response. The same fixtures are included in `scripts/parity.mjs` for
Metal and Android comparisons. `renders/weather/comparison.png` places each original capture
next to its updated counterpart.

Final verification passed: `pnpm check` (151 unit tests plus the repository checks), the
rendered diffusion/alpha/sunlight regressions, six weather comparisons with Metal, and 41
Android comparisons covering every preset state and the weather fixtures. At 128 pixels,
the weather fixtures' maximum mean difference per RGBA channel on the 0–255 scale was 0.361
for Skia, 0.007 for Metal and below 0.001 for Android, within the 1.5 tolerance. The isolated
checker contrast fell from 127.50 to 14.45 before applying the fog haze.
