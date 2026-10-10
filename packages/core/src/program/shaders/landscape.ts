// The landscape: hills round a winding lake under a wide sky, in 3D. Each point of the picture
// inside the glass casts a ray from an eye gliding down the lake; the ray is marched over a
// heightfield of hills, or meets the water and is mirrored, or carries on to the sky, its clouds
// and the far ranges, and the distance fades into the haze. Its clocks: m.x is how far the eye has
// glided, m.y how far the wind has carried the clouds.

export const LANDSCAPE_CONTENTS = /* glsl */ `
// The middle of the lake, across the way the eye goes: it winds.
float lakeX(float z) { return 1.7 * sin(z * 0.09) + 0.9 * sin(z * 0.21 + 1.3); }

// The land's height: under the water along the lake, rising into hills either side of it.
float landHeight($U vec2 p, int octaves) {
  float away = abs(p.x - lakeX(p.y));
  float side = smoothstep(0.7, 4.5, away);
  float hills = fbm(p * 0.16 + vec2(3.1, 1.7), octaves);
  return ((hills * 2.6 - 0.25) * side + side * side * 0.9 - 0.4 * (1.0 - side)) * $D(contents.land.height);
}

vec3 landNormal($U vec3 p, float t, int octaves) {
  float e = 0.01 + 0.003 * t;
  return normalize(vec3(
    landHeight($u p.xz - vec2(e, 0.0), octaves) - landHeight($u p.xz + vec2(e, 0.0), octaves),
    2.0 * e,
    landHeight($u p.xz - vec2(0.0, e), octaves) - landHeight($u p.xz + vec2(0.0, e), octaves)
  ));
}

// How far along rd the land is, or -1 if the ray gets past maxT or over every hill first.
float marchLand($U vec3 ro, vec3 rd, float maxT, int steps, int octaves) {
  float top = 3.3 * $D(contents.land.height) + 0.05;
  float t = 0.05;
  float lastT = t;
  float lastD = 1.0;
  for (int i = 0; i < 96; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    float d = p.y - landHeight($u p.xz, octaves);
    if (d < 0.003 * t) {
      // Between the last step above the land and this one below it, the edge is about here.
      return lastT + (t - lastT) * lastD / max(lastD - d, 0.0001);
    }
    if (t > maxT || (rd.y > 0.0 && p.y > top)) break;
    lastT = t;
    lastD = d;
    t += max(0.5 * d, 0.012 + 0.035 * t);
  }
  return -1.0;
}

vec3 sunDir($U) {
  float a = $D(contents.sun.azimuth) * 0.01745329;
  float e = $D(contents.sun.elevation) * 0.01745329;
  return vec3(sin(a) * cos(e), sin(e), -cos(a) * cos(e));
}

// The sky along rd: the gradient, the sun and its glow, the clouds, and the far ranges at the
// horizon, too far off to march.
vec3 landSky($U vec3 rd, vec3 sun, float level, vec4 m, float travel) {
  vec3 zenith = $C(contents.sky.zenith);
  vec3 horizon = $C(contents.sky.horizon);
  vec3 sunCol = $C(contents.sun.color);
  float y = max(rd.y, 0.0);
  vec3 col = mix(horizon, zenith, sat(1.0 - exp(-y * 3.5)));
  float toward = max(dot(rd, sun), 0.0);
  float glow = max(0.0, $D(contents.sun.glow) + $D(contents.react.sun) * level);
  col += sunCol * 0.3 * pow(toward, 6.0) * glow;

  float dens = 0.0;
  if (rd.y > 0.0) {
    // Fair-weather cumulus on a deck overhead, carried by the wind and passed under as the eye
    // glides: crisp edges, lit where thin and toward the sun, greyer in their cores.
    vec2 uv = rd.xz / (rd.y + 0.12) + vec2(m.y * 0.6, -travel * 0.05);
    float n = fbm(uv * 0.9, 5);
    float th = mix(0.74, 0.3, $D(contents.sky.clouds));
    dens = smoothstep(th, th + 0.12, n) * smoothstep(0.0, 0.15, rd.y);
    float core = smoothstep(th + 0.04, th + 0.32, n);
    vec3 lit = $C(contents.sky.cloudColor);
    vec3 cloud = mix(lit, mix(lit, mix(zenith, horizon, 0.35), 0.62), core);
    cloud += sunCol * pow(toward, 4.0) * (1.0 - core) * 0.4 * glow;
    col = mix(col, cloud, dens * 0.95);
  }
  // The sun, through thin cloud.
  col += sunCol * 0.6 * pow(toward, 80.0) * glow * (1.0 - 0.6 * dens);
  col = mix(col, min(sunCol * 1.2 + 0.25, vec3(1.0)), smoothstep(0.9993, 0.99962, toward) * (1.0 - 0.8 * dens));

  // Two ranges far off: the nearer darker, both hazed toward the horizon's colour.
  float around = $atan2(rd.x, 0.000001 - rd.z);
  float height = $D(contents.land.height);
  float far = 0.012 + 0.05 * height * fbm(vec2(around * 3.2 + 41.0, 1.3), 4);
  float near = 0.004 + 0.04 * height * fbm(vec2(around * 5.1 + 7.0, 5.7), 4);
  vec3 rock = $C(contents.land.rock);
  col = mix(mix(rock, horizon, 0.78), col, smoothstep(far - 0.002, far, rd.y));
  col = mix(mix(rock, horizon, 0.58), col, smoothstep(near - 0.002, near, rd.y));
  return col;
}

// The distance fading into the air, which is lit by the sun where it looks toward it.
vec3 hazeAt($U vec3 col, vec3 rd, float t, vec3 sun) {
  float f = 1.0 - exp(-t * 0.05 * $D(contents.haze));
  vec3 air = mix($C(contents.sky.horizon), $C(contents.sun.color), 0.4 * pow(max(dot(rd, sun), 0.0), 5.0));
  return mix(col, air, f);
}

vec3 landColor($U vec3 p, vec3 n, vec3 sun) {
  float height = max($D(contents.land.height), 0.001);
  float slope = 1.0 - n.y;
  float grain = vnoise(p.xz * 2.7) - 0.5;
  // Meadow with darker stands of trees, rock where it is steep, snow on the tops.
  vec3 grass = $C(contents.land.grass) * (0.92 + 0.3 * grain);
  vec3 trees = $C(contents.land.grass) * vec3(0.5, 0.62, 0.55);
  vec3 col = mix(grass, trees, smoothstep(0.48, 0.58, fbm(p.xz * 0.8 + 17.0, 3)));
  col = mix(col, $C(contents.land.rock), smoothstep(0.16, 0.42, slope + 0.15 * grain));
  // Wet and dark along the shore.
  col = mix(col * 0.55, col, smoothstep(0.0, 0.15, p.y));
  float snow = smoothstep(-0.06, 0.06, p.y / (3.0 * height) - $D(contents.land.snowline) + 0.15 * grain);
  col = mix(col, $C(contents.land.snow), snow * (1.0 - smoothstep(0.3, 0.55, slope)));
  // The sun, fading as it sets, and the sky's light from above.
  float day = smoothstep(-0.08, 0.1, sun.y);
  vec3 light = $C(contents.sun.color) * max(dot(n, sun), 0.0) * 1.5 * day;
  light += mix($C(contents.land.grass) * 0.6, $C(contents.sky.zenith), 0.5 + 0.5 * n.y) * 0.6;
  return col * light;
}

// What the eye sees along rd: the land, or the water mirroring the land and the sky, or the sky.
vec3 landView($U vec3 ro, vec3 rd, vec3 sun, float level, vec4 clock, vec4 m, float travel) {
  float tWater = rd.y < -0.00001 ? -ro.y / rd.y : 10000.0;
  float t = marchLand($u ro, rd, min(tWater, 45.0), 80, 4);
  if (t > 0.0) {
    vec3 p = ro + rd * t;
    return hazeAt($u landColor($u p, landNormal($u p, t, 6), sun), rd, t, sun);
  }
  if (tWater > 9000.0) return landSky($u rd, sun, level, m, travel);

  vec3 p = ro + rd * tWater;
  // Ripples, calmer with distance so the far water does not shimmer.
  float waves = ($D(contents.water.waves) + $D(contents.react.waves) * level) / (1.0 + 0.2 * tWater);
  float time = clock.x;
  vec2 g = vec2(cos(p.x * 2.3 + p.z * 0.7 + time * 1.4), cos(p.z * 3.1 - p.x * 0.4 + time * 1.1)) * 0.06
    + vec2(cos(p.x * 6.1 - p.z * 3.3 + time * 2.3), cos(p.z * 7.7 + p.x * 2.9 - time * 2.0)) * 0.03
    + vec2(cos(p.x * 17.3 + p.z * 9.1 - time * 3.1), cos(p.z * 19.7 - p.x * 7.3 + time * 2.7)) * 0.012;
  vec3 n = normalize(vec3(-g.x * waves, 1.0, -g.y * waves));
  vec3 r = reflect(rd, n);
  r.y = abs(r.y);
  // The hills mirrored in the lake, from a shorter march off the water.
  vec3 mirrored = landSky($u r, sun, level, m, travel);
  float tr = marchLand($u p + vec3(0.0, 0.003, 0.0), r, 30.0, 40, 3);
  if (tr > 0.0) {
    vec3 q = p + r * tr;
    mirrored = hazeAt($u landColor($u q, landNormal($u q, tr, 3), sun), r, tr, sun);
  }
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(-rd, n), 0.0), 5.0);
  vec3 deep = $C(contents.water.color) * (0.35 + 0.65 * smoothstep(-0.1, 0.3, sun.y));
  vec3 col = mix(deep, mirrored, sat(0.4 + fresnel));
  float glow = max(0.0, $D(contents.sun.glow) + $D(contents.react.sun) * level);
  // The sun glittering on the ripples.
  col += $C(contents.sun.color) * pow(max(dot(r, sun), 0.0), 900.0) * 5.0 * glow * smoothstep(-0.02, 0.04, sun.y);
  return hazeAt($u col, rd, tWater, sun);
}

vec4 orbContents($U vec2 s, vec2 face, float w, float k, float blur, float level, vec4 clock, vec4 m) {
  float travel = m.x;
  float z = -travel;
  vec3 ro = vec3(lakeX(z), $D(contents.altitude), z);
  // Look down the lake, which bends ahead, tipped a little toward the water.
  vec3 fw = normalize(vec3(0.5 * (lakeX(z - 6.0) - ro.x) / 6.0, -0.05, -1.0));
  vec3 rt = normalize(vec3(-fw.z, 0.0, fw.x));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw + (s.x * rt + s.y * up) * 0.72);
  vec3 col = landView($u ro, rd, sunDir($u), level, clock, m, travel);
  // Frosted glass hazes the view over.
  return vec4(mix(col, $C(contents.sky.horizon), sat(blur * 4.0)), 1.0);
}
`;
