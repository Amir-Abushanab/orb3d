/** Continuous, seeded gust envelope, shared by the surface simulations and the shader. */
export function windAt(time: number, speed: number, gust: number, turbulence: number): number {
  "worklet";
  const envelope = 0.5 + 0.28 * Math.sin(time * 0.73) + 0.22 * Math.sin(time * 1.37 + 1.9);
  return speed + Math.max(0, gust - speed) * envelope * turbulence;
}
