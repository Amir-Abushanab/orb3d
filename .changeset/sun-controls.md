---
"@orb3d/core": patch
---

Allow the shared light source outside the glass (X/Y −3 to 3), and add a state-aware elevation
offset for its incoming angle. Glass highlights, reflections and water glints follow the angle;
sunny glare, rays and lens flare keep following the source position. A zero offset preserves the
existing incidence. Use the final reserved format-7 dial channel without moving contents or
structure slots, so earlier format-7 programs retain zero elevation.
