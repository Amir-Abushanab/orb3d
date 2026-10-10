// The Plovent mark, as data: a sunset sky over a sea of cloud, a cumulus leading it, and rain
// beaded on the inside of the glass. Transcribed from the generator that draws the static mark
// (plovent's apps/site/scripts/wordmark.py), including the bank and bead positions its seeded
// random number generator picked, so the live orb at rest is the logo and a poster of it hands off
// with no jump. Scene coordinates are the flat picture before the glass bends it, y up; drop and
// bead coordinates are on the glass itself, the orb's face from -1 to 1, y up.
import type { Bank, Bead, Cloud, Drop, Wisp } from "./types";

export const SUNSET_SKY: [number, string][] = [
  [0, "#fff1c9"],
  [0.14, "#ffc65c"],
  [0.3, "#ff9a3c"],
  [0.5, "#ff5e1f"],
  [0.72, "#e6306e"],
  [1, "#9e1656"],
];

export const SUNSET_WISPS: Wisp[] = [
  [0.55, -0.08, 0.3, 0.024],
  [-0.5, -0.04, 0.24, 0.02],
];

const ROSE = { shade: "#e8607e", body: "#ffcaa5", crown: "#fff3e2" };

export const SUNSET_CLOUDS: Cloud[] = [
  {
    puffs: [
      [0.42, 0.8, 0.1],
      [0.56, 0.86, 0.13],
      [0.7, 0.8, 0.09],
    ],
    base: 0.72,
    ...ROSE,
  },
  {
    puffs: [
      [-0.86, 0.02, 0.08],
      [-0.74, 0.07, 0.1],
      [-0.62, 0.02, 0.07],
    ],
    base: -0.04,
    ...ROSE,
  },
  // The big cumulus that leads the sky: a sunlit crown blurred into a peach body on a rose base.
  {
    puffs: [
      [-0.6, 0.2, 0.14],
      [-0.44, 0.32, 0.19],
      [-0.2, 0.41, 0.24],
      [0.05, 0.34, 0.2],
      [0.24, 0.23, 0.14],
    ],
    base: 0.08,
    shade: "#d9466f",
    body: "#ffb487",
    crown: "#fff0d8",
  },
];

/** Back to front: the far bank is lit peach, the near one is deep magenta. */
export const SUNSET_BANKS: Bank[] = [
  {
    y: -0.34,
    puffs: [
      [-1.2939, -0.3053, 0.1687],
      [-1.0016, -0.3405, 0.1405],
      [-0.6763, -0.3111, 0.1084],
      [-0.4733, -0.3064, 0.1389],
      [-0.1074, -0.3898, 0.1401],
      [0.1655, -0.3671, 0.1851],
      [0.4648, -0.3869, 0.1023],
      [0.6994, -0.2961, 0.1343],
      [0.9382, -0.3478, 0.1026],
      [1.2166, -0.3462, 0.1446],
    ],
    top: "#ffe0b5",
    foot: "#f7a080",
    crest: "#fff4dd",
  },
  {
    y: -0.55,
    puffs: [
      [-1.1953, -0.5052, 0.1351],
      [-0.9427, -0.5165, 0.1962],
      [-0.5153, -0.5692, 0.1845],
      [-0.1658, -0.5419, 0.1443],
      [0.1703, -0.5606, 0.1951],
      [0.5951, -0.5051, 0.179],
      [0.8862, -0.5732, 0.1332],
      [1.1933, -0.5535, 0.1587],
    ],
    top: "#f68e80",
    foot: "#d24f74",
    crest: "#ffc9a8",
  },
  {
    y: -0.78,
    puffs: [
      [-1.2814, -0.7756, 0.187],
      [-0.8209, -0.7674, 0.1566],
      [-0.4751, -0.7463, 0.1759],
      [-0.0319, -0.7304, 0.197],
      [0.457, -0.7824, 0.2139],
      [0.7914, -0.7665, 0.2368],
      [1.2528, -0.7559, 0.2171],
    ],
    top: "#b83f6d",
    foot: "#561541",
    crest: "#ef8496",
  },
];

/** The two that run lead the list and carry trails; the rest cling to the glass. */
export const SUNSET_DROPS: Drop[] = [
  [0.36, -0.2, 0.085, 1],
  [-0.2, -0.58, 0.075, 1],
  [-0.46, -0.3, 0.066, 0],
  [0.1, 0.6, 0.058, 0],
  [0.62, 0.14, 0.05, 0],
  [-0.7, 0.2, 0.045, 0],
  [0.32, -0.66, 0.054, 0],
  [-0.04, 0.1, 0.04, 0],
  [0.58, -0.46, 0.042, 0],
  [-0.62, -0.6, 0.036, 0],
];

/** A mist of fine beads between the drops. */
export const SUNSET_BEADS: Bead[] = [
  [0.6962, 0.2588, 0.0152],
  [0.4783, -0.4122, 0.01],
  [-0.6722, 0.1896, 0.0081],
  [0.1011, -0.4768, 0.0153],
  [0.0363, 0.3665, 0.0144],
  [0.4661, -0.5546, 0.009],
  [0.8606, -0.0096, 0.0097],
  [0.1966, -0.8924, 0.015],
  [-0.221, -0.8766, 0.0123],
  [-0.1828, 0.375, 0.0155],
  [-0.3303, 0.8441, 0.0151],
  [-0.1672, -0.5283, 0.0093],
  [0.1434, -0.1866, 0.0104],
  [-0.0428, 0.0324, 0.0134],
  [-0.2693, -0.437, 0.0145],
  [-0.5143, -0.0625, 0.0118],
  [-0.0618, 0.2112, 0.0158],
  [0.7901, -0.1143, 0.0148],
  [0.813, -0.0927, 0.0109],
  [-0.0774, 0.0416, 0.0084],
  [0.3789, -0.8175, 0.0096],
  [0.032, 0.8884, 0.0155],
  [-0.3069, -0.4554, 0.0122],
  [0.0485, 0.2991, 0.014],
  [0.25, 0.8175, 0.0083],
  [0.2624, 0.093, 0.0107],
  [-0.6777, 0.5666, 0.0107],
  [0.605, 0.3121, 0.0105],
  [-0.1583, -0.3547, 0.0086],
  [0.4543, -0.616, 0.016],
];
