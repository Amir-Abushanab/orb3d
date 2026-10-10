// The sunset: a flat picture (sky, sun, clouds, a sea of cloud) drawn in scene space and seen
// through the glass. The layer order and every proportion follow the Plovent mark's generator, so
// the orb at rest is the logo. Its clocks: m.x is how far the clouds have drifted, m.y the sea.

export const SUNSET_CONTENTS = /* glsl */ `
// The sky's gradient at t, from the horizon's glow (0) to the zenith (1).
vec3 sky($U vec2 s) {
  float t = sat((s.y - $D(contents.sky.horizon)) / max($D(contents.sky.height), 0.001));
  vec2 skyPoint = vec2(s.x, 2.0 * t - 1.0);
  return $C(contents.sky.color; skyPoint);
}

// Where the sun shows on the face, which the glow is centred on and the drops look toward.
vec2 sunFace($U) {
  vec2 sun = vec2($D(contents.sun.x), $D(contents.sun.y));
  float d = length(sun);
  return d > 0.000000001 ? sun * (bendRadius(d, $D(glass.bend)) / d) : vec2(0.0);
}

// The sun's glow is a radial gradient on the face, not in the scene, as in the mark.
vec4 glow($U vec2 face, float level) {
  float g = length(face - sunFace($u)) / max($D(contents.sun.glowRadius), 0.001);
  float amount = max(0.0, $D(contents.sun.glow) + $D(contents.react.glow) * level);
  if (g < 0.35) {
    float k = g / 0.35;
    return vec4(mix($C(contents.sun.glowCore), $C(contents.sun.glowMid), k), mix(0.95, 0.55, k) * amount);
  }
  float k = sat((g - 0.35) / 0.65);
  return vec4(mix($C(contents.sun.glowMid), $C(contents.sun.glowEdge), k), mix(0.55, 0.0, k) * amount);
}

// A cloud's puff p (x, y, radius), the i-th, folded into its body, underside and crown distances.
vec3 cloudPuff(vec3 sd, vec3 p, float i, vec2 s, vec2 low, float shift, float billow, vec4 clock) {
  // Each puff swells and settles on its own phase, so the cloud boils rather than pulses.
  float phase = i * 1.7;
  vec2 at = vec2(p.x + shift, p.y + billow * 0.014 * sin(clock.x * 0.7 + phase * 1.3));
  float r = p.z * (1.0 + billow * 0.08 * sin(clock.x * 0.9 + phase));
  return vec3(
    min(sd.x, length(s - at) - r),
    min(sd.y, length(low - at) - r),
    min(sd.z, length(s - at - vec2(-0.03, 0.05)) - 0.62 * r)
  );
}

// A bank's puff p folded into its body and crest distances.
vec2 bankPuff(vec2 bc, vec3 p, vec2 s, float drift, float extent, float swell, float b, vec4 clock) {
  float x = wrapf(p.x + drift, -extent, extent);
  // A swell travels along the bank.
  vec2 at = vec2(x, p.y + swell * 0.035 * sin(clock.x * 0.8 + x * 2.5 + b * 1.3));
  return vec2(min(bc.x, length(s - at) - p.z), min(bc.y, length(s - at - vec2(-0.012, 0.022)) - p.z));
}

// The flat picture at scene point s. face is where it shows (for the glow), w the anti-aliasing
// width and k scene units per face unit there, so the picture's own softness stays the same size
// on the face however hard the glass bends it.
vec3 scene($U vec2 s, vec2 face, float w, float k, float level, vec4 clock, vec4 m) {
  vec3 col = sky($u s);
  vec4 gl = glow($u face, level);
  col = mix(col, gl.rgb, sat(gl.a));
  vec2 sun = vec2($D(contents.sun.x), $D(contents.sun.y));
  col = mix(col, $C(contents.sun.color), cover(length(s - sun) - $D(contents.sun.radius), w));

  vec4 counts = uData[$S(scene)];
  vec3 wispColor = $C(contents.wisps.color);
  float wispOpacity = $D(contents.wisps.opacity);
  for (int i = 0; i < $MAX(wisps); i++) {
    if (float(i) >= counts.x) break;
    vec4 e = uData[$S(wisps) + i];
    float d = (length((s - e.xy) / e.zw) - 1.0) * min(e.z, e.w);
    col = mix(col, wispColor, wispOpacity * cover(d, w));
  }

  float billow = max(0.0, $D(contents.clouds.billow) + $D(contents.react.billow) * level);
  float crownBlur = max(w, 0.05 * k);
  for (int c = 0; c < $MAX(clouds); c++) {
    if (float(c) >= counts.y) break;
    vec4 box = uData[$S(clouds) + c * 5];
    vec4 span = uData[$S(clouds) + c * 5 + 1];
    // A cloud wraps round once it is wholly past the rim, so it never pops in or out of view.
    float centre = 0.5 * (box.x + box.y);
    float reach = 1.1 + 0.5 * (box.y - box.x);
    float shift = wrapf(centre + m.x, -reach, reach) - centre;
    if (s.x < box.x + shift - 0.4 || s.x > box.y + shift + 0.4 || s.y < box.z - 0.12 || s.y > span.z + 0.12) {
      continue;
    }
    // A flat base under the puffs, then the shape drawn twice: a shaded underside 0.05 lower, the
    // body over it, and a crown lit by the sky, blurred into the body rather than sitting on it.
    vec2 boxCentre = vec2(centre + shift, box.z + 0.5 * box.w);
    vec2 boxExtent = vec2(0.5 * (box.y - box.x), 0.5 * box.w);
    vec2 low = s + vec2(0.0, 0.05);
    float body = boxSdf(s - boxCentre, boxExtent);
    float shade = boxSdf(low - boxCentre, boxExtent);
    vec3 sd = vec3(body, shade, 1000.0);
    // The puffs are packed four to three slots.
    for (int q = 0; q < $MAX(cloudPuffs) / 4; q++) {
      float i = float(q * 4);
      if (i >= span.x + span.y) break;
      if (i + 4.0 <= span.x) continue;
      vec4 a = uData[$S(cloudPuffs) + 3 * q];
      vec4 b = uData[$S(cloudPuffs) + 3 * q + 1];
      vec4 e = uData[$S(cloudPuffs) + 3 * q + 2];
      float end = span.x + span.y;
      if (i >= span.x && i < end) sd = cloudPuff(sd, a.xyz, i, s, low, shift, billow, clock);
      if (i + 1.0 >= span.x && i + 1.0 < end) {
        sd = cloudPuff(sd, vec3(a.w, b.xy), i + 1.0, s, low, shift, billow, clock);
      }
      if (i + 2.0 >= span.x && i + 2.0 < end) {
        sd = cloudPuff(sd, vec3(b.zw, e.x), i + 2.0, s, low, shift, billow, clock);
      }
      if (i + 3.0 >= span.x && i + 3.0 < end) {
        sd = cloudPuff(sd, e.yzw, i + 3.0, s, low, shift, billow, clock);
      }
    }
    body = sd.x;
    shade = sd.y;
    float crown = sd.z;
    col = mix(col, uData[$S(clouds) + c * 5 + 2].xyz, cover(shade, w));
    col = mix(col, uData[$S(clouds) + c * 5 + 3].xyz, cover(body, w));
    col = mix(col, uData[$S(clouds) + c * 5 + 4].xyz, cover(crown, crownBlur));
  }

  float swell = $D(contents.sea.swell);
  float fluff = max(w, 0.026 * k);
  for (int b = 0; b < $MAX(banks); b++) {
    if (float(b) >= counts.z) break;
    vec4 bank = uData[$S(banks) + b * 5];
    if (s.y > bank.x + bank.y + 0.1) continue;
    // Irregular puffs over a solid body, lit at the crest, shaded from the top colour down. The
    // row repeats every period, and nearer banks drift faster, so the sea has depth.
    float extent = 0.5 * uData[$S(banks) + b * 5 + 1].x;
    float drift = m.y * (0.6 + 0.45 * float(b));
    float crest = 1000.0;
    float body = s.y - bank.x;
    vec2 bc = vec2(body, crest);
    float fb = float(b);
    for (int q = 0; q < $MAX(bankPuffs) / 4; q++) {
      float i = float(q * 4);
      if (i >= bank.z + bank.w) break;
      if (i + 4.0 <= bank.z) continue;
      vec4 a = uData[$S(bankPuffs) + 3 * q];
      vec4 p = uData[$S(bankPuffs) + 3 * q + 1];
      vec4 e = uData[$S(bankPuffs) + 3 * q + 2];
      float end = bank.z + bank.w;
      if (i >= bank.z && i < end) bc = bankPuff(bc, a.xyz, s, drift, extent, swell, fb, clock);
      if (i + 1.0 >= bank.z && i + 1.0 < end) {
        bc = bankPuff(bc, vec3(a.w, p.xy), s, drift, extent, swell, fb, clock);
      }
      if (i + 2.0 >= bank.z && i + 2.0 < end) {
        bc = bankPuff(bc, vec3(p.zw, e.x), s, drift, extent, swell, fb, clock);
      }
      if (i + 3.0 >= bank.z && i + 3.0 < end) {
        bc = bankPuff(bc, e.yzw, s, drift, extent, swell, fb, clock);
      }
    }
    body = bc.x;
    crest = bc.y;
    col = mix(col, uData[$S(banks) + b * 5 + 4].xyz, cover(crest, fluff));
    float t = sat((bank.x + bank.y - s.y) / (bank.y + 0.3));
    vec3 tone = mix(uData[$S(banks) + b * 5 + 2].xyz, uData[$S(banks) + b * 5 + 3].xyz, t);
    col = mix(col, tone, cover(body, fluff));
  }
  return col;
}

vec4 orbContents($U vec2 s, vec2 face, float w, float k, float blur, float level, vec4 clock, vec4 m) {
  return vec4(scene($u s, face, w + blur, k, level, clock, m), 1.0);
}
`;

