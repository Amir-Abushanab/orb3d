---
"@orb3d/core": minor
---

Add `OrbGL` to `@orb3d/core/renderer`: a compiled orb's shader on a WebGL2 context you own, with
no DOM, such as an `OffscreenCanvas` in a worker. `use(program)` links the shader its contents
need and binds its uniform blocks; `draw(runtime, width, height)` uploads the runtime's frame and
draws it. `OrbRenderer` now draws through it, so a renderer in a worker no longer copies the
uniform layout, which changes with the program format.
