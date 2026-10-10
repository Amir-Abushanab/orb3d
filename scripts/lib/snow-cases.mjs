export function snowCases(normalize) {
  const base = {
    contents: { type: "gradient" },
    size: 0.92,
    glass: { bend: 0, reflection: 0.15, highlight: 0, glint: 0, rim: 0.2, bounce: 0.2 },
    rain: { amount: 0, density: 0, mist: 0, run: 0, drops: [], beads: [] },
    snow: { amount: 1, density: 0.85, size: 1.3 },
    states: { idle: {} },
  };
  const cases = [
    ["snow-cold", { melt: 0 }],
    ["snow-thaw", { melt: 0.7 }],
    ["snow-wind", { angle: 55, dispersion: 0.35, melt: 0.3 }],
  ].map(([name, snow]) => ({
    name,
    config: normalize({ ...base, snow: { ...base.snow, ...snow } }),
  }));
  cases.push({
    name: "snow-sunset",
    config: normalize({ ...base, contents: { type: "sunset" }, snow: { ...base.snow, melt: 0.3 } }),
  });
  return cases;
}
