---
"@orb3d/core": patch
---

`OrbConfigInput`, the type of every partial config (`ensureOrbConfig`, `compileOrb`, `createOrb`,
`setConfig` and the components' `config`), now takes every block partially, all the way down, as
the runtime already filled it out. The documented
`config={{ contents: { type: "image", src: "/avatar.jpg" }, glass: { frost: 0.15 } }}` failed to
type-check under strict TypeScript because `contents` and each block had to be complete. Arrays and
colours are still taken whole, and a value of the wrong kind (`fit: "fill"`) is still an error. The
new `OrbContentsInput` type names the contents part.
