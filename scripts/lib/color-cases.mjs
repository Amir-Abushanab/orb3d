export function colorCases(normalize, gradient) {
  const mesh = gradient("mesh", "#ff8a46");
  const common = {
    size: 1,
    contents: { type: "sunset" },
    weather: {
      rain: { enabled: false },
      snow: { enabled: false },
      fog: { enabled: false },
      sunny: { enabled: false },
    },
    halo: { amount: 1, radius: 0.7, color: mesh },
    shadow: { amount: 0.8, color: gradient("linear", "#6f8bff") },
    states: { idle: {} },
  };
  return [
    ...["linear", "radial", "conic", "mesh"].map((type) => ({
      name: `color-${type}`,
      config: normalize({
        ...common,
        contents: { type: "sunset", sky: { color: gradient(type, "#ff8a46") } },
      }),
    })),
    {
      name: "color-state",
      config: normalize({
        ...common,
        states: {
          idle: {},
          cool: {
            halo: { color: gradient("mesh", "#42cfff") },
            contents: { sky: { color: gradient("conic", "#123456") } },
          },
        },
      }),
    },
  ];
}
