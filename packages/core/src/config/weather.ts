import { color, num, toggle, type Dial } from "./dials";
import type { ColorValue } from "./fill";

/** Outdoor weather is independent of the condensation and water sitting on the glass. */
export interface OutdoorWeather {
  /** Orb glass, a full-canvas sky for a hero, or transparent airborne effects over a page. */
  view: "orb" | "sky" | "overlay";
  /** Metres per second; incoming angle is still weather.wind. */
  windSpeed: number;
  gusts: number;
  turbulence: number;
  /** Reduce airborne motion and suppress lightning pulses. */
  reducedMotion: boolean;
  clouds: {
    enabled: boolean;
    coverage: number;
    density: number;
    scale: number;
    height: number;
    speed: number;
    color: ColorValue;
    shade: ColorValue;
  };
  atmosphere: {
    enabled: boolean;
    amount: number;
    visibility: number;
    depth: number;
    drift: number;
    color: ColorValue;
  };
  lightning: {
    enabled: boolean;
    amount: number;
    frequency: number;
    bolts: number;
    branches: number;
    color: ColorValue;
  };
  hail: {
    enabled: boolean;
    amount: number;
    density: number;
    size: number;
    bounce: number;
    melt: number;
    color: ColorValue;
  };
  ice: { enabled: boolean; amount: number; rime: number; melt: number; color: ColorValue };
  air: { enabled: boolean; amount: number; depth: number };
}
export type OutdoorOverride = {
  [K in keyof OutdoorWeather]?: OutdoorWeather[K] extends object
    ? Partial<OutdoorWeather[K]>
    : OutdoorWeather[K];
};
export function outdoorDefaults(): OutdoorWeather {
  return {
    view: "orb",
    windSpeed: 0,
    gusts: 0,
    turbulence: 0.35,
    reducedMotion: false,
    clouds: {
      enabled: true,
      coverage: 0,
      density: 0.65,
      scale: 1,
      height: 0.2,
      speed: 0.04,
      color: "#e5edf3",
      shade: "#68798e",
    },
    atmosphere: {
      enabled: true,
      amount: 0,
      visibility: 10000,
      depth: 1000,
      drift: 0.03,
      color: "#dce5ec",
    },
    lightning: {
      enabled: true,
      amount: 0,
      frequency: 0.25,
      bolts: 0.6,
      branches: 0.5,
      color: "#dce7ff",
    },
    hail: {
      enabled: false,
      amount: 0,
      density: 0.5,
      size: 1,
      bounce: 0.65,
      melt: 0.25,
      color: "#e7f2ff",
    },
    ice: { enabled: true, amount: 0, rime: 0.5, melt: 0, color: "#d9edff" },
    air: { enabled: true, amount: 1, depth: 0.7 },
  };
}
export const OUTDOOR_DIALS: readonly Dial[] = [
  num("weather.windSpeed", "Weather", "Wind speed (m/s)", 0, 40, 0.1),
  num("weather.gusts", "Weather", "Gust speed (m/s)", 0, 60, 0.1),
  num("weather.turbulence", "Weather", "Turbulence", 0, 1),
  toggle("weather.reducedMotion", "Weather", "Reduced motion"),
  ...["Clouds", "Atmosphere", "Lightning", "Hail", "Ice", "Air"].map((group) =>
    group === "Air"
      ? {
          ...toggle("weather.air.enabled", "Weather", "Airborne layer"),
          hint: "Incoming rain, snow and hail in Hero sky or Weather overlay. Each pattern's enable switch also applies.",
        }
      : toggle(`weather.${group.toLowerCase()}.enabled`, group, "Enabled"),
  ),
  num("weather.clouds.coverage", "Clouds", "Cloud cover", 0, 1),
  num("weather.clouds.density", "Clouds", "Thickness", 0, 1),
  num("weather.clouds.scale", "Clouds", "Scale", 0.25, 3),
  num("weather.clouds.height", "Clouds", "Height", -1, 1),
  num("weather.clouds.speed", "Clouds", "Drift", -0.3, 0.3, 0.001),
  color("weather.clouds.color", "Clouds", "Lit colour"),
  color("weather.clouds.shade", "Clouds", "Shade"),
  num("weather.atmosphere.amount", "Atmosphere", "Haze", 0, 1),
  num("weather.atmosphere.visibility", "Atmosphere", "Visibility (m)", 50, 50000, 50),
  num("weather.atmosphere.depth", "Atmosphere", "View distance (m)", 10, 10000, 10),
  num("weather.atmosphere.drift", "Atmosphere", "Drift", -0.3, 0.3, 0.001),
  color("weather.atmosphere.color", "Atmosphere", "Colour"),
  num("weather.lightning.amount", "Lightning", "Storm activity", 0, 1),
  num("weather.lightning.frequency", "Lightning", "Flashes per second", 0.01, 0.5, 0.01),
  num("weather.lightning.bolts", "Lightning", "Visible bolts", 0, 1),
  num("weather.lightning.branches", "Lightning", "Branching", 0, 1),
  color("weather.lightning.color", "Lightning", "Colour"),
  num("weather.hail.amount", "Hail", "Hail / ice pellets", 0, 1),
  num("weather.hail.density", "Hail", "Intensity", 0, 1),
  num("weather.hail.size", "Hail", "Pellet size", 0.2, 2),
  num("weather.hail.bounce", "Hail", "Bounce", 0, 1),
  num("weather.hail.melt", "Hail", "Melt", 0, 1),
  color("weather.hail.color", "Hail", "Colour"),
  num("weather.ice.amount", "Ice", "Glaze", 0, 1),
  num("weather.ice.rime", "Ice", "Rime", 0, 1),
  num("weather.ice.melt", "Ice", "Thaw", 0, 1),
  color("weather.ice.color", "Ice", "Colour"),
  num("weather.air.amount", "Weather", "Airborne intensity", 0, 1),
  num("weather.air.depth", "Weather", "Air depth spread", 0, 1),
];
