---
"@orb3d/core": minor
---

Add the `orb3d poster` command, which renders an orb's poster to a PNG, WebP or JPEG file from a
preset or a config. It draws through the engine in headless Chromium on SwiftShader, so a config
gives the same file on every machine; by default it draws at four times the size and scales down.
It takes the state, time and level to draw, and reads pictures named by a relative path from the
config's folder. Playwright is an optional peer dependency.
