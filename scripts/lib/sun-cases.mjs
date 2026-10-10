import { weatherCases } from "./weather-cases.mjs";

// Position and incidence are independent; include the centre and a source outside the glass.
export function sunCases(normalize) {
  const base = weatherCases(normalize).find((item) => item.name === "sunny-rain").config;
  return [
    ["sun-outside", { x: -1.8, y: 0.8, elevation: 60 }],
    ["sun-elevated", { x: 0.45, y: 0.65, elevation: 35 }],
    ["sun-centre", { x: 0, y: 0, elevation: -90 }],
  ].map(([name, light]) => ({
    name,
    config: normalize({
      ...base,
      light: { ...base.light, ...light },
      glass: { ...base.glass, reflection: 0.3, highlight: 1, glint: 1 },
    }),
  }));
}
