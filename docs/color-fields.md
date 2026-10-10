# Spatial colors and dynamic effect framing

| Before                                      | After                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| Halo and shadow cut off at the square frame | Frame fits visible outside effects, through live dial/state changes                     |
| Every color restricted to one hex value     | Shared Solid, Linear, Radial, Conic and Mesh editor                                     |
| Sunset sky split into six controls          | One Sky color field; legacy stops migrate without losing their palette                  |
| A field change could snap node layouts      | Springed state weights blend complete sampled fields, including interrupted transitions |

Mesh uses wave3d's influence-weighted distance blend in linear RGB, then converts to sRGB.
Linear/radial/conic interpolate the authored stop colors. Fields support two to eight nodes.
Gradient coordinates are local to the surface/contents being colored; the sky keeps its horizon
and height mapping. Alpha follows the existing effect opacity controls.

The canvas size remains caller-controlled. Framing fits the sphere, a halo tail down to 1/1024
alpha, and shadow/caustic tails; the sphere gets smaller when outside effects need more room.
This works for square and rectangular canvases and preserves the original frame when effects
are absent. Studio's movable light handle uses the same bounds calculation.

Program format 12 splits logical uniforms into up to two blocks, each below the GLES minimum
16 KiB limit. Optional color definitions occupy additional pages of at most 16 KiB each, with
a portable ceiling of ten pages (twelve fragment uniform blocks in total). Definitions are shared when identical between fields/states. Solid-only configs add
no pages or sampler work. Custom color programs embed GLSL/MSL sources for native playback.
Native libraries must be updated and older compiled programs re-exported; authored config JSON
continues to migrate automatically.

Validation: normalization and round trips; all color dials across every contents type;
solid-only gating; field transitions and cache identity; bounds under halo/shadow/caustics;
WebGL/Skia/Metal captures for each gradient mode and a color state override. Pixel comparisons
use premultiplied visible RGB and alpha, ignoring RGB hidden beneath fully transparent pixels.
Studio checks cover keyboard point motion, add/remove, mode changes, undo and reload.

Run `pnpm color:frames` for the color renders and edge-alpha assertions, and `pnpm parity --metal
--only sunset,color-linear,color-radial,color-conic,color-mesh,color-state` for platform comparisons.
No performance benchmark was run.
