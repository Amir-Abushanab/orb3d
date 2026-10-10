// The glass: everything in the shader that is the same whatever the orb holds. HELPERS go first,
// before the contents' own code; GLASS goes after it, and draws the orb round `orbContents`.
//
// What a contents module defines (see the files beside this one):
//
//   vec4 orbContents($U vec2 s, vec2 face, float w, float k, float blur, float level, vec4 clock,
//                    vec4 m)
//
// the contents at `s`, a point of the picture inside the glass (the unit disc, y up), premultiplied.
// `face` is where it shows on the orb, `w` the anti-aliasing width at `s` and `k` scene units per
// face unit there (the glass magnifies the middle and crowds the rim), `blur` the frosting at `s`,
// `clock` the glass's clocks (time, rain, the room's turn) and `m` the contents' four clocks.
//
// It may also define `dropView`, what a drop on the glass shows; otherwise DEFAULT_DROP does.
import { SNOW } from "./snow";

export const HELPERS = /* glsl */ `
float sat(float x) { return clamp(x, 0.0, 1.0); }

// Coverage of a shape whose signed distance is d, softened over w either side of its edge.
float cover(float d, float w) { return 1.0 - smoothstep(-w, w, d); }

// v folded into [lo, hi), for things that drift off one side and come back on the other.
float wrapf(float v, float lo, float hi) {
  float span = hi - lo;
  return v - span * floor((v - lo) / span);
}

float boxSdf(vec2 p, vec2 extent) {
  vec2 q = abs(p) - extent;
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0);
}

float hash(float n) { return fract(sin(n) * 43758.5453); }

// A hash of a point without sin, which stays steady on mobile GPUs.
float hash2(vec2 p) {
  vec3 q = fract(vec3(p.x, p.y, p.x) * 0.1031);
  q += dot(q, vec3(q.y, q.z, q.x) + 33.33);
  return fract((q.x + q.y) * q.z);
}

// Smooth value noise, 0 to 1.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash2(i);
  float b = hash2(i + vec2(1.0, 0.0));
  float c = hash2(i + vec2(0.0, 1.0));
  float d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Value noise summed over octaves, each twice as fine and turned. octaves is at most 7.
float fbm(vec2 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 7; i++) {
    if (i >= octaves) break;
    sum += amp * vnoise(p);
    p = vec2(1.6 * p.x - 1.2 * p.y, 1.2 * p.x + 1.6 * p.y);
    amp *= 0.5;
  }
  return sum;
}

vec2 rotate2(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

// Premultiplied c with x laid over it at opacity a.
vec4 over(vec4 c, vec3 x, float a) { return vec4(mix(c.rgb, x, a), mix(c.a, 1.0, a)); }

// Where a scene point d from the centre lands on the face (see lens.ts).
float bendRadius(float d, float bend) {
  float bent = d <= 1.0 ? sin(d * 1.5707963) : 1.0 + (d - 1.0) * 0.08;
  return (1.0 - bend) * d + bend * bent;
}

// The glass, inverted: the scene point that shows at this point of the face, and how much the
// glass magnifies there (scene units per face unit is its reciprocal).
vec3 unbend(vec2 face, float bend) {
  if (bend <= 0.00001) return vec3(face, 1.0);
  float rho = length(face);
  float d = min(rho, 1.0);
  for (int i = 0; i < 5; i++) {
    float f = (1.0 - bend) * d + bend * sin(d * 1.5707963) - rho;
    float df = (1.0 - bend) + bend * 1.5707963 * cos(d * 1.5707963);
    d = clamp(d - f / max(df, 0.001), 0.0, 1.0);
  }
  float gain = max((1.0 - bend) + bend * 1.5707963 * cos(d * 1.5707963), 0.001);
  vec2 s = rho > 0.00001 ? face * (d / rho) : face / ((1.0 - bend) + bend * 1.5707963);
  return vec3(s, gain);
}

// Where the light is: the direction the view reflects to off the glass at the light's highlight.
vec3 lightDir($U) {
  vec2 at = vec2($D(light.x), $D(light.y));
  float radius = length(at);
  vec2 direction = radius > 0.00001 ? at / radius : vec2(0.0, 1.0);
  // Extend the source beyond the glass without a zero half-vector at the rim. The elevation
  // offset changes incidence independently of the source's visible glare position.
  float r = min(radius, 0.999);
  float z = sqrt(1.0 - r * r);
  vec3 natural = vec3(2.0 * z * r * direction, 1.0 - 2.0 * r * r);
  if (abs($D(light.elevation)) < 0.00001) return natural;
  float elevation = clamp(asin(clamp(natural.z, -1.0, 1.0)) + $D(light.elevation) * 0.01745329,
    -1.526326, 1.5707963);
  return normalize(vec3(direction * cos(elevation), sin(elevation)));
}

// The light's specular point on the sphere, distinct from its source position outside the orb.
vec2 lightSpot($U) {
  return normalize(lightDir($u) + vec3(0.0, 0.0, 1.0)).xy;
}

// How bright the light's softbox is along d, 0 to 1, softened by blur.
float softbox($U vec3 d, float blur) {
  float size = 0.16 * $D(light.size) + blur;
  float a = acos(clamp(dot(d, lightDir($u)), -1.0, 1.0));
  return 1.0 - smoothstep(size * 0.55, size, a);
}

// The room round the orb, by direction (y up, z toward the viewer): a sweep of wall over a floor,
// with tall softboxes round it, which show the room turning as it turns. The eye looks a little
// down on the orb, so behind it is floor and the horizon curves through the glass. spin turns the
// room (radians) and blur softens it.
vec3 room($U vec3 d, float blur, float spin) {
  vec3 t = vec3(d.x, d.y * 0.9689 + d.z * 0.2474, d.z * 0.9689 - d.y * 0.2474);
  vec2 xz = rotate2(vec2(t.x, t.z), spin);
  vec3 q = vec3(xz.x, t.y, xz.y);
  vec3 col = mix($C(environment.horizon), $C(environment.sky), smoothstep(0.0, 0.75 + blur, q.y));
  col = mix(col, $C(environment.ground), smoothstep(-0.015 - blur, 0.45 + blur, -q.y));
  col *= 1.0 - 0.3 * smoothstep(0.45, 1.0, -q.y);
  float around = $atan2(q.x, 0.000001 - q.z);
  float cell = abs(around - 2.0943951 * floor(around / 2.0943951 + 0.5));
  float panel = (1.0 - smoothstep(0.26, 0.32 + blur, cell))
    * smoothstep(0.04, 0.09 + blur, q.y) * (1.0 - smoothstep(0.5, 0.56 + blur, q.y));
  return mix(col, mix($C(environment.sky), vec3(1.0), 0.85), panel);
}

// Which way a ray along -z leaves a solid ball of glass through this point of its face: bent in
// at the front and out at the back, so what is behind the ball shows upside down.
vec3 throughBall(vec2 face, float ior) {
  vec3 p = vec3(face, sqrt(max(0.0, 1.0 - dot(face, face))));
  vec3 d = refract(vec3(0.0, 0.0, -1.0), p, 1.0 / ior);
  vec3 q = p - 2.0 * dot(p, d) * d;
  vec3 o = refract(d, -q, ior);
  return dot(o, o) > 0.5 ? o : reflect(d, -q);
}
`;

