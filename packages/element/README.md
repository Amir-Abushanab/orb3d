# @orb3d/element

`<orb-3d>`: a drop-in glass orb with states for Vue, Svelte or plain HTML.

```sh
pnpm add @orb3d/element
```

```html
<script type="module">
  import "@orb3d/element";
</script>

<orb-3d preset="aura" state="idle" poster="/orb.png" style="width: 96px; height: 96px"></orb-3d>
```

Live attributes: `preset`, `src` (a config JSON URL), `config` (JSON), `state`, `level` (0 to 1)
and `paused`. Changing `state` springs the orb to it. Mount-time attributes: `poster`,
`poster-fit`, `fade-ms`, `lazy`, `webgl` (`auto` | `force` | `off`), `adaptive-quality` and `min-size`.
Add `adaptive-quality` to let large orbs reduce live resolution during sustained slow frames;
snapshots retain the authored resolution. It is off by default.

```js
const orb = document.querySelector("orb-3d");
orb.state = "thinking"; // same as setAttribute("state", "thinking")
orb.setLevel(0.6); // for audio: no attribute churn per frame
orb.config = { glass: { frost: 0.3 } }; // merged last
orb.config = { contents: { type: "image", src: "/avatar.jpg" } }; // anything in the glass
orb.addEventListener("orb3d-ready", (e) => console.log(e.detail)); // the renderer
orb.addEventListener("orb3d-fallback", (e) => console.log(e.detail)); // why it kept the poster
```

Importing it registers the element; under Node the import is a no-op, so it is safe in SSR code.
