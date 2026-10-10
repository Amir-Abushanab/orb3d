// The lighter contents: nothing, a gradient, a picture or clip, and your own shader. The sunset and
// the landscape have files of their own.

/** An empty glass: nothing in front of the room seen through it. */
export const NONE_CONTENTS = /* glsl */ `
vec4 orbContents($U vec2 s, vec2 face, float w, float k, float blur, float level, vec4 clock, vec4 m) {
  return vec4(0.0);
}
`;

/** Four pools of colour drifting through each other in a base colour, the whole turning. m.x is
 *  how far the colours have flowed, m.y how far (in degrees) the whole has turned. */
export const GRADIENT_CONTENTS = /* glsl */ `
// How much of pool i reaches p: each wanders its own slow loop.
float pool(vec2 p, float t, float i, float scale, float blur) {
  vec2 at = 0.58 * vec2(sin(t * (0.43 + 0.11 * i) + i * 1.9), cos(t * (0.37 + 0.09 * i) + i * 2.7));
  // Convolving a Gaussian pool widens it and lowers its peak, keeping its colour energy.
  float area = scale * scale;
  float diffused = area + 2.0 * blur * blur;
  vec2 d = p - at;
  return exp(-dot(d, d) * 1.6 / diffused) * area / diffused;
}

vec4 orbContents($U vec2 s, vec2 face, float w, float k, float blur, float level, vec4 clock, vec4 m) {
  float t = m.x;
  float pulse = $D(contents.pulse) * level;
  vec2 p = rotate2(s, -m.y * 0.01745329);
  // Swirl the colours into each other, twice over at two scales.
  float warp = $D(contents.warp) * (1.0 + 0.5 * pulse);
  p += warp * 0.3 * vec2(sin(p.y * 2.3 + t * 0.9), sin(p.x * 2.1 - t * 1.1));
  p += warp * 0.15 * vec2(sin(p.y * 4.7 - t * 1.3 + 1.7), sin(p.x * 4.1 + t * 0.8 + 0.6));
  float scale = $D(contents.scale) * (1.0 + 0.4 * pulse);
  float a = pool(p, t, 0.0, scale, blur);
  float b = pool(p, t, 1.0, scale, blur);
  float c = pool(p, t, 2.0, scale, blur);
  float d = pool(p, t, 3.0, scale, blur);
  float base = 0.12;
  vec3 col = ($C(contents.base) * base + $C(contents.colors.0) * a + $C(contents.colors.1) * b
    + $C(contents.colors.2) * c + $C(contents.colors.3) * d) / (base + a + b + c + d);
  // The middle glows, as light gathered in the glass.
  float coreSpread = 1.0 + 2.0 * blur * blur;
  float core = $D(contents.core) * (1.0 + pulse) * exp(-dot(s, s) * 2.2 / coreSpread) / coreSpread;
  col = mix(col, min(col * 1.5 + 0.2, vec3(1.0)), sat(core));
  return vec4(col, 1.0);
}
`;

/** A picture or a clip, from the platform's texture. Header slot 3 is its size in pixels and
 *  whether it has loaded; m.x is how far (in degrees) it has turned. */
export const MEDIA_CONTENTS = /* glsl */ `
vec4 orbContents($U vec2 s, vec2 face, float w, float k, float blur, float level, vec4 clock, vec4 m) {
  vec4 media = uData[3];
  if (media.z < 0.5) return vec4(0.0);
  float zoom = $D(contents.zoom) * (1.0 + 0.25 * $D(contents.pulse) * level);
  vec2 p = rotate2(s - vec2($D(contents.x), $D(contents.y)), -($D(contents.angle) + m.x) * 0.01745329) / zoom;
  // The picture's half-size in glass units: covering fits its shorter side across the glass,
  // containing its longer one.
  float aspect = media.x / max(media.y, 1.0);
  bool contain = uData[$S(media)].x > 0.5;
  vec2 extent = (aspect > 1.0) != contain ? vec2(aspect, 1.0) : vec2(1.0, 1.0 / aspect);
  float within = cover(boxSdf(p, extent), w / zoom);
  if (within <= 0.0) return vec4(0.0);
  vec2 uv = vec2(0.5 + 0.5 * p.x / extent.x, 0.5 - 0.5 * p.y / extent.y);
  // How many texels one pixel spans here, frosting included, picks the mip level.
  float texels = (1.5 * w + blur) / zoom * 0.5 * media.y / extent.y;
  return sampleMedia($u clamp(uv, vec2(0.0), vec2(1.0)), log2(max(texels, 1.0))) * within;
}
`;

/** Your own shader, wrapped: `contents` returns straight alpha, the glass wants premultiplied. */
export function customContents(code: string): string {
  return /* glsl */ `
// ---- your contents ----
${code}
// ---- end of your contents ----

vec4 orbCustomSample($U vec2 s, float level, vec4 clock) {
  vec4 c = contents(s, clock.x, level, uData[$CS], $C(contents.color1), $C(contents.color2));
  float a = clamp(c.a, 0.0, 1.0);
  return vec4(clamp(c.rgb, vec3(0.0), vec3(1.0)) * a, a);
}

vec4 orbContents($U vec2 s, vec2 face, float w, float k, float blur, float level, vec4 clock, vec4 m) {
  vec4 centre = orbCustomSample($u s, level, clock);
  $IF(blur)
  if (blur <= 0.0001) return centre;
  // A bounded spiral of taps diffuses arbitrary contents without the echoes of a small stencil.
  // Clear glass and the water
  // lens still use one sample. Premultiply each tap before filtering to avoid coloured fringes.
  float radius = min(blur, 0.4) * 1.45;
  vec4 sum = centre * 0.75;
  float weight = 0.75;
  for (int i = 0; i < 24; i++) {
    float r2 = (float(i) + 0.5) / 24.0;
    float a = float(i) * 2.3999632;
    vec2 offset = radius * sqrt(r2) * vec2(cos(a), sin(a));
    float tap = exp(-2.0 * r2);
    sum += tap * orbCustomSample($u s + offset, level, clock);
    weight += tap;
  }
  return sum / weight;
  $END
  return centre;
}
`;
}