/** The mark's drops: each looks toward the light and the sea of cloud below it, painted from the
 *  sunset's palette, with a share of the real view let through so the drops follow the weather. */
export const SUNSET_DROP = /* glsl */ `
// A bead of water is a lens: it gathers a wide patch of the view, upside down and brighter. Every
// drop looks toward the light and the sea of cloud below it, as in the mark, so each reads dark at
// the top and bright at the bottom; its own position only shifts that a little.
vec2 dropLook($U vec3 drop, vec2 q) {
  return sunFace($u) + vec2(0.0, -0.32) + drop.xy * 0.12 - q * $D(rain.lens);
}

// The mark paints that view as a gradient in the light's colours: dark at the top, the glow
// through the middle, its core at the bottom.
vec3 dropView($U vec3 col, vec3 seen, vec3 drop, vec2 q) {
  float gy = sat(0.5 - 0.5 * q.y);
  vec3 dark = mix($C(rain.shade), uData[$CS + 5].yzw, 0.55);
  vec3 warm = mix($C(contents.sun.glowMid), $C(contents.sun.glowEdge), 0.55);
  vec3 paint = gy < 0.5 ? mix(dark, warm, gy * 2.0) : mix(warm, $C(contents.sun.glowCore), gy * 2.0 - 1.0);
  float paintA = gy < 0.5 ? mix(0.7, 0.55, gy * 2.0) : mix(0.55, 0.9, gy * 2.0 - 1.0);
  return mix(mix(col, paint, paintA), seen, 0.3);
}
`;
