import {
  ensureOrbConfig,
  CONTENTS,
  mergeOrbConfig,
  type OrbConfig,
  type OrbConfigInput,
  type OrbStateOverride,
} from "../config/model";
import { clamp, finite } from "../config/dials";

/** Canonical observations. Rates are mm/hour water equivalent; directions are FROM true north. */
export interface WeatherSnapshot {
  time: number;
  latitude: number;
  longitude: number;
  temperature: number;
  dewPoint: number;
  cloudCover: number;
  visibility: number;
  windSpeed: number;
  windGust: number;
  windDirection: number;
  rainRate: number;
  snowRate: number;
  hailRate: number;
  thunder: number;
  freezingRain: boolean;
  freezingFog: boolean;
  /** Kept as metadata; chance of rain does not create rainfall. */
  precipitationProbability?: number;
  solarElevation?: number;
  solarAzimuth?: number;
  moonPhase?: number;
  moonElevation?: number;
  moonAzimuth?: number;
}
export interface WeatherOptions {
  target?: "orb" | "hero" | "overlay";
  /** Compass direction the viewer faces, clockwise from north. */
  bearing?: number;
  /** Glass temperature; otherwise ambient temperature is used as an approximation. */
  glassTemperature?: number;
  reducedMotion?: boolean;
}
export function normalizeWeather(input: Partial<WeatherSnapshot>): WeatherSnapshot {
  const bounded = (key: keyof WeatherSnapshot, fallback: number, lo: number, hi: number): number =>
    clamp(finite(input[key], fallback), lo, hi);
  const result: WeatherSnapshot = {
    time: finite(input.time, Date.now()),
    latitude: bounded("latitude", 0, -90, 90),
    longitude: bounded("longitude", 0, -180, 180),
    temperature: bounded("temperature", 15, -100, 70),
    dewPoint: bounded("dewPoint", finite(input.temperature, 15) - 5, -100, 70),
    cloudCover: bounded("cloudCover", 0, 0, 1),
    visibility: bounded("visibility", 20000, 50, 50000),
    windSpeed: bounded("windSpeed", 0, 0, 60),
    windGust: bounded("windGust", 0, 0, 100),
    windDirection: ((finite(input.windDirection, 0) % 360) + 360) % 360,
    rainRate: bounded("rainRate", 0, 0, 100),
    snowRate: bounded("snowRate", 0, 0, 100),
    hailRate: bounded("hailRate", 0, 0, 100),
    thunder: bounded("thunder", 0, 0, 1),
    freezingRain: input.freezingRain === true,
    freezingFog: input.freezingFog === true,
  };
  result.windGust = Math.max(result.windSpeed, result.windGust);
  result.dewPoint = Math.min(result.temperature, result.dewPoint);
  for (const [key, lo, hi] of [
    ["solarElevation", -90, 90],
    ["solarAzimuth", 0, 360],
    ["moonPhase", 0, 1],
    ["moonElevation", -90, 90],
    ["moonAzimuth", 0, 360],
    ["precipitationProbability", 0, 1],
  ] as const)
    if (typeof input[key] === "number" && Number.isFinite(input[key]))
      result[key] = bounded(key, 0, lo, hi);
  return result;
}

