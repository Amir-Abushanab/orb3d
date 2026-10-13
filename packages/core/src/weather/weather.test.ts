import { describe, it, expect } from "vitest";
import {
  normalizeWeather,
  solarPosition,
  lunarPhase,
  weatherState,
  weatherConfig,
  fromOpenMeteo,
} from "./index";
import { compileOrb } from "../program/compile";
import { OrbRuntime } from "../program/runtime";
import { orbShader } from "../program/shader";
import { FEATURES } from "../program/features";
import { createDefaultConfig, dialLayout, ensureOrbConfig, CONTENTS } from "../config/model";
import { windAt } from "../program/wind";

describe("weather observations", () => {
  it("keeps probability separate from measured rain", () => {
    const w = weatherState({ precipitationProbability: 1, rainRate: 0 });
    expect(w.weather?.rain?.density).toBe(0);
    expect(weatherState({ rainRate: 12 }).weather?.rain?.density).toBeGreaterThan(0.8);
  });
  it("maps drizzle to smaller incoming drops and keeps mixed precipitation", () => {
    const drizzle = weatherState({ rainRate: 0.2, snowRate: 1, hailRate: 0.5 });
    const storm = weatherState({ rainRate: 20 });
    expect(drizzle.weather?.rain?.size).toBeLessThan(storm.weather!.rain!.size!);
    expect(drizzle.weather?.snow?.amount).toBeGreaterThan(0);
    expect(drizzle.weather?.hail?.amount).toBeGreaterThan(0);
  });
  it("melts according to glass temperature and condenses below dew point", () => {
    const cold = weatherState(
      { temperature: 4, dewPoint: 2, snowRate: 1 },
      { glassTemperature: -3 },
    );
    const hot = weatherState({ temperature: 20, snowRate: 1 });
    expect(cold.weather?.snow?.melt).toBe(0);
    expect(cold.weather?.fog?.amount).toBe(1);
    expect(hot.weather?.snow?.melt).toBe(1);
  });
  it("uses meteorological wind-from bearing without changing gravity", () => {
    const west = weatherState({ windDirection: 270, windSpeed: 10 }, { bearing: 180 });
    const east = weatherState({ windDirection: 90, windSpeed: 10 }, { bearing: 180 });
    expect(west.weather?.wind).toBeLessThan(0);
    expect(east.weather?.wind).toBeGreaterThan(0);
    expect(west.weather?.gravity).toBe(0);
  });
  it("keeps calm clouds moving and carries them with observed crosswind", () => {
    const calm = weatherState({ windSpeed: 0 });
    const west = weatherState({ windDirection: 270, windSpeed: 10 }, { bearing: 180 });
    const east = weatherState({ windDirection: 90, windSpeed: 10 }, { bearing: 180 });
    expect(calm.weather?.clouds?.speed).toBeGreaterThan(0);
    expect(west.weather?.clouds?.speed).toBeLessThan(0);
    expect(east.weather?.clouds?.speed).toBeGreaterThan(calm.weather!.clouds!.speed!);
    expect(Math.abs(west.weather!.clouds!.speed!)).toBe(east.weather?.clouds?.speed);
  });
  it("preserves the cloud field when a provider refresh reverses the wind", () => {
    const observation = { solarElevation: 30, cloudCover: 1, windSpeed: 10 };
    const runtime = new OrbRuntime(
      compileOrb(weatherConfig({ ...observation, windDirection: 90 })),
    );
    runtime.seek(8);
    const before = [...runtime.write(256, 256)];
    runtime.setProgram(
      compileOrb(weatherConfig({ ...observation, windDirection: 270 })),
      "idle",
      true,
    );
    expect([...runtime.write(256, 256)]).toEqual(before);
    runtime.advance(3);
    const drift = runtime.snapshot().clock[7]!;
    runtime.advance(1);
    expect(runtime.snapshot().clock[7]).toBeLessThan(drift);
  });
  it("normalizes invalid inputs and cannot make gusts weaker than wind", () => {
    const w = normalizeWeather({
      cloudCover: 9,
      windSpeed: 15,
      windGust: 3,
      visibility: NaN,
      windDirection: -90,
    });
    expect(w.cloudCover).toBe(1);
    expect(w.windGust).toBe(15);
    expect(w.visibility).toBe(20000);
    expect(w.windDirection).toBe(270);
  });
  it("converts provider units and freezing/thunder conditions", () => {
    const w = fromOpenMeteo(
      {
        weather_code: 99,
        wind_speed_10m: 36,
        rain: 2,
        showers: 1,
        snowfall: 0.7,
        cloud_cover: 75,
        precipitation_probability: 90,
      },
      { time: 0, latitude: 43, longitude: -79 },
    );
    expect(w.windSpeed).toBe(10);
    expect(w.rainRate).toBe(3);
    expect(w.snowRate).toBe(1);
    expect(w.thunder).toBeGreaterThan(0);
    expect(w.cloudCover).toBe(0.75);
    expect(w.hailRate).toBeGreaterThan(0);
  });
  it("converts precipitation accumulated over a current-observation interval to hourly rates", () => {
    const w = fromOpenMeteo(
      { rain: 0.5, snowfall: 0.175 },
      { time: 0, latitude: 0, longitude: 0, intervalSeconds: 900 },
    );
    expect(w.rainRate).toBe(2);
    expect(w.snowRate).toBe(1);
    expect(normalizeWeather({ temperature: -20 }).dewPoint).toBeLessThanOrEqual(-20);
  });
  it("places equinox sun near the zenith at equatorial solar noon", () => {
    const noon = solarPosition(Date.UTC(2026, 2, 20, 12), 0, 0),
      midnight = solarPosition(Date.UTC(2026, 2, 20, 0), 0, 0);
    expect(noon.elevation).toBeGreaterThan(87);
    expect(midnight.elevation).toBeLessThan(-87);
    const north = solarPosition(Date.UTC(2026, 5, 21, 12), 70, 0),
      night = solarPosition(Date.UTC(2026, 5, 21, 0), 70, 0);
    expect(north.elevation).toBeGreaterThan(40);
    expect(night.elevation).toBeGreaterThan(0);
  });
  it("wraps phase at new moon and retains target presentation", () => {
    expect(lunarPhase(Date.UTC(2000, 0, 6, 18, 14))).toBe(0);
    expect(weatherConfig({}, { target: "hero" }).weather.view).toBe("sky");
    expect(weatherConfig({}, { target: "overlay" }).weather.view).toBe("overlay");
  });
});
describe("contents and independently active precipitation", () => {
  it("offers Celestial as contents and never replaces a chosen scene with weather", () => {
    const sky = weatherConfig({ solarElevation: -18, moonPhase: 0.25 });
    expect(sky.contents.type).toBe("celestial");
    expect(sky.contents).toMatchObject({ elevation: -18, moon: { phase: 0.25 } });
    const gradient = weatherConfig({ rainRate: 4 }, {}, { contents: CONTENTS.gradient.defaults() });
    expect(gradient.contents.type).toBe("gradient");
    expect(JSON.stringify(gradient.weather)).not.toContain("celestial");
  });
  it("migrates the former Celestial weather layer into scene contents", () => {
    const c = ensureOrbConfig({
      weather: {
        celestial: { enabled: true, elevation: -12, moonPhase: 0.17, moonX: 0.3, stars: 0.8 },
      },
    });
    expect(c.contents).toMatchObject({
      type: "celestial",
      elevation: -12,
      moon: { phase: 0.17, x: 0.3 },
      stars: { amount: 0.8 },
    });
    expect(JSON.stringify(c.weather)).not.toContain("celestial");
  });
  it("creates dense rain while runoff speed is zero", () => {
    const r = new OrbRuntime(
      compileOrb({
        weather: { rain: { enabled: true, amount: 0, density: 1, run: 0 } },
        states: { idle: {} },
      }),
    );
    for (let i = 0; i < 120; i++) r.advance(1 / 60);
    const rain = r.snapshot().rain;
    expect(rain.dynamic).toBe(true);
    expect(rain.live.filter((v, i) => v > 0 && rain.own[i]! < 0).length).toBeGreaterThan(100);
    for (let i = 0; i < rain.live.length; i++) {
      if (rain.live[i]! <= 0) continue;
      expect(rain.x[i]).toBeCloseTo(rain.px[i]!, 10);
      expect(rain.y[i]).toBeCloseTo(rain.py[i]!, 10);
    }
    expect(r.snapshot().clock[1]).toBe(0);
  });
  it("enables incoming hero snow and rain without an extra Air slider", () => {
    const config = ensureOrbConfig({
      weather: { view: "sky", rain: { density: 1 }, snow: { amount: 1 } },
      states: { idle: {} },
    });
    expect(config.weather.air.amount).toBe(1);
    expect(compileOrb(config).features & FEATURES.air).toBe(FEATURES.air);
  });
  it("gates the shared Air layer with the individual precipitation switches", () => {
    const program = compileOrb({
      weather: {
        view: "sky",
        air: { enabled: true, amount: 1 },
        rain: { density: 1 },
        snow: { amount: 1 },
        hail: { enabled: true, amount: 1 },
      },
      states: {
        wet: {},
        dry: {
          weather: {
            rain: { enabled: false },
            snow: { enabled: false },
            hail: { enabled: false },
          },
        },
      },
      state: "wet",
    });
    const runtime = new OrbRuntime(program);
    const airActive = (): boolean => {
      const uniforms = runtime.write(256, 144);
      const flags = uniforms[15]! + uniforms[program.weather.canvas * 4 + 2]! * 1048576;
      return (flags & FEATURES.air) !== 0;
    };
    expect(airActive()).toBe(true);
    runtime.setState("dry", true);
    expect(airActive()).toBe(false);
    runtime.setState("wet", true);
    expect(airActive()).toBe(true);
  });
});
describe("persistent weather and shader capabilities", () => {
  it("skips glass particle simulation in full-canvas hero views", () => {
    const r = new OrbRuntime(
      compileOrb(weatherConfig({ rainRate: 10, snowRate: 2, hailRate: 1 }, { target: "hero" })),
    );
    r.seek(12);
    r.advance(1);
    expect(r.snapshot().snow.supplied).toBe(0);
    expect(r.snapshot().snow.serial).toBe(0);
    expect(r.snapshot().rain.done).toBe(0);
  });
  it("lands and rebounds hail before leaving ice that melts into runoff", () => {
    const p = compileOrb({
        weather: {
          rain: { enabled: false },
          snow: { enabled: false },
          hail: { enabled: true, amount: 1, density: 1, melt: 0.8 },
        },
        states: { idle: {}, stop: { weather: { hail: { amount: 0 } } } },
      }),
      r = new OrbRuntime(p);
    let bounce = false,
      deposit = false;
    for (let i = 0; i < 180; i++) {
      r.advance(1 / 60);
      const s = r.snapshot().snow;
      bounce ||= s.live.includes(4);
      deposit ||= s.live.includes(2);
    }
    expect(bounce).toBe(true);
    expect(deposit).toBe(true);
    const before = r.snapshot();
    r.setState("stop", true);
    for (let i = 0; i < 600; i++) r.advance(1 / 60);
    const after = r.snapshot();
    expect(after.snow.serial).toBe(before.snow.serial);
    expect(after.snow.water.reduce((a, b) => a + b, 0) + after.snow.film).toBeGreaterThan(0);
    const total =
      after.snow.ice.reduce((a, b) => a + b, 0) +
      after.snow.water.reduce((a, b) => a + b, 0) +
      after.snow.escaped +
      after.snow.evaporated +
      after.snow.film;
    expect(total).toBeCloseTo(after.snow.supplied, 10);
  });
  it("keeps warm snowfall arriving after its initial pool has melted, conserving water", () => {
    const r = new OrbRuntime(
      compileOrb({
        weather: { rain: { enabled: false }, snow: { amount: 1, density: 1, melt: 1 } },
        states: { idle: {} },
      }),
    );
    for (let i = 0; i < 2400; i++) r.advance(1 / 60);
    const s = r.snapshot().snow;
    expect(s.serial).toBeGreaterThan(128);
    expect(s.film).toBeGreaterThan(0);
    expect(
      s.ice.reduce((a, b) => a + b, 0) +
        s.water.reduce((a, b) => a + b, 0) +
        s.film +
        s.escaped +
        s.evaporated,
    ).toBeCloseTo(s.supplied, 10);
  });
  it("holds ice after precipitation stops and thaws gradually", () => {
    const p = compileOrb({
        weather: { ice: { amount: 1, melt: 0 } },
        states: {
          idle: {},
          dry: { weather: { ice: { amount: 0 } } },
          warm: { weather: { ice: { amount: 0, melt: 1 } } },
        },
      }),
      r = new OrbRuntime(p);
    r.seek(5);
    const frozen = r.snapshot().ice;
    expect(frozen).toBeGreaterThan(0.8);
    r.setState("dry", true);
    r.advance(2);
    expect(r.snapshot().ice).toBe(frozen);
    r.setState("warm", true);
    r.advance(1);
    expect(r.snapshot().ice).toBeLessThan(frozen);
    expect(r.snapshot().ice).toBeGreaterThan(0.5);
  });
  it("preserves water and starts an API dial transition from the current value", () => {
    const p = compileOrb({ weather: { rain: { density: 0.5, run: 1 } }, states: { idle: {} } }),
      r = new OrbRuntime(p);
    r.seek(3);
    const before = r.snapshot();
    const q = compileOrb({ weather: { rain: { density: 1, run: 2 } }, states: { idle: {} } });
    r.setProgram(q, "idle", true);
    expect(r.snapshot().rain.x).toEqual(before.rain.x);
    const at = dialLayout("none").offset["weather.rain.run"]!;
    expect(r.snapshot().x[at]).toBe(1);
    r.advance(0.3);
    expect(r.snapshot().x[at]).toBeGreaterThan(1);
    expect(r.snapshot().x[at]).toBeLessThan(2);
  });
  it("splits high feature bits without losing precision", () => {
    const p = compileOrb({
        weather: {
          clouds: { coverage: 1 },
          atmosphere: { amount: 1 },
          lightning: { amount: 1 },
          celestial: { enabled: true },
          ice: { amount: 1 },
          air: { amount: 1 },
          hail: { enabled: true, amount: 1 },
        },
        states: { idle: {} },
      }),
      r = new OrbRuntime(p);
    r.seek(2);
    const u = r.write(256, 256),
      flags = u[15]! + u[p.weather.canvas * 4 + 2]! * 1048576;
    for (const name of ["clouds", "atmosphere", "lightning", "ice", "air", "hail"] as const)
      expect(flags & FEATURES[name]).toBe(FEATURES[name]);
  });
  it("removes disabled outdoor functions and guards zero amounts", () => {
    const c = createDefaultConfig();
    for (const key of [
      "rain",
      "snow",
      "fog",
      "sunny",
      "clouds",
      "atmosphere",
      "lightning",
      "hail",
      "ice",
      "air",
    ] as const)
      c.weather[key].enabled = false;
    c.states = { idle: {} };
    const shader = orbShader("glsl", compileOrb(c));
    for (const fn of [
      "cloudDensity",
      "stormEvent",
      "airborneWeather",
      "frostWeather",
      "snowOver",
      "rainScan",
    ])
      expect(shader).not.toMatch(new RegExp(`\\b${fn}\\s*\\(`));
  });
  it("keeps gusts continuous and bounded", () => {
    for (let t = 0; t < 20; t += 0.1) {
      const a = windAt(t, 5, 20, 1),
        b = windAt(t + 0.001, 5, 20, 1);
      expect(a).toBeGreaterThanOrEqual(5);
      expect(a).toBeLessThanOrEqual(20);
      expect(Math.abs(b - a)).toBeLessThan(0.1);
    }
  });
});
