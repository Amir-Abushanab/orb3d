# Design and rendering reference

The controls, state model and rendering details behind [Orb Studio](../README.md).

## 🫧 What goes in the glass

| `contents.type` | What it holds                                                                        |
| --------------- | ------------------------------------------------------------------------------------ |
| `none`          | Nothing: clear glass, the room behind it upside down. The default.                   |
| `gradient`      | Four colours swirling in a base: the familiar voice-assistant orb.                   |
| `image`         | Your picture, with zoom, pan, angle and spin. `src` is a URL (or an app asset).      |
| `video`         | Your clip, muted and looping, with the same controls.                                |
| `shader`        | Your own GLSL: `vec4 contents(vec2 p, float time, float level, vec4 knobs, ...)`.    |
| `sunset`        | A sunset over a sea of cloud, drawn flat: the Plovent mark, frame for frame at rest. |
| `celestial`     | A day or night sky with a sun, moon phases and stars.                                |
| `landscape`     | Hills round a lake in 3D, raymarched; you glide down the water toward the sun.       |

Every kind has its own dials (a gradient's colours and flow, a picture's zoom, a landscape's sun and
haze), which states can move like the glass's. Presets: `clear` (the default), `aura` (a gradient),
`landscape`, and `sunset` with its repaints `dawn`, `storm` and `night`.

A shader of your own gets the point of the glass, the time, the level, four knobs and two colours,
all dials a state can spring:

```glsl
vec4 contents(vec2 p, float time, float level, vec4 knobs, vec3 color1, vec3 color2) {
  float waves = sin(length(p) * 12.0 - time * 2.0) * 0.5 + 0.5;
  return vec4(mix(color1, color2, waves + level * 0.3), 1.0);
}
```

It runs everywhere the orb does, so it keeps to what GLSL ES 3.00, SkSL and Metal share: loops with
constant bounds, no textures, no derivatives. The studio shows its compile errors line by line.

## 🔍 The glass

| Block            | Dials                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `glass`          | `bend` (magnifies what is inside), `ior`, `dispersion`, `frost`, `tint`, `opacity`; `reflection`, `highlight`, `glint`; `edge`, `rim`, `bounce`, `outline` and their colours |
| `light`          | source position (`x`, `y`), incoming angle (`elevation`), its `color` and `size`                                                                                             |
| `environment`    | the room the glass mirrors: `sky`, `horizon`, `ground`, and how fast it `spin`s                                                                                              |
| `weather.rain`   | drops and mist on the glass, a simulated downpour following the sphere, and contact merges with curved trails; each drop a lens                                              |
| `weather.snow`   | unique seeded crystals with controlled snowfall, landing spread and angle, fall speed, size, adhesion and melting; surface accumulation and refractive meltwater             |
| `weather.fog`    | soft condensation developing over fixed glass patches; it diffuses the contents, including custom shaders, and running drops wipe paths through it                           |
| `weather.sunny`  | sunshine from where the light is: soft glare, source-aligned rays, glints following the glass and water normals, and lens flare                                              |
| `halo`, `shadow` | a glow round the orb, a shadow under it with the light it gathers                                                                                                            |
| `post`, `react`  | saturation and exposure; how much the level adds to exposure, halo, rain, fog, sun and wobble                                                                                |

In Studio, **Move sun** shows a draggable source on the preview; arrow keys move it and Shift
makes larger steps. Under **Sunny**, **Direction** rotates its position clockwise from up and
**Distance** moves it outward (1 is the orb edge). These are polar controls for `light.x` and
`light.y`, which accept −3 to 3 in orb-radius units. **Elevation offset** (`light.elevation`,
−90° to 90°) adjusts the incoming angle independently: 0 keeps the natural incidence from its
position, positive turns it toward the viewer, and negative turns it away. Glare and flare follow
the source; reflections and glass/water glints follow the incoming angle. All three light dials
can be overridden by states. Old configs retain their lighting at the default zero offset.

## 🌦️ States

Every preset ships five states. Each is a handful of dial overrides over the base look. Clear
glass, for one:

| State       | What it does                                       |
| ----------- | -------------------------------------------------- |
| `idle`      | The room turns slowly round the glass.             |
| `listening` | The glass catches more light; the highlight lifts. |
| `thinking`  | The room spins and the colours split at the rim.   |
| `speaking`  | The orb breathes and brightens with the level.     |
| `muted`     | The glass frosts over and the colour drains out.   |

The contents add their own: a gradient flows faster and swirls when thinking and swells with the
voice when speaking; the landscape speeds up and clouds over; the sunset sets.

