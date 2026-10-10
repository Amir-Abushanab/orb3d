import { PAINT_PAGE, type PaintProgram } from "../paint";

const read = (at: number): string => `uPaint${Math.floor(at / PAINT_PAGE)}[${at % PAINT_PAGE}]`;

/** Only the active state fields are sampled; immutable nodes are bits into portable UBO pages. */
export function paintShader(paint?: PaintProgram): string {
  if (!paint) return "";
  const fields = paint.fields
    .map(
      ({ rows }, key) => `vec3 paintField${key}($U vec2 p) {
    vec3 color = vec3(0.0); float total = 0.0;
    ${rows
      .map((row, i) => {
        const sample =
          paint.static[row * 4]! < 0.5
            ? `${read(row)}.yzw`
            : `paintSample($u ${Array.from({ length: 10 }, (_, n) => read(row + n)).join(", ")}, p)`;
        return `float w${i} = max(0.0, ${read(Math.floor(i / 4))}.${"xyzw"[i % 4]});
        if (w${i} > 0.00001) { color += w${i} * ${sample}; total += w${i}; }`;
      })
      .join("\n")}
    return color / max(total, 0.00001);
  }`,
    )
    .join("\n");
  return /* glsl */ `
vec3 paintRGB(float bits) {
  return vec3(floor(bits / 65536.0), mod(floor(bits / 256.0), 256.0), mod(bits, 256.0)) / 255.0;
}
vec3 paintLinear(vec3 c) {
  return vec3(c.r <= 0.04045 ? c.r / 12.92 : pow((c.r + 0.055) / 1.055, 2.4),
    c.g <= 0.04045 ? c.g / 12.92 : pow((c.g + 0.055) / 1.055, 2.4),
    c.b <= 0.04045 ? c.b / 12.92 : pow((c.b + 0.055) / 1.055, 2.4));
}
vec3 paintSRGB(vec3 c) {
  return vec3(c.r <= 0.0031308 ? c.r * 12.92 : 1.055 * pow(c.r, 0.416666667) - 0.055,
    c.g <= 0.0031308 ? c.g * 12.92 : 1.055 * pow(c.g, 0.416666667) - 0.055,
    c.b <= 0.0031308 ? c.b * 12.92 : 1.055 * pow(c.b, 0.416666667) - 0.055);
}
vec3 paintSample($U vec4 info, vec4 meta, vec4 p0, vec4 p1, vec4 p2, vec4 p3,
                 vec4 p4, vec4 p5, vec4 p6, vec4 p7, vec2 face) {
  vec4 nodes[8]; nodes[0]=p0; nodes[1]=p1; nodes[2]=p2; nodes[3]=p3;
  nodes[4]=p4; nodes[5]=p5; nodes[6]=p6; nodes[7]=p7;
  vec2 uv = face * 0.5 + 0.5;
  if (info.x > 3.5) {
    vec3 color = vec3(0.0); float total = 0.0;
    for (int i = 0; i < 8; i++) {
      if (float(i) >= meta.z) break;
      vec4 point = nodes[i];
      float dist = length(uv - point.xy) / max(0.05, point.w);
      float w = 1.0 / (pow(max(dist, 0.012), mix(4.8, 1.35, meta.y)) + 0.002);
      color += paintLinear(paintRGB(point.z)) * w; total += w;
    }
    return paintSRGB(color / max(total, 0.0001));
  }
  vec2 delta = uv - vec2(info.w, meta.x);
  float angle = info.y * 0.01745329252;
  float t = info.x < 1.5 ? 0.5 + dot(delta, vec2(sin(angle), cos(angle))) / info.z
    : (info.x < 2.5 ? length(delta) * 2.0 / info.z : fract(((length(delta) < 0.000001 ? 0.0 : $atan2(delta.x, delta.y)) - angle) / 6.283185307));
  t = clamp(t, 0.0, 1.0);
  vec4 previous = nodes[0];
  for (int i = 1; i < 8; i++) {
    if (float(i) >= meta.z) break;
    vec4 next = nodes[i];
    if (t <= next.x) return mix(paintRGB(previous.z), paintRGB(next.z), clamp((t - previous.x) / max(0.00001, next.x - previous.x), 0.0, 1.0));
    previous = next;
  }
  return paintRGB(previous.z);
}
${fields}
`;
}