/** What a drop on the glass shows when the contents do not say: what is behind it, upside down. */
export const DEFAULT_DROP = /* glsl */ `
// Where a drop looks: a bead of water is a lens, gathering a wide patch of the view behind it,
// upside down. drop is its centre and radius; q is this point in the drop, -1 to 1.
vec2 dropLook($U vec3 drop, vec2 q) {
  return drop.xy - q * $D(weather.water.lens);
}

// The drop's colour, from the glass under it (col) and what its lens gathers (seen).
vec3 dropView($U vec3 col, vec3 seen, vec3 drop, vec2 q) {
  return mix(col, seen, 0.8);
}
`;

/** The inside of the glass: after the contents and their drops. */
export const INSIDE = /* glsl */ `
// What shows through the glass at a point of the face: the contents, bent by the glass, over the
// room seen through the ball. scale bends one channel a little more or less, for dispersion; blur
// is the frosting on the face.
vec3 insideAt($U vec2 face, float px, float level, vec4 clock, vec4 m, float scale, float blur) {
  vec3 un = unbend(face, $D(glass.bend) * scale);
  vec4 c = orbContents($u un.xy, face, 0.75 * px / un.z, 1.0 / un.z, blur / un.z, level, clock, m);
  c = weatherSky($u c, un.xy, px, clock);
  if (c.a >= 0.999) return c.rgb;
  vec3 behind = throughBall(face, 1.0 + ($D(glass.ior) - 1.0) * scale);
  return c.rgb + room($u behind, blur, clock.z * 0.01745329) * (1.0 - c.a);
}
`;

