// The glass, in JavaScript. The shader carries the same two functions; these place things the
// shader is handed already bent (the sun's glow), and pin the inverse down in tests.

const HALF_PI = Math.PI / 2;

/**
 * Where a scene point `d` from the centre lands on the orb's face. Through the glass a point lands
 * at sin(d·π/2): magnified at the middle, crowded at the rim, and `bend` mixes that with no glass
 * at all. Past the rim nothing shows; that branch only keeps the mapping monotonic.
 */
export function bendRadius(d: number, bend: number): number {
  const bent = d <= 1 ? Math.sin(d * HALF_PI) : 1 + (d - 1) * 0.08;
  return (1 - bend) * d + bend * bent;
}

/** A scene point to the orb's face. */
export function bendPoint(x: number, y: number, bend: number): [number, number] {
  const d = Math.hypot(x, y);
  if (d < 1e-9) return [0, 0];
  const s = bendRadius(d, bend) / d;
  return [x * s, y * s];
}

/**
 * The inverse on the face, `rho` from 0 to 1: which scene radius the glass shows there. Newton's
 * method from `rho` itself, which the root never exceeds (sin(d·π/2) ≥ d on [0, 1]), so it closes
 * in from one side; five steps are exact to well under a pixel. The shader runs the same loop.
 */
export function unbendRadius(rho: number, bend: number): number {
  let d = Math.min(Math.max(rho, 0), 1);
  for (let i = 0; i < 5; i++) {
    const f = (1 - bend) * d + bend * Math.sin(d * HALF_PI) - rho;
    const df = 1 - bend + bend * HALF_PI * Math.cos(d * HALF_PI);
    d = Math.min(Math.max(d - f / Math.max(df, 1e-3), 0), 1);
  }
  return d;
}
