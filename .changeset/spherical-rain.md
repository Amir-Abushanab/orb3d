---
"@orb3d/core": minor
---

Simulate rain on the spherical surface, with pinning, tangential gravity, volume-conserving
contact absorption, brief settling pauses, curved trails, rim foreshortening and bottom runoff.
Join contacting borders while the running head continues with brief drag and tangent deflection.
Shade the shared meniscus and connection as pinned water integrates without centre attraction.
Combine water heights and gradients across contact, and retire the connector as the running
footprint covers the donor, so an obsolete lens endpoint cannot linger as a small bump.
Add an immediate contact catch: the smaller footprint leans and stretches toward the meniscus
with its far edge briefly pinned, while adhesion slows the running body before it releases.
Deform moving footprints with a broad front and tapered tail; reduce volume unevenly into the
wet film as well as whenever a residual bead is shed.
Shade deposited water as a continuous shallow film with irregular width, without optical ribs
at saved path anchors.
Leave residual beads intermittently with varied sizes and positions, and vary replenished paths.
Increase maximum rain density and preserve timestamped trail sections so fog returns gradually.
WebGL and Android now upload the larger water layout through a std140 uniform buffer.

Add Spawn distribution (scattered arrivals through to the incoming edge) and Flow direction
(0° down, 90° right, −90° left, ±180° up), now labelled Glass tilt. Tangent gravity, resting
contacts, bead shedding and runoff follow the glass tilt.
Add independent Rain angle for wind-driven arrivals: steer the incoming edge and briefly carry
impact momentum on the glass before friction and gravity take over. Existing attached water
keeps following the glass gravity. All three controls support state overrides.

Compiled programs now use format version 7. Re-export existing program JSON for the new rain
layout and use matching Swift and Android implementations.
