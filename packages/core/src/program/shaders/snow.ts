// Snow surface optics. Fine branches erode first; meltwater uses the same lens/shading path
// as rain. Packed ice/compaction/motion channels retain continuous material transitions.
export const SNOW = /* glsl */ `
vec3 snowMaterial(float phase) {
  if (phase > 0.0) return vec3(1.0, 0.0, 0.0);
  float code = -phase - 1.0;
  float drive = floor(code / 262144.0);
  code -= drive * 262144.0;
  float compact = floor(code / 1024.0);
  return vec3((code - compact * 1024.0) / 1023.0, compact / 255.0, drive / 63.0);
}
float snowSegment(vec2 p, vec2 a, vec2 b) {
  vec2 d = b - a;
  return length(p - a - d * clamp(dot(p - a, d) / max(dot(d, d), 0.000001), 0.0, 1.0));
}
float snowCrystal(vec2 p, vec2 seed, float ice) {
  float family = hash2(seed + vec2(12.7, 31.9));
  float direction = floor(($atan2(p.y, p.x) + 0.5235988) / 1.04719755);
  vec2 q = rotate2(p, -direction * 1.04719755);
  q.y = abs(q.y);
  vec2 armSeed = seed + vec2(mod(direction + 6.0, 6.0) * 13.1, 7.3);
  float arm = (0.72 + 0.28 * hash2(armSeed)) * (0.28 + 0.72 * ice);
  float thickness = (0.012 + 0.025 * hash2(seed + vec2(8.1, 3.6))) * smoothstep(0.0, 0.3, ice);
  float d = snowSegment(q, vec2(0.0), vec2(arm, 0.0)) - thickness;
  for (int k = 0; k < 4; k++) {
    float at = (0.17 + 0.16 * float(k)) * arm;
    float side = (0.09 + 0.21 * hash2(seed + vec2(float(k) * 4.7 + 15.9, 10.2)))
      * (1.0 - float(k) * 0.13) * smoothstep(0.15 + float(k) * 0.06, 0.75, ice);
    side *= 0.72 + 0.28 * hash2(armSeed + vec2(float(k) * 6.7, 12.3));
    d = min(d, snowSegment(q, vec2(at, 0.0), vec2(at + side * 0.5, side * 0.8660254)) - thickness * 0.62);
    if (family >= 0.24 && family <= 0.88) {
      for (int twig = 0; twig < 2; twig++) {
        float along = 0.38 + float(twig) * 0.3;
        vec2 base = vec2(at, 0.0) + vec2(0.5, 0.8660254) * side * along;
        float fine = side * (0.2 + 0.12 * hash2(armSeed + vec2(float(k), float(twig))))
          * smoothstep(0.45, 0.95, ice);
        d = min(d, snowSegment(q, base, base + vec2(fine, 0.0)) - thickness * 0.32);
      }
    }
  }
  // Plates, dendrites and rimed crystals share hexagonal geometry but have different cores.
  float core = (family < 0.24 ? 0.48 : (family > 0.88 ? 0.33 : 0.14)) * pow(max(ice, 0.0), 0.3333333);
  float hex = max(q.x * 0.8660254 + q.y * 0.5, q.y) - core;
  if (family < 0.24) d = min(d, hex);
  else d = min(d, length(p) - core * (0.8 + 0.2 * vnoise(p * 12.0 + seed)));
  return d;
}

// A shared height and gradient join nearby wet caps. Keep signed height outside each footprint
// so the smooth union can round a contact neck without creating a flat wet rectangle.
void snowWater($U vec2 face, float px, float amount, inout vec4 liquid,
               inout float deepest, inout float shadow, inout float wipe) {
  if (amount <= 0.0) return;
  vec3 surface = vec3(-1000.0, 0.0, 0.0);
  float size = 0.0;
  vec2 gravity = vec2(sin($D(rain.direction) * 0.01745329), -cos($D(rain.direction) * 0.01745329));
  for (int i = 0; i < $MAX(snow); i++) {
    vec4 flake = uData[$S(snow) + i];
    bool hail = flake.z < 0.0;
    if (hail ? $D(weather.hail.enabled) < 0.5 : $D(snow.enabled) < 0.5) continue;
    if (flake.y <= 0.0 || flake.w > 0.0) continue;
    vec3 material = snowMaterial(flake.w);
    float radius = flake.y * 0.34 * pow(max(0.0, 1.0 - material.x), 0.3333333);
    if (radius < px * 0.1) continue;
    vec2 centre = pathPoint(flake.x);
    if (length(face - centre) > radius * 2.5 + px * 2.0) continue;
    vec3 field = dropField(face, vec3(centre, radius), vec3(gravity, material.z));
    if (material.x > 0.0 && !hail) {
      // Early meltwater fills the hollows between branches. Its angular pockets round out as
      // the ice support erodes. Transform the same analytic derivative into screen space.
      vec2 rel = face - centre;
      float radial = length(centre);
      vec2 axis = radial > 0.001 ? centre / radial : vec2(0.0, 1.0);
      float z = sqrt(max(0.025, 1.0 - dot(centre, centre)));
      vec2 tangent = rel + axis * dot(rel, axis) * (1.0 / z - 1.0);
      vec2 seed = vec2(mod(abs(flake.z), 4096.0), floor(abs(flake.z) / 4096.0));
      float turn = hash2(seed + vec2(7.3, 9.4)) * 6.2831853;
      float angle = 6.0 * ($atan2(tangent.y, tangent.x) + turn);
      float pocket = radius * 0.14 * material.x * (1.0 - 0.5 * material.y);
      field.x += pocket * cos(angle);
      vec2 slope = vec2(-tangent.y, tangent.x) / max(dot(tangent, tangent), 0.000001);
      slope += axis * dot(slope, axis) * (1.0 / z - 1.0);
      field.yz -= pocket * 6.0 * sin(angle) * slope;
    }
    float t = 1.0 + field.x / radius;
    vec3 cap = vec3(0.5 * radius * (1.0 - t * t), -field.yz * t);
    float soft = max(px * 0.08, min(radius, max(size, radius)) * 0.16);
    float h = sat(0.5 + 0.5 * (surface.x - cap.x) / soft);
    surface = vec3(mix(cap.x, surface.x, h) + soft * h * (1.0 - h), mix(cap.yz, surface.yz, h));
    size = mix(radius, size, h);
    shadow *= 1.0 - 0.08 * amount * cover(field.x + radius * 0.12, max(px, radius * 0.12));
  }
  if (size <= 0.0) return;
  float alpha = amount * cover(-surface.x, max(px * 0.35, px * length(surface.yz))) * sat(size / px);
  float radial = length(face);
  alpha *= 1.0 - smoothstep(0.97, 1.06, radial);
  vec2 q = -surface.yz;
  vec2 axis = radial > 0.001 ? face / radial : vec2(0.0, 1.0);
  q += axis * dot(q, axis) * (max(0.025, 1.0 - dot(face, face)) - 1.0);
  q *= 0.8;
  wipe = max(wipe, alpha);
  if (alpha > 0.0 && -surface.x < deepest) {
    liquid = vec4(face - q * size, size, alpha);
    deepest = -surface.x;
  }
}

vec4 snowOver($U vec4 c, vec2 face, float px, float level) {
  float amount = 1.0;
  if (amount <= 0.0) return c;
  vec3 incoming = lightDir($u);
  for (int i = 0; i < $MAX(snow); i++) {
    vec4 flake = uData[$S(snow) + i];
    bool hail = flake.z < 0.0;
    if (hail ? $D(weather.hail.enabled) < 0.5 : $D(snow.enabled) < 0.5) continue;
    float radius = flake.y;
    if (radius <= 0.0) continue;
    vec2 centre = pathPoint(flake.x);
    if (length(face - centre) > radius * 1.4 + px) continue;
    vec3 material = snowMaterial(flake.w);
    if (material.x <= 0.0) continue;
    vec2 seed = vec2(mod(abs(flake.z), 4096.0), floor(abs(flake.z) / 4096.0));
    float height = max(0.0, flake.w - 1.0);
    vec2 p = (face - centre) / radius;
    float radial = length(centre);
    vec2 axis = radial > 0.001 ? centre / radial : vec2(0.0, 1.0);
    float z = sqrt(max(0.04, 1.0 - dot(centre, centre)));
    p += axis * dot(p, axis) * (mix(1.0 / z, 1.0, sat(height * 5.0)) - 1.0);
    float turn = hash2(seed + vec2(7.3, 9.4)) * 6.2831853 + height * (2.0 + hash2(seed) * 4.0);
    p = rotate2(p, turn);
    // An incoming plate tumbles out of plane and settles flat against the local glass.
    p.x /= mix(1.0, max(0.25, abs(cos(height * (8.0 + 4.0 * hash2(seed)) + turn))), sat(height * 5.0));
    // Compaction integrates dM/M. Undo its bulk radius growth for the original crystal,
    // which stays the same size while deposited material fills the porous space around it.
    float crystalScale = exp(-material.y);
    float crystal = hail ? length(p) - pow(material.x,0.3333333) * (0.88+0.08*vnoise(p*7.0+seed)) : snowCrystal(p / crystalScale, seed, material.x) * crystalScale;
    float mound = length(p) - (0.95 + 0.11 * (vnoise(p * 5.0 + seed) - 0.5)) * pow(material.x, 0.3333333);
    // Packing gradually buries individual branches into a granular deposit, retaining both
    // surfaces through the transition rather than exchanging a flake sprite for a blob.
    float alpha = mix(cover(crystal, px / radius), cover(mound, px / radius), material.y);
    alpha *= amount * smoothstep(0.0, 0.03, material.x) * (1.0 - smoothstep(0.98, 1.08, length(face)));
    alpha *= 1.0 - 0.32 * sat(height * 2.0);
    float grain = vnoise(p * 36.0 + seed) * (1.0 - smoothstep(0.03, 0.2, px / radius));
    vec3 normal = normalize(vec3(centre, z) + vec3(rotate2(vec2(0.1, 0.03), turn), 0.0));
    float illumination = 0.78 + 0.22 * max(0.0, dot(normal, incoming));
    // Thin ice transmits the view; edges, growth ridges and packed grains scatter more light.
    float edge = 1.0 - smoothstep(0.008, 0.045, max(0.0, -crystal));
    float a = $atan2(p.y, p.x);
    float folded = mod(a + 0.5235988, 1.04719755) - 0.5235988;
    vec2 q = vec2(length(p) * cos(folded), abs(length(p) * sin(folded)));
    float hex = max(q.x * 0.8660254 + q.y * 0.5, q.y);
    float ridges = exp(-abs(sin(hex * (36.0 + 20.0 * hash2(seed + vec2(9.2, 6.7))))) * 18.0)
      * (1.0 - smoothstep(0.35, 0.65, length(p))) * material.x;
    float scattering = hail ? 0.4 + 0.28*grain + 0.15*max(0.0,1.0-length(p)) : mix(0.42 + 0.48 * edge + 0.1 * ridges, 0.96, material.y);
    vec3 ice = (hail ? $C(weather.hail.color) : $C(snow.color)) * illumination * (0.94 + grain * 0.06);
    c = over(c, vec3(0.17, 0.22, 0.29), alpha * 0.1);
    c = over(c, ice, alpha * scattering);
  }
  return c;
}
`;
