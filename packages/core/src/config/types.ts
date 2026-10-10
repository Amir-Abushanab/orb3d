// The picture's structure: the shapes a config lays out. Kept apart from the model so the data
// that fills them (sunset.ts) and the model that validates them do not import each other.

/** A circle of a cloud or bank: centre and radius, in scene units (the flat picture, y up). */
export type Puff = [x: number, y: number, r: number];
/** A fine bead of mist on the glass: centre and radius on the orb's face (-1 to 1, y up). */
export type Bead = [x: number, y: number, r: number];
/** A thin streak of cloud: centre and radii, in scene units. */
export type Wisp = [x: number, y: number, rx: number, ry: number];
/** A drop on the spherical glass: centre and size on its face. `runs: 1` also draws the
 *  mark's initial wet trail and beads. When the rain clock runs, every drop participates in
 *  surface gravity, pinning and contact merges; small drops cling until they gather enough water.
 *  Moving drops follow the sphere and leave curved trails clear of fog and mist. */
export type Drop = [x: number, y: number, size: number, runs: 0 | 1];

/** A cumulus: puffs on a flat base, drawn as a shaded underside, a body and a sunlit crown. */
export interface Cloud {
  puffs: Puff[];
  base: number;
  shade: string;
  body: string;
  crown: string;
}

/** A bank of the sea of cloud: puffs over a solid body from `y` down, lit at the crest. */
export interface Bank {
  y: number;
  puffs: Puff[];
  top: string;
  foot: string;
  crest: string;
}