States spring, they never cut: each dial is a critically damped spring that starts from rest,
carries its velocity into the next state if you switch mid-transition, and settles in the state's
`duration`. Rates (the room's spin, a gradient's flow, the running rain) are integrated into
clocks, so a change of speed changes how fast things move from where they are instead of jumping
them. Add your own states as more keys in `states`:

```tsx
<Orb3D
  preset="aura"
  state="error"
  config={{
    states: { error: { post: { saturation: 0.2 }, glass: { frost: 0.6, tint: "#ff8080" } } },
  }}
/>
```

## 🎨 Spatial colors and effect bounds

Every Studio color picker offers **Solid, Linear, Radial, Conic and Mesh**. Mesh points can be
moved, recolored, added or removed, with influence and softness controls, following wave3d's
editor. The Sunset sky uses one **Sky → Colour** editor instead of six individual color controls.
Existing sky stops migrate to a linear fill that preserves their colors and positions.

All color dials accept either a hex string or a `GradientColor`; `gradientColor(type, color)`
creates a starting field. Points use normalized coordinates with y up. Each field supports up to
eight points or stops, and state overrides can replace the whole field.

```ts
import { ensureOrbConfig, gradientColor } from "@orb3d/core";

const sky = gradientColor("mesh");
sky.points[0].color = "#ffb36f";
const config = ensureOrbConfig({
  contents: { type: "sunset", sky: { color: sky } },
  halo: { amount: 1, radius: 0.5, color: gradientColor("radial") },
});
```

The renderer fits the orb and its visible halo, shadow and caustic into the supplied canvas,
recalculating bounds as controls and states change. Large outside effects therefore reduce the
sphere's size within that box and get room to fade naturally. With no outside effects the sphere
keeps its original framing. See [color and bounds validation](color-fields.md).

## 🛠️ How it works

One fragment shader over one full-canvas triangle, built for what the orb holds. The glass is the
same round every kind of contents: each pixel on the orb's face is mapped back to the point of the
contents the glass shows there (magnified at the middle, crowded at the rim) and the contents are
drawn there, once per colour channel when the glass disperses. Where the contents are clear, the
room behind shows through, bent by a real solid ball of glass, so it turns upside down. Rain sits on
the inside of the glass, each drop a lens that gathers a patch of the view upside down. Then the
glass goes on top: a darker edge, the room mirrored by Fresnel (faint face on, strong at the rim)
with the light's softbox, light bounced along the bottom, a bright rim, a highlight, a glint and a
fine outline.

A config compiles to a version 12 program: one array of vec4 slots holding the structure, and each state's
dials as a vector. Spatial color fills add separate portable uniform pages and a springed state-weight
vector; complete fields crossfade without snapping mesh points. Solid-only configs need no extra
color pages. On the CPU there is only a small runtime, the same on every platform: a
critically damped spring per dial, the level's smoothing, eight clocks, and the rain running down
the glass. That last is a simulation, since where a drop runs depends on the drops it has met:
up to 384 drops cling until tangential gravity overcomes surface tension, then follow meridians
toward the selected runoff pole (down by default). Contact absorption conserves water volume, dissipates momentum against the glass,
and briefly pauses and pulls the combined drop sideways. Drops shed beads along curved trails, collect
at the bottom and detach. It steps 60 times a unit of the rain clock from a seeded random sequence,
with interpolation between steps. The shader foreshortens drops toward the rim and draws 48
timestamped trail chunks with irregular clearing that re-fogs over six to eight seconds of the
scene clock, even after rain movement stops.
`weather.rain.spawn` blends scattered arrivals across the glass (0, the default) toward the incoming
edge (1). `weather.rain.angle` controls incoming rain: 0 vertical, positive angles slant right, negative
angles slant left (−80° to 80°). It steers the incoming edge and gives new droplets a short
tangent impact impulse that dissipates on the glass. Water already attached is unaffected.
`weather.gravity` is the shared Glass tilt control: 0 down, 90 right, −90 left, and ±180 up.
Surface gravity, resting contact selection, bead shedding and runoff follow the glass tilt.
All effects live in `weather`, with shared `gravity`, `wind` and `water: { lens, shade }` at
its top. `wind` adds an incoming angle to rain and snow's individual angle offsets, clamped to
−80°…80°; it does not tilt gravity. Each of `rain`, `snow`, `fog` and `sunny` has `enabled`
(default true), `amount` and `react` (the input response). Studio groups them under **Weather**.
Old root `rain`/`snow`/`fog`/`sunny`, `rain.direction`, `rain.lens`/`shade`, and `react`'s former
weather fields are accepted and migrated; config JSON exports only the new weather object.

