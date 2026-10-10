export function climateCases(normalize) {
  const base = {
    contents: { type: "none" },
    size: 0.9,
    glass: {
      reflection: 0.1,
      dispersion: 0,
      glint: 0.2,
      highlight: 0,
      edge: 0.12,
      rim: 0.3,
      bounce: 0.15,
    },
    states: { idle: {} },
  };
  return [
    {
      name: "climate-clouds",
      label: "Scattered clouds",
      config: normalize({
        ...base,
        contents: { type: "celestial", elevation: 32 },
        weather: {
          clouds: { coverage: 0.48 },

          air: { amount: 0 },
        },
      }),
    },
    {
      name: "climate-overcast",
      label: "Overcast / visibility",
      config: normalize({
        ...base,
        contents: { type: "celestial", elevation: 18 },
        weather: {
          clouds: { coverage: 1, density: 0.9 },
          atmosphere: { amount: 0.5, visibility: 2200 },
        },
      }),
    },
    {
      name: "climate-night",
      label: "Night / crescent",
      config: normalize({
        ...base,
        contents: { type: "celestial", elevation: -24, moon: { phase: 0.17 } },
        weather: {
          clouds: { coverage: 0.2 },
        },
      }),
    },
    {
      name: "climate-storm",
      label: "Storm / lightning",
      config: normalize({
        ...base,
        contents: { type: "celestial", elevation: -6 },
        weather: {
          view: "sky",
          clouds: { coverage: 0.95, density: 0.9 },

          lightning: { amount: 1, frequency: 0.5, bolts: 1 },
          rain: { density: 0.85, size: 1.1 },
          wind: 25,
          windSpeed: 12,
          gusts: 24,
          air: { amount: 1 },
        },
      }),
    },
    {
      name: "climate-hail",
      label: "Hail / deposits",
      config: normalize({
        ...base,
        contents: { type: "celestial", elevation: 12 },
        weather: {
          hail: { enabled: true, amount: 1, density: 1, size: 1.5, melt: 0.5 },
          snow: { amount: 0 },
          fog: { amount: 0.65 },
        },
      }),
    },
    {
      name: "climate-ice",
      label: "Freezing rain / glaze",
      config: normalize({
        ...base,
        weather: {
          ice: { amount: 1, rime: 0.1 },
          rain: { density: 0.4, size: 0.4, run: 0.2 },
        },
      }),
    },
    {
      name: "climate-rime",
      label: "Freezing fog / rime",
      config: normalize({
        ...base,
        contents: { type: "celestial", elevation: 12 },
        weather: {
          ice: { amount: 0.85, rime: 1 },
          atmosphere: { amount: 0.9, visibility: 400 },
        },
      }),
    },
    {
      name: "climate-hero",
      label: "Hero / blowing snow",
      config: normalize({
        ...base,
        contents: { type: "celestial", elevation: -8 },
        weather: {
          view: "sky",

          snow: { amount: 0.8, density: 0.75 },
          clouds: { coverage: 0.4 },
          wind: -35,
          windSpeed: 15,
          gusts: 25,
          air: { amount: 1, depth: 1 },
        },
      }),
    },
    {
      name: "climate-overlay",
      label: "Overlay / mixed precipitation",
      config: normalize({
        ...base,
        weather: {
          view: "overlay",
          rain: { density: 0.5 },
          snow: { amount: 0.4, density: 0.6 },
          air: { amount: 1 },
        },
      }),
    },
    {
      name: "climate-rain-static",
      label: "Max rain / zero runoff",
      config: normalize({
        ...base,
        contents: { type: "sunset" },
        weather: { rain: { amount: 0, density: 1, run: 0 } },
      }),
    },
    {
      name: "climate-snow-sunset",
      label: "Sustained snow / sunset",
      config: normalize({
        ...base,
        contents: { type: "sunset" },
        weather: {
          rain: { enabled: false },
          snow: { amount: 1, density: 1, melt: 1 },
          air: { amount: 0 },
        },
      }),
    },
    {
      name: "climate-lightning-sunset",
      label: "Lightning / sunset",
      config: normalize({
        ...base,
        contents: { type: "sunset" },
        weather: {
          rain: { enabled: false },
          snow: { enabled: false },
          hail: { enabled: false },
          lightning: { amount: 1, frequency: 0.5, bolts: 1 },
          air: { amount: 0 },
        },
      }),
    },
  ];
}