export const GLASS = /* glsl */ `
// Rain on the inside of the glass. Drops sit where they landed. Running drops stick and slip down
// it, leaving a streak of water that beads up behind them, and a path clear of fog and mist.
// Every drop casts a shadow; the water a point sits in (drops rarely overlap, so one is enough) is
// a lens.

// A drop as the glass shows it: smaller toward the rim, where the glass curves away, and fading
// there, so one running off the bottom and back on at the top never pops. Centre, radius, alpha.
vec4 shownDrop(vec2 at, float size, float alpha) {
  float a = alpha * (1.0 - smoothstep(0.86, 0.99, length(at)));
  return vec4(at, size * sqrt(max(0.25, 1.0 - dot(at, at))), a);
}

// Water joins only at contact, matching the simulation. A small smoothing zone rounds the neck
// while the smaller drop retracts into the larger one.

// Keep the two drops face sits deepest in, by how deep (k, |q|): hit and next, how deep each in
// near. The first counts out to where merging or its edge's anti-aliasing reaches, the second out
// to where merging does.
void consider(vec4 d, float k, float reach, inout vec4 hit, inout vec4 next, inout vec2 near) {
  if (k < near.x && k < reach) {
    next = hit;
    near.y = near.x;
    hit = d;
    near.x = k;
  } else if (k < near.y && k < 1.03) {
    next = d;
    near.y = k;
  }
}

// The water face is in, from the two drops it sits deepest in (see consider): as a drop, with its
// alpha the share of face it covers. Where two touch, they are one: each a dome of water, the two
// joined by a smooth maximum, so they fill in where they meet, and the slope turns from the one to
// the other.
vec4 water(vec2 face, float px, vec4 a, vec4 b, vec2 near) {
  if (a.w <= 0.0) return vec4(0.0);
  float ra = abs(a.z);
  vec2 qa = (face - a.xy) / ra;
  if (near.y >= 1.03 || b.w <= 0.0) return vec4(a.xyz, a.w * cover((length(qa) - 1.0) * ra, px));
  float rb = abs(b.z);
  vec2 qb = (face - b.xy) / rb;
  float ea = 0.5 * ra * (1.0 - dot(qa, qa));
  float eb = 0.5 * rb * (1.0 - dot(qb, qb));
  float soft = 0.05 * min(ra, rb);
  float l = sat(0.5 + 0.5 * (ea - eb) / soft);
  float e = mix(eb, ea, l) + soft * l * (1.0 - l);
  vec2 q = mix(qb, qa, l);
  float s = mix(rb, ra, l);
  float k = sqrt(max(0.0, 1.0 - 2.0 * e / s));
  float film = l < 0.5 ? b.z : a.z;
  return vec4(face - q * s, film < 0.0 ? -s : s, mix(b.w, a.w, l) * cover((k - 1.0) * s, px));
}

// Surface discs share their geometry with the simulation's contact test.
vec2 pathPoint(float code) {
  float a = floor(code / 4096.0);
  return vec2(a, code - a * 4096.0) / 4095.0 * 2.4 - 1.2;
}
// Each lobe has 12 bits of direction and 12 of deformation, with no coarse shape steps.
vec3 dropShape(float code) {
  float drive = floor(code / 4096.0) / 4095.0;
  if (drive <= 0.0) return vec3(0.0, -1.0, 0.0);
  float angle = (code - floor(code / 4096.0) * 4096.0) / 4095.0 * 6.28318530718 - 3.14159265359;
  return vec3(cos(angle), sin(angle), drive);
}

// A moving footprint stretches with velocity and narrows toward its trailing contact line.
// The analytic derivative includes that taper, so the outline and optical slope stay consistent.
vec3 dropField(vec2 face, vec3 d, vec3 shape) {
  vec2 rel = face - d.xy;
  float radial = length(d.xy);
  vec2 axis = radial > 0.001 ? d.xy / radial : vec2(0.0, 1.0);
  float z = sqrt(max(0.025, 1.0 - dot(d.xy, d.xy)));
  vec2 tangent = rel + axis * dot(rel, axis) * (1.0 / z - 1.0);
  vec2 direction = shape.xy + axis * dot(shape.xy, axis) * (1.0 / z - 1.0);
  direction /= max(length(direction), 0.00001);
  vec2 side = vec2(-direction.y, direction.x);
  float along = dot(tangent, direction);
  float across = dot(tangent, side);
  float stretch = 1.0 + 0.32 * shape.z;
  float shifted = along + 0.06 * shape.z * d.z;
  float u = shifted / (d.z * stretch);
  float taper = 1.0 + 0.14 * shape.z * clamp(u, -1.0, 1.0);
  float taperSlope = abs(u) < 1.0 ? 0.14 * shape.z / (d.z * stretch) : 0.0;
  float qa = shifted / stretch;
  float qb = across * sqrt(stretch) / taper;
  float len = sqrt(qa * qa + qb * qb);
  float ga = (qa / stretch - qb * across * sqrt(stretch) * taperSlope / (taper * taper)) / max(len, 0.00001);
  float gb = qb * sqrt(stretch) / taper / max(len, 0.00001);
  vec2 grad = direction * ga + side * gb;
  grad += axis * dot(grad, axis) * (1.0 / z - 1.0);
  return vec3(len - d.z, grad);
}

// Contact tension reshapes a lobe toward the neck while its far contact line briefly stays
// on the glass. This tangent-plane warp preserves area, including the original moving shape.
// Transform its analytic gradient with the same warp so the entire optical surface responds.
vec3 contactField(vec2 face, vec3 d, vec3 shape, vec2 toward, float tension) {
  if (tension <= 0.0) return dropField(face, d, shape);
  float radial = length(d.xy);
  vec2 axis = radial > 0.001 ? d.xy / radial : vec2(0.0, 1.0);
  float z = sqrt(max(0.025, 1.0 - dot(d.xy, d.xy)));
  vec2 direction = toward + axis * dot(toward, axis) * (1.0 / z - 1.0);
  direction /= max(length(direction), 0.00001);
  vec2 side = vec2(-direction.y, direction.x);
  vec2 point = face - d.xy;
  point += axis * dot(point, axis) * (1.0 / z - 1.0);
  float stretch = 1.0 + 0.28 * tension;
  float offset = (stretch - 1.0) * d.z;
  vec2 mapped = direction * ((dot(point, direction) - offset) / stretch)
    + side * dot(point, side) * stretch;
  mapped += axis * dot(mapped, axis) * (z - 1.0);
  vec3 field = dropField(d.xy + mapped, d, shape);
  vec2 grad = field.yz;
  grad += axis * dot(grad, axis) * (z - 1.0);
  grad = direction * (dot(grad, direction) / stretch) + side * dot(grad, side) * stretch;
  grad += axis * dot(grad, axis) * (1.0 / z - 1.0);
  return vec3(field.x, grad);
}

// Height and gradient of the water cap above its footprint. Combining footprint distances
// alone leaves the small lobe's steep optical slope intact, even after it is inside the head.
// Combine these heights instead, so the advancing surface covers and relaxes that little bump.
vec3 dropCap(vec3 field, float radius) {
  float k = max(0.0, 1.0 + field.x / radius);
  return vec3(0.5 * radius * (1.0 - k * k), -field.yz * k);
}

// A contacting pair has one water height and one optical normal. The smooth maximum rounds
// its meniscus, and its derivative supplies the slope across both lobes and the connection.
void sphereWater(vec2 face, float px, vec4 a, vec4 b, float neck, vec2 codes,
                 inout vec4 liquid, inout float deepest, inout float shadow) {
  if (a.z <= 0.0 || a.w <= 0.0) return;
  vec2 reach = vec2(2.25 * a.z + neck + px);
  vec2 lo = a.xy - reach;
  vec2 hi = a.xy + reach;
  if (b.z > 0.0) {
    lo = min(lo, b.xy - vec2(2.25 * b.z + neck + px));
    hi = max(hi, b.xy + vec2(2.25 * b.z + neck + px));
  }
  // Include the small exterior shadow without evaluating distant footprints.
  if (face.x < lo.x - a.z || face.y < lo.y - a.z || face.x > hi.x + a.z || face.y > hi.y + a.z) return;
  vec3 shapeA = dropShape(codes.x);
  vec3 shapeB = dropShape(codes.y);
  vec3 field = dropField(face, a.xyz, shapeA);
  vec3 surface = dropCap(field, a.z);
  // Shadows follow the real footprint, rather than the virtual refraction centre. That centre
  // changes at every fragment and used to extend the shadow into a hard column below the water.
  float shadowDistance = dropField(face + vec2(0.0, 0.22 * a.z), a.xyz, shapeA).x;
  float shadowSize = a.z;
  float size = a.z;
  float alpha = a.w;
  if (b.z > 0.0) {
    vec2 toward = b.xy - a.xy;
    toward = length(toward) > 0.00001 ? toward / length(toward) : vec2(0.0, -1.0);
    float atContact = dropField(b.xy, a.xyz, shapeA).x;
    // Catch on the first visible touch, before volume begins draining. Let that strain relax
    // as the small lobe is enveloped; the smaller body supplies most of the shape response.
    float touching = 1.0 - smoothstep(0.0, 2.0 * px, atContact - b.z);
    float uncovered = smoothstep(-b.z, 0.0, atContact);
    float strain = (0.22 + 0.78 * smoothstep(0.08, 0.5, neck / b.z)) * touching * uncovered;
    float share = b.z * b.z / (a.z * a.z + b.z * b.z);
    float tensionA = strain * share;
    float tensionB = strain * (1.0 - share);
    field = contactField(face, a.xyz, shapeA, toward, tensionA);
    surface = dropCap(field, a.z);
    shadowDistance = contactField(face + vec2(0.0, 0.22 * a.z), a.xyz, shapeA, toward, tensionA).x;
    vec3 other = dropCap(contactField(face, b.xyz, shapeB, -toward, tensionB), b.z);
    float otherShadow = contactField(face + vec2(0.0, 0.22 * b.z), b.xyz, shapeB, -toward, tensionB).x;
    if (otherShadow < shadowDistance) { shadowDistance = otherShadow; shadowSize = b.z; }
    float soft = max(min(neck, b.z) * uncovered, 0.000001);
    float h = sat(0.5 + 0.5 * (surface.x - other.x) / soft);
    surface = vec3(mix(other.x, surface.x, h) + soft * h * (1.0 - h), mix(other.yz, surface.yz, h));
    size = mix(b.z, a.z, h);
    alpha = max(a.w, b.w);
    // A connection spans exposed water; it must not leave its own rounded endpoint at the
    // donor's old centre after the head has covered it. Limit it to the remaining lobe and
    // relax it away as that contact point is enveloped by the advancing footprint.
    float gap = contactField(b.xy, a.xyz, shapeA, toward, tensionA).x - b.z * (1.0 + 0.56 * tensionB);
    float exposed = smoothstep(-b.z, 0.0, gap);
    float bridgeRadius = min(neck, b.z) * exposed;
    if (bridgeRadius > 0.000001) {
      vec2 segment = b.xy - a.xy;
      float u = clamp(dot(face - a.xy, segment) / max(dot(segment, segment), 0.000001), 0.0, 1.0);
      vec3 bridge = dropField(face, vec3(a.xy + segment * u, bridgeRadius), vec3(0.0, -1.0, 0.0));
      if (u > 0.0 && u < 1.0) bridge.yz -= segment * dot(bridge.yz, segment) / max(dot(segment, segment), 0.000001);
      bridge = dropCap(bridge, bridgeRadius);
      float rounding = max(0.5 * bridgeRadius, 0.000001);
      float join = sat(0.5 + 0.5 * (surface.x - bridge.x) / rounding);
      surface = vec3(mix(bridge.x, surface.x, join) + rounding * join * (1.0 - join), mix(bridge.yz, surface.yz, join));
      size = mix(bridgeRadius, size, join);
    }
  }
  float radial = length(face);
  alpha *= 1.0 - smoothstep(0.97, 1.08, radial);
  float distance = b.z > 0.0 ? -surface.x : field.x;
  float edge = max(px, px * length(b.z > 0.0 ? surface.yz : field.yz));
  alpha *= sat(size / px);
  float coverage = alpha * cover(distance, edge);
  // One height gradient supplies every optical cue. A small lobe that the advancing cap has
  // enveloped no longer contributes a separate spherical highlight or a steep little rim.
  vec2 q = -surface.yz;
  // Project the tangent normal into the view. Screen-space distance derivatives grow toward
  // the rim; feeding them straight into refraction made the water look like a rigid sharp edge.
  vec2 axis = radial > 0.001 ? face / radial : vec2(0.0, 1.0);
  q += axis * dot(q, axis) * (max(0.025, 1.0 - dot(face, face)) - 1.0);
  q *= 0.8;
  vec4 lens = vec4(face - q * size, size, alpha);
  shadow *= 1.0 - 0.08 * alpha * cover(shadowDistance, max(px, 0.18 * shadowSize));
  float depth = -surface.x;
  if (coverage > 0.0 && depth < deepest) {
    liquid = vec4(lens.xyz, coverage);
    deepest = depth;
  }
}

// Each wiped point keeps its scene time. Completed chunks remain until the fog has returned;
// movement at the head cannot refresh the old tail or evict it while it is still clear.
void rainTrail(vec2 face, float px, float now, vec4 p0, vec4 p1, vec4 p2,
               vec4 t0, vec4 t1, vec4 t2, vec4 meta, float alpha,
               inout vec4 hit, inout vec4 next, inout vec2 near, inout float wipe) {
  float r = meta.x;
  if (r <= 0.0 || alpha <= 0.0) return;
  vec2 pts[12];
  pts[0] = pathPoint(p0.x); pts[1] = pathPoint(p0.y); pts[2] = pathPoint(p0.z); pts[3] = pathPoint(p0.w);
  pts[4] = pathPoint(p1.x); pts[5] = pathPoint(p1.y); pts[6] = pathPoint(p1.z); pts[7] = pathPoint(p1.w);
  pts[8] = pathPoint(p2.x); pts[9] = pathPoint(p2.y); pts[10] = pathPoint(p2.z); pts[11] = pathPoint(p2.w);
  float times[12];
  times[0] = t0.x; times[1] = t0.y; times[2] = t0.z; times[3] = t0.w;
  times[4] = t1.x; times[5] = t1.y; times[6] = t1.z; times[7] = t1.w;
  times[8] = t2.x; times[9] = t2.y; times[10] = t2.z; times[11] = t2.w;
  float z = sqrt(max(0.04, 1.0 - dot(face, face)));
  float humidity = 6.0 + 2.0 * vnoise(face * 9.0);
  float closest = 1000.0;
  vec2 delta = vec2(0.0);
  vec2 tangent = vec2(0.0, -1.0);
  float deposited = 0.0;
  for (int k = 0; k < 11; k++) {
    if (float(k + 1) >= meta.z) break;
    vec2 seg = pts[k + 1] - pts[k];
    float len2 = dot(seg, seg);
    if (len2 < 0.000001) continue;
    float h = clamp(dot(face - pts[k], seg) / len2, 0.0, 1.0);
    vec2 d = face - pts[k] - seg * h;
    float distance = length(d);
    if (distance > r + px) continue;
    float age = max(0.0, now - mix(times[k], times[k + 1], h));
    float wet = 1.0 - smoothstep(0.35, humidity, age);
    float clearing = r * z * (0.72 + 0.13 * vnoise(face * 42.0)) * mix(0.45, 1.0, wet);
    wipe = max(wipe, alpha * wet * cover(distance - clearing, max(px, 0.08 * r)));
    // Choose the nearest centreline before ageing or shading it. Picking the freshest capsule
    // made every saved anchor produce a round lens endpoint and a regularly spaced optical rib.
    if (distance < closest) {
      closest = distance;
      delta = d;
      deposited = age;
      vec2 direction = seg / sqrt(len2);
      vec2 before = k > 0 ? pts[k] - pts[k - 1] : seg;
      vec2 after = float(k + 2) < meta.z ? pts[k + 2] - pts[k + 1] : seg;
      before /= max(length(before), 0.0001);
      after /= max(length(after), 0.0001);
      // Shared tangents round small bends without drawing a separate cap at every path sample.
      vec2 joined = mix(direction + before, direction + after, smoothstep(0.0, 1.0, h));
      tangent = length(joined) > 0.001 ? normalize(joined) : direction;
    }
  }
  if (closest < r + px) {
    vec2 centre = face - delta;
    // Deposited water pinches and spreads over fixed glass patches. The variation stays on the
    // glass as the head moves; a shallow transverse slope reads as film rather than a bead tube.
    float width = r * z * (0.08 + 0.12 * vnoise(centre * vec2(23.0, 17.0) + vec2(4.7, 9.2)));
    float fresh = 1.0 - smoothstep(0.15, 2.5, deposited);
    float film = alpha * fresh * cover(closest - width, px) * 0.5;
    if (film > 0.0) {
      vec2 across = vec2(-tangent.y, tangent.x);
      vec2 q = across * (dot(delta, across) / max(width, 0.0001)) * 0.3;
      consider(vec4(face - q * width, -width, film), closest / width, max(1.03, 1.0 + px / width), hit, next, near);
    }
  }
}

${SNOW}

// The rain at face, before what is behind the glass is drawn. Returns the water face is in, as a
// lens: centre, radius (negative for a streak's film, which catches no glint), and the share of
// face it covers, where the centre is set so that (face - centre) / |radius| is the slope of the
// water at face (for a round drop, just where face is in it). In marks: how clear the running
// drops' paths leave the fog (x) and the mist (y), the light the shadows leave (z), and the light
// the clearer paths the mark draws above its running drops leave (w).
vec4 rainScan($U vec2 face, float px, vec4 clock, inout vec4 marks) {
  float amount = $D(rain.amount);
  vec4 hit = vec4(0.0);
  marks = vec4(0.0, 0.0, 1.0, 1.0);
  vec4 next = vec4(0.0);
  vec2 near = vec2(1000.0);
  float shadow = 1.0;
  float wipe = 0.0;
  vec4 counts = uData[$S(counts)];
  $IF(water)
  for (int i = 0; i < $MAX(trails); i++) {
    vec4 meta = uData[$S(trails) + i * $MAX(trailSlots) + 6];
    if (meta.x <= 0.0 || meta.z < 2.0) continue;
    vec4 box = uData[$S(trails) + i * $MAX(trailSlots) + 7];
    float reach = meta.x + px;
    if (face.x < box.x - reach || face.y < box.y - reach || face.x > box.z + reach || face.y > box.w + reach) continue;
    float alpha = meta.y == -3.0 ? $D(weather.hail.enabled) : meta.y == -2.0 ? $D(weather.snow.enabled) : $D(weather.rain.enabled);
    rainTrail(face, px, clock.x,
      uData[$S(trails) + i * $MAX(trailSlots)],
      uData[$S(trails) + i * $MAX(trailSlots) + 1],
      uData[$S(trails) + i * $MAX(trailSlots) + 2],
      uData[$S(trails) + i * $MAX(trailSlots) + 3],
      uData[$S(trails) + i * $MAX(trailSlots) + 4],
      uData[$S(trails) + i * $MAX(trailSlots) + 5],
      meta, alpha, hit, next, near, wipe);
  }
  $END
  vec4 liquid = vec4(0.0);
  float deepest = 1000.0;
  $IF(rainDrops)
  for (int i = 0; i < $MAX(pool); i++) {
    vec4 pool = uData[$S(pool) + i * 2];
    if (pool.y <= 0.0 || pool.z < 0.0) continue;
    float alpha = i < $MAX(drops) ? sat(amount * counts.x - float(i)) : 1.0;
    vec4 other = vec4(0.0);
    vec4 cached = uData[$S(pool) + i * 2 + 1];
    if (cached.y > 0.0) {
      vec4 pair = cached;
      float partnerAlpha = pair.z < 0.0 ? 1.0 : sat(amount * counts.x - pair.z);
      other = vec4(pathPoint(pair.x), pair.y, partnerAlpha);
    }
    vec2 shapes = vec2(abs(pool.z) - 1.0, cached.w);
    sphereWater(face, px, vec4(pathPoint(pool.x), pool.y, alpha), other, pool.w, shapes,
                liquid, deepest, shadow);
  }
  $END
  $IF(frozenFlakes)
  snowWater($u face, px, 1.0, liquid, deepest, shadow, wipe);
  $END
  marks = vec4(wipe, wipe, shadow, 1.0);
  return liquid.w > 0.0 ? liquid : water(face, px, hit, next, near);
}

// A bead of mist (x, y, radius) over c, a how much of it shows.
vec4 mistBead(vec4 c, vec3 bead, float a, vec2 face, float px, vec3 shade) {
  float d = length(face - bead.xy);
  if (a <= 0.0 || d > bead.z + px) return c;
  // Lit up and to the left, shaded at the far edge.
  float g = length(face - bead.xy - vec2(-0.2, 0.3) * bead.z) / bead.z;
  vec3 tint = vec3(1.0);
  float tintA = 0.0;
  if (g < 0.55) {
    float t = g / 0.55;
    tint = mix(vec3(1.0), vec3(1.0, 0.824, 0.69), t);
    tintA = mix(0.9, 0.3, t);
  } else {
    float t = sat((g - 0.55) / 0.45);
    tint = mix(vec3(1.0, 0.824, 0.69), min(shade * 2.0, vec3(1.0)), t);
    tintA = mix(0.3, 0.25, t);
  }
  return over(c, tint, tintA * a * cover(d - bead.z, px));
}

// The rain over the glass, from rainScan: the clearer paths the mark draws, every drop's shadow,
// the water this point is in (hit, its alpha how much of the point it covers) with seen what its
// lens gathers, and the mist of beads, gone where a drop has run through it.
vec4 rain($U vec4 c, vec2 face, float px, vec4 hit, vec3 seen, vec4 marks) {
  float mist = 0.0;
  $IF(mist) mist = $D(rain.mist); $END
  if (hit.w <= 0.0 && mist <= 0.0 && marks.z >= 1.0 && marks.w >= 1.0) return c;
  vec3 shade = $C(weather.water.shade);
  c = over(c, vec3(1.0), 1.0 - marks.w);
  c = over(c, shade, 1.0 - marks.z);

  if (hit.w > 0.0) {
    float size = abs(hit.z);
    vec2 q = (face - hit.xy) / size;
    float kq = length(q);
    vec3 drop = dropView($u c.rgb, seen, vec3(hit.xy, size), q);
    drop = mix(drop, shade, 0.2 * smoothstep(0.45, 1.1, kq));
    if (hit.z > 0.0) {
      // A glint up and to the left, and the light the drop gathers onto its lower edge.
      vec2 gleam = q - vec2(-0.3, 0.35);
      drop = mix(drop, vec3(1.0), 0.55 * exp(-dot(gleam, gleam) * 28.0));
      vec2 r = (q - vec2(0.28, -0.5)) / vec2(0.3, 0.12);
      drop = mix(drop, vec3(1.0), 0.2 * exp(-dot(r, r)));
    }
    c = over(c, drop, hit.w);
  }

  $IF(mist)
  vec4 counts = uData[$S(counts)];
  float beads = counts.y;
  float left = 1.0 - marks.y;
  // The beads are packed four to three slots, and laid down in order.
  for (int q = 0; q < $MAX(beads) / 4; q++) {
    float i = float(q * 4);
    if (i >= beads) break;
    vec4 a = uData[$S(beads) + 3 * q];
    vec4 b = uData[$S(beads) + 3 * q + 1];
    vec4 e = uData[$S(beads) + 3 * q + 2];
    c = mistBead(c, a.xyz, sat(mist * beads - i) * left, face, px, shade);
    if (i + 1.0 < beads) c = mistBead(c, vec3(a.w, b.xy), sat(mist * beads - (i + 1.0)) * left, face, px, shade);
    if (i + 2.0 < beads) c = mistBead(c, vec3(b.zw, e.x), sat(mist * beads - (i + 2.0)) * left, face, px, shade);
    if (i + 3.0 < beads) c = mistBead(c, e.yzw, sat(mist * beads - (i + 3.0)) * left, face, px, shade);
  }
  $END
  return c;
}

// Condensation develops over fixed glass patches, thickest at the cool rim and lower surface.
// Its clock changes local coverage slowly; the texture itself never slides across the glass.
float fogAt($U vec2 face, float level, vec4 clock) {
  float amount = sat($D(fog.amount) + $D(react.fog) * level);
  if (amount <= 0.0) return 0.0;
  float humidity = vnoise(face * 7.0 + vec2(3.7, 8.1));
  float develop = 0.07 * sin(clock.w * 0.45 + humidity * 6.2831853);
  float thick = fbm(face * 2.0, 4) + 0.2 * humidity + develop
    + 0.25 * smoothstep(0.35, 1.0, length(face)) + 0.1 * sat(-face.y);
  return smoothstep(1.2 - 1.3 * amount, 1.6 - 1.25 * amount, thick)
    * (0.5 + 0.5 * amount) * (0.88 + 0.12 * humidity);
}

// Soft, uneven micro-condensation. Fine detail fades below pixel size instead of becoming a
// field of bright dots; broad variations remain fixed on the glass as wiped paths re-fog.
vec4 fogOver($U vec4 c, vec2 face, float fog, float px) {
  if (fog <= 0.0) return c;
  float mottled = vnoise(face * 28.0 + vec2(7.1, 2.8)) - 0.5;
  float fine = (vnoise(face * 95.0) - 0.5) * (1.0 - smoothstep(0.003, 0.018, px));
  return over(c, $C(fog.color), fog * (0.55 + 0.055 * mottled + 0.025 * fine));
}

// Sunshine follows the light and surface. Rays stay aligned with the source; glints are selected
// by the reflected light, with moving water supplying its shared meniscus normal.
vec4 sunny($U vec4 c, vec2 face, float px, float level, vec4 water) {
  float amount = sat($D(sunny.amount) + $D(react.sunny) * level);
  $IF(clouds) amount *= exp(-cloudDensity($u face,uData[1].x) * $D(weather.clouds.density) * 3.0); $END
  if (amount <= 0.0) return c;
  vec3 sun = $C(sunny.color);
  vec2 light = vec2($D(light.x), $D(light.y));
  vec2 d = face - light;
  float dist = length(d);
  float source = max(0.3, $D(light.size));
  float glare = 0.45 * exp(-dist * dist / (0.08 * source * source))
    + 0.28 * exp(-dist * dist / (0.65 * source * source));
  float rays = 0.0;
  $IF(sunnyRays)
  float around = $atan2(d.y, d.x + 0.000001);
  rays = 0.6 * pow(0.5 + 0.5 * sin(around * 9.0 + 0.8 * sin(around * 3.0)), 8.0)
    + 0.4 * pow(0.5 + 0.5 * sin(around * 14.0 + 2.0), 12.0);
  rays *= exp(-dist * 2.0) * smoothstep(0.04, 0.24, dist) * $D(sunny.rays);
  $END
  // The ghosts lie on the line from the light through the middle.
  float ghosts = 0.0;
  $IF(sunnyFlare)
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    vec2 at = light * (0.25 - 0.6 * fk);
    float r = 0.05 + 0.04 * fk - 0.025 * fk * fk;
    float g = length(face - at) / r;
    ghosts += (0.28 - 0.06 * fk) * exp(-g * g * g * g) + 0.1 * exp(-(g - 1.0) * (g - 1.0) * 36.0);
  }
  $END
  c = over(c, sun, sat(amount * (glare + 0.22 * rays + 0.55 * ghosts * $D(sunny.flare))));
  $IF(sunnySparkle)
  // Sparse surface facets catch the source according to their normal, rather than blinking on
  // unrelated timers. Their positions and roughness are fixed, so a paused scene stays still.
  vec2 cell = floor(face * 22.0);
  float h = hash2(cell + 17.0);
  vec2 at = (cell + 0.5 + (vec2(hash2(cell + 2.3), hash2(cell + 8.9)) - 0.5) * 0.7) / 22.0;
  vec2 q = abs(face - at);
  float thin = max(0.0015, px * 0.65);
  float arm = 0.018 + 0.018 * h;
  float star = max(exp(-q.x / thin - q.y / arm), exp(-q.y / thin - q.x / arm));
  vec3 halfLight = normalize(lightDir($u) + vec3(0.0, 0.0, 1.001));
  vec2 rough = (vec2(hash2(cell + 4.7), hash2(cell + 6.2)) - 0.5) * 0.3;
  vec3 normal = normalize(vec3(at + rough, sqrt(max(0.02, 1.0 - dot(at, at)))));
  float alignment = pow(max(dot(normal, halfLight), 0.0), 64.0);
  float sparkle = step(h, 0.35) * star * alignment;
  if (water.w > 0.0) {
    // rainScan encodes the analytic height gradient, shared across contacting drops and film.
    // A narrow highlight moves continuously with that surface, including through coalescence.
    vec2 slope = (face - water.xy) / max(abs(water.z), 0.0001);
    vec3 waterNormal = normalize(vec3(face + slope, sqrt(max(0.02, 1.0 - dot(face, face)))));
    float wetGlint = pow(max(dot(waterNormal, halfLight), 0.0), 96.0);
    sparkle = mix(sparkle, 0.75 * wetGlint, water.w);
  }
  sparkle *= $D(sunny.sparkle);
  return over(c, mix(sun, vec3(1.0), 0.6), sat(amount * sparkle));
  $END
  return c;
}

// The room mirrored in the glass, the light's softbox included, by Fresnel: faint face on,
// strong at the rim.
vec4 mirror($U vec4 c, vec2 face, float blur, vec4 clock) {
  float amount = $D(glass.reflection);
  if (amount <= 0.0) return c;
  vec3 n = vec3(face, sqrt(max(0.0, 1.0 - dot(face, face))));
  vec3 d = reflect(vec3(0.0, 0.0, -1.0), n);
  float ior = $D(glass.ior);
  float f0 = ((ior - 1.0) / (ior + 1.0)) * ((ior - 1.0) / (ior + 1.0));
  float fresnel = f0 + (1.0 - f0) * pow(1.0 - n.z, 5.0);
  c = over(c, room($u d, blur, clock.z * 0.01745329), sat(fresnel * amount));
  // The light is far brighter than the room, so even face on, where little is mirrored, it shows.
  return over(c, $C(light.color), sat((0.25 + fresnel) * 3.0 * amount * softbox($u d, blur)));
}

vec4 glass($U vec4 c, vec2 face, float r, float px) {
  // Light bounced up along the bottom of the glass: a soft arc from -139° to -41°.
  $IF(bounce)
  float angle = $atan2(face.y, face.x) * 57.29578;
  float along = smoothstep(-149.0, -131.0, angle) * (1.0 - smoothstep(-49.0, -31.0, angle));
  float band = exp(-((r - 0.94) / 0.1) * ((r - 0.94) / 0.1));
  c = over(c, $C(glass.bounceColor), sat($D(glass.bounce) * 0.2 * band * along));

  $END
  $IF(rim)
  float rim = r < 0.84 ? 0.0 : (r < 0.96 ? mix(0.0, 0.32, (r - 0.84) / 0.12) : mix(0.32, 0.65, sat((r - 0.96) / 0.04)));
  c = over(c, vec3(1.0), sat(rim * $D(glass.rim)));

  // The highlight lies along the curve of the glass where the light is, and the glint beside it,
  // further out. Placed as the mark places them, turned round the middle with the light.
  $END
  $IF(lightMarks)
  vec2 light = lightSpot($u);
  float size = $D(light.size);
  float turn = dot(light, light) > 0.0001 ? $atan2(light.y, light.x) - 2.1948194 : 0.0;
  vec3 lit = $C(light.color);
  $IF(highlight)
  float tilt = turn + 0.66322512;
  vec2 h = face - light;
  float ct = cos(tilt);
  float st = sin(tilt);
  float e = length(vec2(h.x * ct + h.y * st, -h.x * st + h.y * ct) / (vec2(0.27, 0.14) * size));
  float spec = e < 0.55 ? mix(0.9, 0.3, e / 0.55) : mix(0.3, 0.0, sat((e - 0.55) / 0.45));
  c = over(c, lit, sat(spec * $D(glass.highlight)));
  $END
  $IF(glint)
  vec2 glint = light + rotate2(vec2(-0.11, 0.07), turn) * size;
  c = over(c, lit, sat($D(glass.glint)) * cover(length(face - glint) - 0.05 * size, px));

  $END
  $END
  // A fine dark line round the glass keeps the orb's shape on a white page.
  $IF(outline) c = over(c, $C(glass.outlineColor), $D(glass.outline) * cover(abs(r - 0.99) - 0.01, px)); $END
  return c;
}

// Round the orb: its halo, its shadow on the floor with the light it gathers there, and the
// background. Premultiplied.
vec4 outside($U vec2 face, float r, float level) {
  vec4 under = vec4(0.0);
  $IF(halo)
  float haloD = max(r - 1.0, 0.0) / max($D(halo.radius), 0.001);
  float haloA = sat(($D(halo.amount) + $D(react.halo) * level) * exp(-3.0 * haloD * haloD));
  under = vec4($C(halo.color) * haloA, haloA);
  $END
  $IF(shadow)
  float shadow = $D(shadow.amount);
  if (shadow > 0.0) {
    vec2 s = (face - vec2(0.0, -1.0)) / vec2(0.8, 0.15);
    vec2 k = (face - vec2(0.0, -1.0)) / vec2(0.32, 0.06);
    vec4 floorC = vec4($C(shadow.color), 1.0) * sat(shadow * exp(-2.5 * dot(s, s)));
    floorC = over(floorC, $C(light.color) * $C(glass.tint), sat($D(shadow.caustic) * exp(-2.5 * dot(k, k))));
    under += floorC * (1.0 - under.a);
  }
  $END
  vec4 bg = uData[$S(canvas) + 1];
  return under + vec4(bg.rgb * bg.a, bg.a) * (1.0 - under.a);
}

// The orb at frag, in the canvas's own units, y up from the bottom edge. Premultiplied.
vec4 orb($U vec2 frag) {
  vec4 head = uData[0];
  vec4 clock = uData[1];
  vec4 m = uData[2];
  float level = head.z;
  if (uData[$S(canvas)].y > 0.5) return weatherView($u frag,head,clock);
  float wobble = $D(wobble) + $D(react.wobble) * level;
  float breathe = 1.0;
  if (wobble > 0.0) breathe -= wobble * (0.5 + 0.5 * sin(clock.x * 2.1));
  float halo = max(0.0, $D(halo.amount) + $D(react.halo) * level);
  float glowBounds = halo > 0.0009765625 ? 1.0 + $D(halo.radius) * sqrt(log(halo * 1024.0) / 3.0) : 1.0;
  float shade = $D(shadow.amount);
  float shadowBounds = shade > 0.0009765625 ? sqrt(log(shade * 1024.0) / 2.5) : 0.0;
  float caustic = $D(shadow.caustic);
  float focusBounds = shade > 0.0 && caustic > 0.0009765625 ? sqrt(log(caustic * 1024.0) / 2.5) : 0.0;
  float side = max(1.0, max(glowBounds, max(shadowBounds * 0.8, focusBounds * 0.32)));
  float top = max(1.0, glowBounds);
  float bottom = max(top, 1.0 + max(shadowBounds * 0.15, focusBounds * 0.06));
  float radius = max(1.0, min(head.x / (2.0 * side), head.y / (top + bottom)) * uData[$S(canvas)].x * breathe);
  vec2 centre = 0.5 * head.xy + vec2(0.0, radius * (bottom - top) * 0.5);
  vec2 face = (frag - centre) / radius;
  float r = length(face);
  // One device pixel on the face, also where the canvas's units are points.
  float px = 1.0 / (radius * head.w);
  float coverage = cover(r - 1.0, px);

  vec4 under = outside($u face, r, level);
  if (coverage <= 0.0) return under;

  // The anti-aliased fringe just outside the rim samples the glass at the rim.
  vec2 f = r > 0.9999 ? face * (0.9999 / r) : face;
  float rr = min(r, 0.9999);

  // The inside, sampled from one place so a compiler that inlines it does so once: once, or once
  // a channel with dispersion bending each a little differently, and once more through the lens
  // of the drop this point sits in, if it sits in one.
  vec4 marks = vec4(0.0, 0.0, 1.0, 1.0);
  vec4 drop = vec4(0.0);
  $IF(water) drop = rainScan($u f, px, clock, marks); $END
  // Fog blurs what is behind it, except where running drops have wiped it away.
  float fog = 0.0;
  $IF(fog) fog = fogAt($u f, level, clock) * (1.0 - marks.x); $END
  vec2 look = vec2(0.0);
  if (drop.w > 0.0) {
    look = dropLook($u vec3(drop.xy, abs(drop.z)), (f - drop.xy) / abs(drop.z));
    float lookR = length(look);
    if (lookR > 0.98) look *= 0.98 / lookR;
  }
  float blur = $D(glass.frost) * 0.12 + fog * 0.16;
  float spread = $D(glass.dispersion) * 0.06;
  int channels = spread > 0.0 ? 3 : 1;
  vec3 col = vec3(0.0);
  vec3 seen = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    bool lens = k == 3;
    if (lens && drop.w <= 0.0) break;
    if (!lens && k >= channels) continue;
    vec3 got = insideAt(
      $u lens ? look : f,
      lens ? px / abs(drop.z) * $D(weather.water.lens) : px,
      level, clock, m,
      lens || channels == 1 ? 1.0 : 1.0 + spread * float(k - 1),
      lens ? 0.0 : blur
    );
    if (lens) seen = got * 1.06 + 0.03;
    else if (channels == 1) col = got;
    else if (k == 0) col.r = got.r;
    else if (k == 1) col.g = got.g;
    else col.b = got.b;
  }
  // Tinted glass: the middle, where it is thickest, takes the most of its colour.
  col *= pow(max($C(glass.tint), vec3(0.0001)), vec3(0.5 + sqrt(1.0 - rr * rr)));
  col += (hash2(floor(frag * head.w)) - 0.5) * 0.08 * $D(glass.frost);
  col *= 1.0 + $D(react.exposure) * level;
  // Sunshine warms what it falls through.
  $IF(sunny)
  col *= mix(vec3(1.0), $C(sunny.color) * 1.15, sat($D(sunny.amount) + $D(react.sunny) * level) * 0.18);
  $END
  float opacity = $D(glass.opacity);
  vec4 c = vec4(col * opacity, opacity);
  c = over(c, $C(glass.edgeColor), $D(glass.edge) * sat((r - 0.72) / 0.28));
  $IF(fog) c = fogOver($u c, f, fog, px); $END
  $IF(water) c = rain($u c, f, px, drop, seen, marks); $END
  $IF(mist) if (!$F(water)) c = rain($u c, f, px, drop, seen, marks); $END
  $IF(sunny) c = sunny($u c, f, px, level, drop); $END
  $IF(reflection) c = mirror($u c, f, $D(glass.frost) * 0.12, clock); $END
  c = glass($u c, f, r, px);
  $IF(lightning) c = weatherLightning($u c,f,px,clock); $END
  $IF(ice) c = frostWeather($u c,f,px,clock.x); $END
  $IF(air) c = airborneWeather($u c,f,px,clock.x); $END
  $IF(frozenFlakes) c = snowOver($u c, f, px, level); $END

  $IF(post)
  float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  c.rgb = clamp(mix(vec3(luma), c.rgb, $D(post.saturation)) * $D(post.exposure), vec3(0.0), vec3(c.a));
  $END
  c.rgb = clamp(c.rgb, vec3(0.0), vec3(c.a));
  return c * coverage + under * (1.0 - c.a * coverage);
}
`;
