# Weather observations, orb and hero

One observation can drive a navbar orb and a hero sky or transparent weather overlay. The
provider adapter owns fetching, caching and refresh timing; the renderer owns animation.

```ts
import { createOrb, normalizeWeather, weatherConfig } from "@orb3d/core";

const observation = normalizeWeather({
  time: Date.now(),
  latitude: 43.65,
  longitude: -79.38,
  temperature: 3,
  dewPoint: 1,
  cloudCover: 0.8,
  visibility: 6000,
  windSpeed: 8,
  windGust: 16,
  windDirection: 270,
  rainRate: 2,
});

const orb = createOrb(navbarContainer, weatherConfig(observation), { poster: "/weather.png" });
const hero = createOrb(heroContainer, weatherConfig(observation, { target: "hero" }), {
  poster: "/weather-hero.png",
});

// When your provider returns another observation, transition without resetting deposits.
orb.setWeather(nextObservation);
hero.setWeather(nextObservation);
// React's OrbHandle and a directly constructed OrbRenderer expose setWeather too.
```

Give the navbar container a small square size and the hero container its actual width and height.
`target: "hero"` produces `weather.view: "sky"`: full-canvas sky, clouds, haze and airborne
precipitation. `target: "overlay"` produces a transparent layer for existing hero artwork.
The overlay draws precipitation, haze and lightning illumination; the sky draws clouds and
celestial bodies. Full-canvas views skip the glass rain/snow/hail simulation. Studio's
**Weather → View** previews all three presentations.

`setWeather` changes the current state's numeric targets over three seconds. It retains water,
snow, hail, ice and motion clocks. Enable switches remain immediate. To control transitions
yourself, use `weatherState(observation, options)` in a state override and `setState`, or pass
`{ transition: true }` to `OrbRenderer.setConfig`.

## Canonical units and options

| Input                              | Meaning                                                         |
| ---------------------------------- | --------------------------------------------------------------- |
| `time`                             | UTC Unix epoch **milliseconds**                                 |
| `latitude`, `longitude`            | Degrees north/east; west is negative                            |
| `temperature`, `dewPoint`          | Celsius                                                         |
| `cloudCover`, `thunder`            | 0–1                                                             |
| `visibility`                       | Metres                                                          |
| `windSpeed`, `windGust`            | Metres per second                                               |
| `windDirection`                    | Meteorological **from** bearing, clockwise from true north      |
| `rainRate`, `snowRate`, `hailRate` | mm/hour **water equivalent**                                    |
| `freezingRain`, `freezingFog`      | Condition flags                                                 |
| `precipitationProbability`         | Optional 0–1 metadata; does not create rainfall                 |
| `solarElevation`, `solarAzimuth`   | Optional provider ephemeris in degrees                          |
| `moonPhase`                        | Optional 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter |
| `moonElevation`, `moonAzimuth`     | Optional provider ephemeris in degrees                          |

`bearing` is the direction the viewer faces, default south (180°). Wind changes incoming angle
and impact impulses; gravity stays down. `glassTemperature` controls melting and condensation,
defaulting to ambient temperature. Dew point plus a colder glass produces condensation; low
outdoor visibility instead produces atmospheric haze. `reducedMotion` suppresses airborne
motion and lightning pulses. The web shell/renderer also honors system reduced-motion preferences.

Studio’s **Rain** slider controls generated rainfall; **Seeded drops** controls the authored
starting beads. Arrivals use scene time independently of **Runoff speed**: at zero, incoming
water still accumulates while surface water stays still. Maximum rainfall can retain 354
generated drops in a 384-drop pool, alongside the three airborne depth layers. Disabled effect
controls are visibly inactive until their Enabled checkbox is checked. Airborne precipitation
defaults to visible whenever rain, snow or hail is active.

