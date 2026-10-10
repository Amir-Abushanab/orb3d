---
"@orb3d/core": patch
"@orb3d/react-native": patch
---

Retain the latest input level while the web renderer loads, so initial React levels survive
lazy mounting. Keep React Native's public image-source types independent of optional Skia
peers and prefer built declarations in TypeScript, allowing Skia 2 and Skia 3 consumers to
typecheck with only their chosen version installed.
