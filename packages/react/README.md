# @orb3d/react

A drop-in glass orb with states for React.

```sh
pnpm add @orb3d/react
```

```tsx
import { Orb3D } from "@orb3d/react";

export function Status({ state }: { state: "idle" | "thinking" | "speaking" }) {
  return <Orb3D preset="aura" state={state} poster="/orb.png" style={{ width: 96, height: 96 }} />;
}
```

Props: `preset` (a name, lazy-loaded, or a function, tree-shaken: `clear`, the default, `aura`,
`landscape`, `sunset`, `dawn`, `storm`, `night`), `state`, `level` (0 to 1), `config` (merged last,
block by block), the flat `size`, `background`, `speed` and `paused`, and
the shell's mount-time options: `poster`, `posterFit`, `fadeMs`, `lazy`, `webgl`,
`respectReducedMotion`, `adaptiveQuality`, `minSizeForWebGL`, `onReady`, `onFallback`, `onPhaseChange`.

`adaptiveQuality` is opt-in for large orbs: it lowers live resolution during sustained slow frames
and gradually recovers, while snapshots retain the authored resolution.

Changing `state` springs the orb to it and rebuilds nothing. For audio, drive the level through the
ref rather than a prop, so React doesn't re-render every frame:

```tsx
const orb = useRef<OrbHandle>(null);
useEffect(() => analyser.onLevel((rms) => orb.current?.setLevel(rms * 6)), []);
return <Orb3D ref={orb} preset="aura" state="speaking" />;
```

Anything can go in the glass through `config`:

```tsx
<Orb3D config={{ contents: { type: "image", src: "/avatar.jpg" } }} />
<Orb3D config={{ contents: { type: "video", src: "/loop.mp4" } }} />
<Orb3D preset="aura" config={{ glass: { frost: 0.3, tint: "#cfe3ff" } }} />
```

It renders a `<div>`, so it is safe to server-render; pass `<img data-orb3d-poster src="…" />` as
a child for a poster in the server HTML, which the shell adopts.
