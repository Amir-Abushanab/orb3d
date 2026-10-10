---
"@orb3d/core": patch
"@orb3d/react": patch
"@orb3d/element": patch
"@orb3d/react-native": patch
---

Keep the latest React and custom-element settings when asynchronous presets or configs finish
loading. Preserve properties assigned before custom-element registration and support custom tags.
Recover to the poster when a restored WebGL context cannot rebuild its resources. Respect paused
programs and reduced motion in React Native, and clamp static input levels.

Use Metal buffers for large uniform data, retain playback settings while media loads, and discard
stale native media callbacks. Queue Android updates during render-thread startup and stop work
after shutdown.