Small precipitation rates create smaller drizzle drops. Mixed rain, snow and hail can coexist.
Hail lands, rebounds, settles and melts through the shared liquid runoff and fog-wiping paths.
Fully melted snow/hail deposits become released wet-film patches when incoming precipitation
needs their landing slots; the liquid volume is conserved and the patches gradually re-fog.
Glaze/rime accumulates independently, stays after incoming precipitation stops, and thaws over
time. A hard `enabled: false` hides and pauses an effect; amount zero permits natural cleanup.

Cloud cover controls how much sky is covered, while thickness controls light transmission.
Overcast skies retain a slower distant deck and billowing foreground crowns instead of flattening
into one opaque colour. Observed crosswind sets the signed cloud drift; calm weather retains
gentle motion. Drift is integrated through API refreshes, so direction and speed changes carry
the existing clouds onward. Manual **Clouds → Drift** still controls motion for authored scenes;
`reducedMotion` freezes both decks and their billowing.

## Optional Open-Meteo adapter

`fromOpenMeteo(row, location)` demonstrates a provider adapter without choosing a provider
for your project. Request Celsius, km/h, millimetres and UTC Unix time from Open-Meteo.
Pass one numeric row, rather than its arrays:

```ts
const observation = fromOpenMeteo(response.current, {
  latitude: response.latitude,
  longitude: response.longitude,
  time: response.current.time * 1000,
  intervalSeconds: response.current.interval,
});
orb.setWeather(observation);
hero.setWeather(observation);
```

An hourly row defaults to a 3600-second interval. Current observations normally cover 900 seconds;
passing the actual response interval converts accumulation into an hourly rate. Snow depth in
centimetres uses Open-Meteo's 7:1 snow/water convention. WMO hail codes provide a visual fallback
because the adapter has no measured hail rate; override `hailRate` when your source provides it.
Fetching and API credentials remain in the host project. See [Open-Meteo's variable definitions](https://open-meteo.com/en/docs).

Solar position uses [NOAA's fractional-year equations](https://gml.noaa.gov/grad/solcalc/solareqns.PDF),
with continuous daylight/twilight shading. The fallback moon phase is approximate; its position
is a visual solar-elongation approximation. Supply provider lunar coordinates for an accurate
moon track. Cloud layers and visibility extinction are analytic visual approximations, rather
than a volumetric atmosphere or forecast model.

## Manual controls and portability

Shared Weather controls start with **Air**, then glass tilt, incoming angle, wind speed, gust
speed and turbulence. Air controls incoming precipitation in Hero sky and Weather overlay; its
controls and rendering become inactive when no precipitation is active. Weather groups are
**Clouds**, **Atmosphere**, **Lightning**, **Hail** and **Ice**, alongside Rain, Snow, Fog and Sunny.
All colors use the existing solid/linear/radial/conic/
mesh picker. **Celestial** is a selectable contents type alongside Gradient, Shader and Sunset.
Its sky, sun, moon and star colors are independent of weather layers. Old enabled
`weather.celestial` settings migrate to Celestial contents; disabled legacy settings are discarded.
Move Sun works in orb and hero views. Celestial elevation controls day/night shading;
the shared Light X/Y controls place the source.

Program exports use **format 12**. Logical uniforms can occupy two pages, each within the
16 KiB minimum GLES/WebGL block size. Gradient colors have up to ten additional pages.
Update native libraries and re-export old compiled programs together; authored config JSON still
normalizes normally. Swift/Metal, Android/GLES and React Native/Skia share the generated shaders
and equivalent weather runtimes. Native hosts can compile/export states with `weatherState`
and transition their `OrbRuntime`; the TypeScript provider adapters run in the web/JS host.

Validation: `pnpm climate:frames` captures twelve representative cases and a second-page sunset;
`pnpm cloud:frames` checks API-driven scattered, cloudy and overcast skies for visible motion,
cloud definition, reduced motion and WebGL/SkSL parity;
`pnpm parity --metal --only climate-clouds,climate-overcast,climate-night,climate-storm,climate-hail,climate-ice,climate-rime,climate-hero,climate-overlay,sunset`
checks the portable shaders. No performance benchmark is part of this change.
