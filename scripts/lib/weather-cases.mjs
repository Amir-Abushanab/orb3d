// Shared optical fixtures for the weather review and native parity checks.
export function weatherCases(normalize) {
  const common = {
    size: 0.92,
    glass: {
      bend: 0,
      reflection: 0,
      highlight: 0,
      glint: 0,
      edge: 0,
      rim: 0,
      bounce: 0,
      outline: 0,
    },
    weather: { rain: { amount: 0, mist: 0, density: 0, run: 0, drops: [], beads: [] } },
    states: { idle: {} },
  };
  const waves = {
    type: "shader",
    code: `vec4 contents(vec2 p, float time, float level, vec4 knobs, vec3 color1, vec3 color2) {
      float wave = 0.5 + 0.25 * sin(p.x * 4.0 + time * 0.3) + 0.25 * sin(p.y * 3.0 - time * 0.4);
      return vec4(mix(vec3(0.04, 0.09, 0.32), vec3(0.2, 0.78, 0.95), wave), 1.0);
    }`,
  };
  const checker = {
    type: "shader",
    code: `vec4 contents(vec2 p, float time, float level, vec4 knobs, vec3 color1, vec3 color2) {
      float pattern = step(0.0, sin(p.x * 36.0) * sin(p.y * 36.0));
      return vec4(mix(vec3(0.03, 0.08, 0.2), vec3(0.65, 0.85, 0.95), pattern), 1.0);
    }`,
  };
  const water = {
    amount: 1,
    mist: 0,
    density: 0,
    run: 0.7,
    drops: [
      [-0.36, 0.5, 0.07, 0],
      [0.12, 0.3, 0.075, 1],
      [0.165, 0.195, 0.025, 0],
    ],
    beads: [],
  };
  const sunlight = { amount: 1, rays: 0.6, sparkle: 0.8, flare: 0.35 };
  return [
    {
      name: "weather-disabled",
      label: "Weather / hard off",
      config: normalize({
        ...common,
        contents: waves,
        weather: {
          rain: { enabled: false, amount: 1, density: 1, mist: 1 },
          snow: { enabled: false, amount: 1 },
          fog: { enabled: false, amount: 1 },
          sunny: { enabled: false, amount: 1 },
        },
      }),
    },
    {
      name: "weather-state-gates",
      label: "Weather / later state",
      config: normalize({
        ...common,
        contents: waves,
        weather: {
          rain: { enabled: false },
          snow: { enabled: false },
          fog: { enabled: false },
          sunny: { enabled: false },
        },
        states: {
          idle: {},
          sunny: {
            weather: { sunny: { enabled: true, amount: 1, flare: 0, rays: 0, sparkle: 0 } },
          },
          fog: { weather: { fog: { enabled: true, react: 1 } } },
          snow: { weather: { snow: { enabled: true, amount: 1, melt: 0.4 } } },
        },
      }),
    },
    {
      name: "fog-shader",
      label: "Fog / sharp contents",
      config: normalize({ ...common, contents: checker, fog: { amount: 1 } }),
    },
    {
      name: "frost-shader",
      label: "Frost / sharp contents",
      config: normalize({ ...common, contents: checker, glass: { ...common.glass, frost: 1 } }),
    },
    {
      name: "fog-gradient",
      label: "Condensation / gradient",
      config: normalize({ ...common, contents: { type: "gradient" }, fog: { amount: 0.65 } }),
    },
    {
      name: "sunny-glass",
      label: "Sun / clear glass",
      config: normalize({ ...common, contents: waves, sunny: sunlight }),
    },
    {
      name: "sunny-rain",
      label: "Sun / moving water",
      config: normalize({ ...common, contents: waves, rain: water, sunny: sunlight }),
    },
    {
      name: "weather-combined",
      label: "Sun / fog / rain",
      config: normalize({
        ...common,
        contents: waves,
        rain: water,
        fog: { amount: 0.85 },
        sunny: sunlight,
      }),
    },
  ];
}