```ts
const config = ensureOrbConfig({
  weather: {
    gravity: 0,
    wind: 25,
    water: { lens: 0.36, shade: "#1a2230" },
    rain: { enabled: true, density: 0.8, run: 1 },
    snow: { enabled: false },
    fog: { enabled: true, amount: 0.4 },
    sunny: { enabled: false },
  },
});
```

The enable switch skips an effect's simulation and rendering immediately. Rain and snow resume
cached particles without catching up on disabled time; their trails still age with scene time.
Changing intensity keeps fades and cleanup: zero snow amount stops new snow while deposited ice
melts; zero rain intensity/density stops arrivals while existing generated water drains. Snow's
meltwater still draws and wipes fog when Rain is disabled. See the [effect gating audit](effect-gating.md)
for shader pruning and remaining costs.

Cloud cover, visibility haze, gusts, lightning, hail, glaze/rime, day/night, moon phases and stars
are configurable in Weather too. `weatherConfig(observation, { target: "hero" })` uses the same
observation for a full-canvas sky; `target: "overlay"` produces a transparent weather layer.
`handle.setWeather(observation)` transitions live weather while retaining deposits. See
[weather integration](weather-integration.md) for units, adapter examples and controls, and
[rendering references](weather-prior-art.md).

These controls can be overridden by states. Program JSON exports use format 12; re-export older
programs with the matching native libraries.

Snow amount is zero by default. Under **Weather → Snow**, **Enabled** hard-disables the effect, **Snow** sets its intensity, and **Snowfall** controls
new arrivals. **Landing spread** goes from the incoming edge (0) to scattered impacts (1), and
**Landing angle** steers incoming wind without tilting gravity. **Adhesion** controls retention.
**Melt** controls heating: zero keeps snow frozen; melting continues if **Fall speed** is zero.
Set Snowfall to zero to let existing snow finish landing and melt. Dry crystals settle, interlock
and compact gradually; fine branches erode before thicker ice, leaving connected water pockets
that coalesce when their liquid surfaces touch. Meltwater runs under surface gravity. Each of
the 64 surface particles retains its own seeded crystal geometry through landing and melting.
The sun and the sphere's foreshortening shape the snow's appearance. This is a bounded surface
model, adapted from [snow crystal and snow-material research](snow-research.md).
The shader works out the rest (where clouds drift, how the eye glides and how water looks), so a
platform port needs the runtime and rain simulation, a draw call and, for media, a texture. Swift and Kotlin carry line-for-line ports; React Native
runs the core's own on its UI thread as worklets.

The shader is written once and expanded into three dialects: GLSL ES 3.00 for WebGL2 and Android,
SkSL for React Native Skia, and MSL for Metal. `pnpm parity` draws every preset in every state, a
picture and a shader of your own through each and compares the pixels with WebGL; they agree to
within the default tolerance of 1.5 levels in 255; media mipmaps vary by platform.

No three.js: unlike [wave3d](https://github.com/Amir-Abushanab/wave3d) and
[materials3d](https://github.com/Amir-Abushanab/materials3d), which this follows in layout and
habits, an orb is one shader and needs no scene graph.

## Known limits

- WebGL2 on the web, GLES 3.0 on Android (minSdk 21) and Metal on Apple platforms. A browser
  without WebGL2 keeps the poster.
- A state moves dials, not layout: it cannot change what is in the glass or add a drop, only move,
  recolour, speed up or hide what the config lays out.
- The sunset holds at most 6 clouds (24 puffs) and 4 banks (32 puffs); the glass at most 16 drops
  and 32 beads. The simulated water and trail history are split across uniform blocks within the 16 KiB
  per-block limit guaranteed by WebGL2 and GLES 3.0.
- The landscape raymarches every pixel: on a low-end phone keep it small or lower `quality`.
- Clear glass shows its own room through it, not the page behind it: a canvas cannot read the
  page. Lower `glass.opacity` to let the page show through, unbent.
- Safari paints no WebGL canvas inside an SVG `<foreignObject>`: an orb there is blank, or drawn
  at the wrong place and scale. To set an orb into an SVG (the o of a wordmark, say), position it
  over the SVG instead, sized from the SVG's own geometry.
- A picture loaded from another origin needs CORS on the web. React Native takes clips as URLs or
  file URIs; a picture can also be a `require`d asset (the `source` prop).
