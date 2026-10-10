/** Reusable broad-phase scratch; masks retain the original ascending drop-pair order. */
export interface ContactBuckets {
  head: number[];
  next: number[];
  mask: number[];
  maxRadius: number;
}

export function createContacts(capacity: number): ContactBuckets {
  "worklet";
  return {
    head: Array.from({ length: 256 }, () => -1),
    next: Array.from({ length: capacity }, () => -1),
    mask: Array.from({ length: Math.ceil(capacity / 32) }, () => 0),
    maxRadius: 0,
  };
}

function cell(value: number): number {
  "worklet";
  return Math.max(0, Math.min(15, Math.floor((value + 1) * 8)));
}

export function indexContacts(
  buckets: ContactBuckets,
  live: number[],
  pair: number[],
  own: number[],
  x: number[],
  y: number[],
  r: number[],
  amount: number,
  count: number,
): void {
  "worklet";
  buckets.head.fill(-1);
  buckets.maxRadius = 0;
  for (let i = 0; i < live.length; i++) {
    if (live[i] !== 1 || pair[i]! >= 0 || (own[i]! >= 0 && amount * count <= own[i]!)) continue;
    const at = cell(x[i]!) + cell(y[i]!) * 16;
    buckets.next[i] = buckets.head[at]!;
    buckets.head[at] = i;
    buckets.maxRadius = Math.max(buckets.maxRadius, r[i]!);
  }
}

/** Conservative XY bounds contain every pair accepted by the existing 3D contact test. */
export function queryContacts(
  buckets: ContactBuckets,
  i: number,
  x: number,
  y: number,
  r: number,
): void {
  "worklet";
  buckets.mask.fill(0);
  const reach = 2.25 * (r + buckets.maxRadius);
  const lowX = cell(x - reach),
    highX = cell(x + reach);
  const lowY = cell(y - reach),
    highY = cell(y + reach);
  for (let cy = lowY; cy <= highY; cy++) {
    for (let cx = lowX; cx <= highX; cx++) {
      for (let j = buckets.head[cx + cy * 16]!; j >= 0; j = buckets.next[j]!) {
        if (j > i) buckets.mask[j >>> 5]! |= 1 << (j & 31);
      }
    }
  }
}
