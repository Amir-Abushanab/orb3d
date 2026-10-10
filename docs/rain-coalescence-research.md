# Droplet coalescence research

Reviewed 6 October 2026. The staged shared-surface model below is now implemented in program format 7.

## Previous cause

The previous `program/rain.ts` implementation gave the surviving drop the donor's entire goal
volume as soon as contact was detected. The donor then moved toward the survivor while its rendered radius was multiplied by
0.65 each step. `shaders/glass.ts` applied only a narrow smooth union to the selected domes.
This made the donor quickly become enclosed or subpixel before a visible liquid neck developed.
The numerical volume check can pass while the rendered merge still looks like disappearance.

## References inspected

| Implementation                                                                                                                  | Source behavior                                                                                                                                                                                                                                                                                         | Useful lesson                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [Codrops RainEffect](https://github.com/codrops/RainEffect/blob/master/src/raindrops.js)                                        | Enlarges the survivor, adds lateral motion, and immediately marks the other drop as killed.                                                                                                                                                                                                             | Its collision response alone does not provide a neck-growth animation.                             |
| [SardineFish raindrop-fx](https://github.com/SardineFish/raindrop-fx/blob/master/src/raindrop.ts#L116-L123)                     | Combines mass and momentum; its [collision update](https://github.com/SardineFish/raindrop-fx/blob/master/src/simulator.ts) removes the other particle. Its [composition shader](https://github.com/SardineFish/raindrop-fx/blob/master/src/shader/compose.glsl) shades from a combined normal texture. | Mass bookkeeping and optical surface continuity are separate requirements.                         |
| [Binix Rainy Glass Simulator](https://github.com/CMbin2333/Binix-Rainy-Glass-Simulator/blob/main/script.js)                     | Sums procedural drop fields before thresholding, then derives refraction offsets from samples of the combined field. It also uses procedural swallow masks.                                                                                                                                             | Borrow the combined-field rendering idea; retain our explicit droplet state and volume accounting. |
| [Chen, Chen and Wong, 2013](https://ir.lib.nycu.edu.tw/server/api/core/bitstreams/d440c98c-cc41-49cd-a98c-c8292e1ead51/content) | Combines particles with a persistent height map, smooths the water surface, and computes a normal map for rendering. Contact uses occupied regions.                                                                                                                                                     | A particle can merge while the water surface remains continuous and relaxes over time.             |

## Implemented adaptation

Keep spherical motion and introduce an explicit coalescence state for contacting droplets:

1. **Contact:** retain both lobes and identify the contact pair using the existing surface test.
2. **Neck growth:** build a local shared implicit water surface between those lobes. Grow its
   connection at the contact point rather than applying broad attraction to unrelated drops.
3. **Redistribution:** transfer donor volume progressively; derive both radii from the volume
   remaining in each lobe. Keep opacity steady and move the donor footprint into the shared body.
4. **Relaxation:** round the joined shape, settle its motion, and release the donor only when its
   remaining lobe is fully integrated.

Refraction, highlights, and silhouette should all use the same combined surface and its gradient.
A first visual timing target of roughly 150–300 ms is an artistic choice to test, not a physical
duration established by these sources. Keep progression independent of frame subdivision and
use matching operations in the worklet, Swift, and Kotlin implementations.

Validate close-up equal-size, unequal-size, glancing, chained, and rim contacts. Check intermediate
frames for a growing connection and continuous highlights, alongside volume and determinism.

## Implementation and verification

A contact reserves two lobe slots for 200 scene milliseconds. The running lobe carries the
combined body forward. The pinned lobe keeps its contact point on the glass as a shared meniscus
and liquid connection develop at the overlap; neither centre is pulled toward the other. Brief
contact drag and a small tangent impulse change the head's speed and direction. Further contacts
wait for that pair to integrate.

At the first visible contact, tension deforms the entire contacting footprints toward the neck.
The smaller lobe responds more strongly. The tangent-plane warp keeps its far edge pinned during
the catch and preserves footprint area; its transformed gradient drives the optical surface.
This response begins before the donor loses volume. Stronger contact drag gives the running head
a brief hesitation, followed by recovery under gravity.

Moving footprints have modest elongation, a rounded leading edge and a narrower trailing
contact line. Deformation and heading relax over several steps instead of turning instantly
with a collision impulse. A parabolic height over each footprint supplies its optical slope. The
contact test uses the corresponding tapered footprint, and residual beads detach beyond its
trailing edge. Shape deformation eases between fixed steps.

Running water loses volume continuously into a wet film at an uneven rate over surface distance.
Each shed bead consumes additional water. The simulation accounts for both droplet and deposited
film volume; stationary beads do not lose water to a runoff film.

The deposited film selects the nearest path centreline before applying age and refraction.
Choosing the freshest overlapping segment made its rounded endpoint become an optical rib at
every saved anchor. A shared tangent and shallow transverse slope now shade the trail as one
thin film. Its width varies over fixed glass patches, so the water pinches and spreads without
texture sliding behind the head. The timestamped clearing and re-fogging still use the wiped path.

The upload caches interpolated partner geometry beside each drop so SkSL can use constant uniform
indices. The layout reuses the former signed partner-index float for the head's shape and reserves
the adjacent shape float for its partner. Each shape has 12 bits of heading and 12 of deformation,
replacing the coarse 7-bit/5-bit motion encoding. The sign still marks a draining donor. The
largest program remains within the portable 16 KiB block.

Format 7 adds the spawn-distribution and flow-direction dial channels to the program's rain
metadata. New rain and replenished authored drops share the same arrival sampler. Distribution
0 covers the glass without an upper-half bias; 1 samples the upstream edge. Rotating gravity
also rotates resting contact selection, residual-bead eligibility, the pendant-drop pole and
detached runoff. Existing water keeps its position and momentum while the force changes.
Incoming Rain angle is independent of glass tilt. It orients new arrivals and their tangent
impact momentum, which dissipates under the existing friction and gravity. Changing wind cannot
steer already attached water. The angle dial consumes one previously reserved glass channel;
the format-7 offsets, shader slots and buffer sizes stay unchanged. Its optional metadata lets
older format-7 programs retain their original flow-aligned arrivals without impact momentum.

Drop shadows sample the real footprint with a soft boundary. They no longer use the virtual lens
centre, which varies per fragment and produced hard columns under elongated drops. Tangent
normals are projected into the view before refraction, and broad highlights replace sharp disks.

Contact rendering combines cap heights and their gradients into a shared surface. Combining
footprint distances alone preserved a separate lens slope on the small lobe and left a pointed
bump during a running contact. The connection is limited by the remaining donor radius and fades
as the footprints overlap, so it cannot leave an oversized endpoint at the donor's old centre.
The contact diagnostic also checks the covered lobe against the running head's own silhouette.

Run `pnpm rain:frames` to render running, small-head, equal-size, small-bead, glancing, chained and
rim contact frames plus matching silhouette views. Timing and deformation are artistic choices;
this is a volume-conserving visual model rather than a full fluid solver.
Use `pnpm rain:frames --motion` for a 120 Hz sequence of the first two contacts. Unlike the
contact sheet, these frames retain the runtime's interpolation between fixed physics steps.
Add `--running` to render just the two running-contact fixtures while adjusting their surface.
Motion frames use an isolated WebGL surface and reuse its compiled shader and uniform buffer.
Skia close-ups check the contact warp's area, centroid shift, pinned edge and covered-lobe contour.
They also compare the same straight film saved with two or twelve anchors, checking both mean
and maximum pixel differences so localized ribs cannot hide in the image-wide average.
