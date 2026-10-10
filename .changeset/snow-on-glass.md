---
"@orb3d/core": minor
---

Add state-aware snow controls for snowfall, landing spread and angle, fall speed, size, adhesion
and melting. Persistent seeded crystals tumble into the curved glass, settle, interlock and
compact gradually. Fine branches erode before thicker ice while meltwater develops in branch
hollows, coalesces on liquid contact and runs under surface gravity. Ice and water volumes are
conserved through contact transfers. Shader geometry, surface normals and water optics are
shared by all renderers; Swift and Kotlin carry matching fixed-step surface simulations.

Program exports use format 8 for the snow dials and 64 packed surface-particle slots, within the
guaranteed 1024-slot uniform budget. Re-export earlier program JSON with the matching libraries.
Existing config links default to snow disabled.