/** NOAA's fractional-year solar approximation. UTC timestamp, degrees east/north; geometric elevation. */
export function solarPosition(
  time: number,
  latitude: number,
  longitude: number,
): { elevation: number; azimuth: number } {
  const date = new Date(time),
    year = date.getUTCFullYear();
  const day = (time - Date.UTC(year, 0, 1)) / 86400000;
  const hour = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const g = ((2 * Math.PI) / (leap ? 366 : 365)) * (Math.floor(day) + (hour - 12) / 24);
  const eq =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(g) -
      0.032077 * Math.sin(g) -
      0.014615 * Math.cos(2 * g) -
      0.040849 * Math.sin(2 * g));
  const dec =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const rad = Math.PI / 180,
    lat = latitude * rad;
  const ha = (hour * 15 + eq / 4 + longitude - 180) * rad;
  const elevation =
    Math.asin(
      clamp(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha), -1, 1),
    ) / rad;
  const azimuth =
    (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(dec) * Math.cos(lat)) / rad +
      180 +
      360) %
    360;
  return { elevation, azimuth };
}
/** Visual lunar phase fallback. Prefer a provider's ephemeris when one is available. */
export function lunarPhase(time: number): number {
  const cycles = (time - Date.UTC(2000, 0, 6, 18, 14)) / (29.530588853 * 86400000);
  return cycles - Math.floor(cycles);
}
const blendColor = (a: string, b: string, t: number): string =>
  "#" +
  [1, 3, 5]
    .map((i) =>
      Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
const response = (rate: number): number =>
  rate <= 0 ? 0 : clamp(Math.log1p(rate) / Math.log(21), 0.04, 1);

/** Dials only, suitable for an existing state and its spring transition. No provider coupling. */
export function weatherState(
  input: Partial<WeatherSnapshot>,
  options: WeatherOptions = {},
): OrbStateOverride {
  const w = normalizeWeather(input),
    bearing = finite(options.bearing, 180),
    rad = Math.PI / 180;
  const sun = solarPosition(w.time, w.latitude, w.longitude);
  const elevation = w.solarElevation ?? sun.elevation,
    azimuth = w.solarAzimuth ?? sun.azimuth;
  const day = clamp((elevation + 6) / 12, 0, 1),
    twilight = 1 - Math.abs(day * 2 - 1);
  const crosswind = -Math.sin((w.windDirection - bearing) * rad) * w.windSpeed;
  const angle = Math.atan2(crosswind, 8) / rad;
  const wet = response(w.rainRate),
    snowy = response(w.snowRate),
    icy = response(w.hailRate);
  const heat = options.glassTemperature ?? w.temperature;
  const condensation = clamp((w.dewPoint - heat + 2) / 5, 0, 1);
  const sx = Math.sin((azimuth - bearing) * rad) * Math.cos(elevation * rad);
  const sy = Math.sin(elevation * rad);
  const moonPhase = w.moonPhase ?? lunarPhase(w.time);
  // Without an ephemeris, the phase gives a visual solar elongation, not a precise lunar position.
  const mx = w.moonAzimuth === undefined ? -sx : Math.sin((w.moonAzimuth - bearing) * rad);
  const my = w.moonElevation === undefined ? Math.max(0.25, -sy) : Math.sin(w.moonElevation * rad);
  const sunAmount = day * (1 - w.cloudCover * 0.88) * Math.exp(-800 / w.visibility);
  return {
    weather: {
      gravity: 0,
      wind: clamp(angle, -80, 80),
      windSpeed: Math.min(40, w.windSpeed),
      gusts: Math.min(60, w.windGust),
      turbulence: 0.45,
      reducedMotion: options.reducedMotion ?? false,
      rain: {
        enabled: true,
        amount: 0,
        mist: wet * 0.3,
        density: wet,
        size: 0.3 + wet * 0.85,
        run: 0.25 + wet * 2.15,
        spawn: 0.15,
      },
      snow: {
        enabled: true,
        amount: snowy,
        density: snowy,
        dispersion: 0.85,
        melt: clamp(heat / 12, 0, 1),
        size: 0.75 + snowy * 0.4,
      },
      hail: {
        enabled: true,
        amount: icy,
        density: icy,
        size: 0.55 + icy * 0.8,
        melt: clamp(heat / 18, 0, 1),
      },
      clouds: {
        enabled: true,
        coverage: w.cloudCover,
        density: 0.35 + w.cloudCover * 0.55,
        // A calm sky still evolves; crosswind carries it in the same direction as precipitation.
        // This rate is integrated, so provider refreshes preserve the clouds' current position.
        speed: (crosswind < 0 ? -1 : 1) * (0.04 + Math.min(40, Math.abs(crosswind)) * 0.004),
      },
      atmosphere: {
        enabled: true,
        amount: clamp(1 - w.visibility / 25000, 0, 1),
        visibility: w.visibility,
      },
      lightning: {
        enabled: true,
        amount: w.thunder,
        bolts: options.target === "orb" || options.target === undefined ? 0 : 0.6,
        frequency: 0.03 + w.thunder * 0.12,
      },
      fog: { enabled: true, amount: condensation },
      ice: {
        enabled: true,
        amount: w.freezingRain ? wet : w.freezingFog ? 0.65 : 0,
        rime: w.freezingFog ? 1 : 0.12,
        melt: clamp(heat / 12, 0, 1),
      },
      sunny: { enabled: true, amount: sunAmount, rays: 0.45 },
      air: {
        enabled: true,
        amount: options.target === "orb" || options.target === undefined ? 0.22 : 1,
        depth: 0.75,
      },
    },
    contents: {
      elevation,
      sun: { color: blendColor("#bed3ff", "#fff4dc", day) },
      moon: { x: mx, y: my, phase: moonPhase, amount: my > 0 ? 0.7 : 0 },
      stars: { amount: 0.7 },
    },
    light: { x: sx * 0.85, y: sy * 0.85, color: blendColor("#bed3ff", "#fff4dc", day) },
    environment: {
      sky: blendColor("#101c38", "#8dbbe0", day),
      horizon: blendColor(blendColor("#26314b", "#cbdce5", day), "#dfac88", twilight * 0.8),
    },
  };
}
/** A ready-to-render orb, full-canvas hero sky, or transparent weather overlay. */
export function weatherConfig(
  input: Partial<WeatherSnapshot>,
  options: WeatherOptions = {},
  base: OrbConfigInput = {},
): OrbConfig {
  const config = ensureOrbConfig(
    mergeOrbConfig(
      ensureOrbConfig({ ...base, contents: base.contents ?? CONTENTS.celestial.defaults() }),
      weatherState(input, options) as OrbConfigInput,
    ),
  );
  config.weather.view =
    options.target === "hero" ? "sky" : options.target === "overlay" ? "overlay" : "orb";
  config.states = { idle: {} };
  config.state = "idle";
  return config;
}

/** WMO codes used by Open-Meteo; quantitative rates always remain separate from probabilities. */
export function wmoCondition(
  code: number,
): Pick<WeatherSnapshot, "thunder" | "freezingRain" | "freezingFog"> {
  return {
    thunder: code >= 95 ? 0.8 : 0,
    freezingRain: [56, 57, 66, 67].includes(code),
    freezingFog: code === 48,
  };
}
/** Open-Meteo row: °C, km/h, metres, cm snow, mm precipitation. Hourly by default.
 * For current observations pass the response interval (usually 900 seconds). Hail codes
 * provide a visual fallback, not a measured hail rate; override hailRate if one is available. */
export function fromOpenMeteo(
  row: Record<string, number>,
  location: { latitude: number; longitude: number; time: number; intervalSeconds?: number },
): WeatherSnapshot {
  const rate = 3600 / Math.max(1, finite(location.intervalSeconds, 3600));
  const snow = (Math.max(0, finite(row.snowfall, 0)) * 10 * rate) / 7; // provider cm snow -> mm water (7:1 convention)
  return normalizeWeather({
    ...location,
    ...wmoCondition(row.weather_code ?? 0),
    temperature: row.temperature_2m,
    dewPoint: row.dew_point_2m,
    cloudCover: (row.cloud_cover ?? 0) / 100,
    visibility: row.visibility,
    windSpeed: (row.wind_speed_10m ?? 0) / 3.6,
    windGust: (row.wind_gusts_10m ?? 0) / 3.6,
    windDirection: row.wind_direction_10m,
    rainRate: ((row.rain ?? 0) + (row.showers ?? 0)) * rate,
    snowRate: snow,
    hailRate: [96, 99].includes(row.weather_code ?? 0)
      ? Math.max(0.2, (row.precipitation ?? 0) * rate)
      : 0,
    precipitationProbability:
      row.precipitation_probability === undefined ? undefined : row.precipitation_probability / 100,
  });
}
