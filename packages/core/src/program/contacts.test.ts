import { describe, expect, it } from "vitest";
import { createContacts, indexContacts, queryContacts } from "./contacts";

describe("rain contact buckets", () => {
  it("retains every possible contact, including cell edges and large footprints", () => {
    let seed = 27;
    const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
    const n = 384;
    const x = Array.from({ length: n }, () => random() * 2.4 - 1.2);
    const y = Array.from({ length: n }, () => random() * 2.4 - 1.2);
    const r = Array.from({ length: n }, () => 0.001 + random() * 0.3);
    const live = Array.from({ length: n }, () => (random() > 0.2 ? 1 : 0));
    const pair = Array.from({ length: n }, () => (random() > 0.9 ? 4 : -1));
    const own = Array.from({ length: n }, () => (random() > 0.5 ? -1 : Math.floor(random() * 16)));
    const eligible = (i: number) =>
      live[i] === 1 && pair[i]! < 0 && (own[i]! < 0 || own[i]! < 10.4);
    const buckets = createContacts(n);
    indexContacts(buckets, live, pair, own, x, y, r, 0.65, 16);
    for (let i = 0; i < n; i++) {
      if (!eligible(i)) continue;
      queryContacts(buckets, i, x[i]!, y[i]!, r[i]!);
      for (let j = i + 1; j < n; j++) {
        const present = (buckets.mask[j >>> 5]! & (1 << (j & 31))) !== 0;
        if (!eligible(j)) expect(present).toBe(false);
        const reach = 2.25 * (r[i]! + r[j]!);
        if (eligible(j) && Math.hypot(x[i]! - x[j]!, y[i]! - y[j]!) < reach) {
          expect(present).toBe(true);
        }
      }
    }
  });

  it("keeps ascending IDs across signed mask boundaries and reuses its scratch", () => {
    const n = 384;
    const buckets = createContacts(n);
    const head = buckets.head,
      next = buckets.next,
      mask = buckets.mask;
    const live = Array.from({ length: n }, () => 1);
    const unpaired = Array.from({ length: n }, () => -1);
    const positions = Array.from({ length: n }, () => 0);
    const radii = Array.from({ length: n }, () => 0.05);
    indexContacts(buckets, live, unpaired, unpaired, positions, positions, radii, 1, 16);
    queryContacts(buckets, 30, 0, 0, 0.05);
    const ids: number[] = [];
    for (let word = 0; word < mask.length; word++) {
      let bits = mask[word]!;
      while (bits !== 0) {
        const bit = bits & -bits;
        ids.push(word * 32 + 31 - Math.clz32(bit));
        bits ^= bit;
      }
    }
    expect(ids).toEqual(Array.from({ length: n - 31 }, (_, at) => at + 31));
    live.fill(0);
    indexContacts(buckets, live, unpaired, unpaired, positions, positions, radii, 1, 16);
    queryContacts(buckets, 0, 0, 0, 0.05);
    expect(mask.every((value) => value === 0)).toBe(true);
    expect(buckets.head).toBe(head);
    expect(buckets.next).toBe(next);
    expect(buckets.mask).toBe(mask);
  });
});
