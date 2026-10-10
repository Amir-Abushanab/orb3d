import { CELESTIAL_CONTENTS } from "./shaders/celestial";
import { canonicalDialKey } from "../config/dials";
import { type PaintProgram } from "./paint";
import { paintShader } from "./shaders/paint";
// The orb in one fragment shader, built for the contents it holds and written out for each
// platform: GLSL ES 3.00 for WebGL2 and Android, SkSL for React Native Skia, MSL for Metal.
//
// The glass (shaders/glass.ts) is the same round every kind of contents; each kind adds its own
// code (shaders/*.ts) defining `orbContents`. Everything moves from the clocks and dials in one
// uniform array (see layout.ts), so the shader draws a whole frame from it and the CPU only steps
// springs and clocks.
//
// The template is written in the subset all three accept. SkSL holds a shader to GLSL ES 1.0's
// rules, so every loop has a constant bound and exits with `break`, and every array index is a
// constant plus loop indices. Metal has no globals, so functions that read the uniform array (or
// the picture) take it as a parameter: `$U` declares it, `$u` passes it, and both vanish in the
// other two dialects. An `inout` parameter becomes a reference in Metal. `$D(key)` and `$C(key)` read a dial as a float or a colour, `$S(block)` is a
// structure slot, `$MAX(name)` a limit, `$DS` the first dial slot and `$CS` the contents' first.
import { WEATHER, WEATHER_VIEW } from "./shaders/weather";
import { FEATURES, type Feature } from "./features";
import { CONTENTS, DEFAULT_SHADER_CODE, type ContentsType } from "../config/model";
import { programLayout, UNIFORM_PAGE, SHADER_LIMITS, type ProgramLayout } from "./layout";
import {
  GRADIENT_CONTENTS,
  MEDIA_CONTENTS,
  NONE_CONTENTS,
  customContents,
} from "./shaders/contents";
import { DEFAULT_DROP, GLASS, HELPERS, INSIDE } from "./shaders/glass";
import { LANDSCAPE_CONTENTS } from "./shaders/landscape";
import { SUNSET_CONTENTS, SUNSET_DROP } from "./shaders/sunset";

export type ShaderDialect = "glsl" | "sksl" | "msl";

/** What a shader is built for: the contents it draws, and a custom shader's code. A program is one. */
export interface ShaderSource {
  contents: ContentsType;
  code?: string;
  /** Capabilities possible in any state; omitted for a universal native fallback. */
  features?: number;
  paint?: PaintProgram;
}

/** Where a custom shader's code goes, after the template round it has been expanded. */
const USER_CODE = "/*orb3d:contents*/";

function contentsCode(source: ShaderSource): { contents: string; drop: string } {
  switch (CONTENTS[source.contents].shader) {
    case "none":
      return { contents: NONE_CONTENTS, drop: DEFAULT_DROP };
    case "gradient":
      return { contents: GRADIENT_CONTENTS, drop: DEFAULT_DROP };
    case "media":
      return { contents: MEDIA_CONTENTS, drop: DEFAULT_DROP };
    case "custom":
      return { contents: customContents(USER_CODE), drop: DEFAULT_DROP };
    case "sunset":
      return { contents: SUNSET_CONTENTS, drop: SUNSET_DROP };
    case "celestial":
      return { contents: CELESTIAL_CONTENTS, drop: DEFAULT_DROP };
    case "landscape":
      return { contents: LANDSCAPE_CONTENTS, drop: DEFAULT_DROP };
  }
}

// Feature blocks retain a frame guard in universal shaders and vanish entirely when unused.
function featureMask(name: string): number {
  return name === "water"
    ? FEATURES.rain | FEATURES.snow | FEATURES.hail
    : name === "frozen"
      ? FEATURES.snow | FEATURES.hail
      : name === "frozenFlakes"
        ? FEATURES.snowFlakes
        : name === "lightMarks"
          ? FEATURES.highlight | FEATURES.glint
          : FEATURES[name as Feature];
}

function featureExpression(name: string): string {
  const mask = featureMask(name);
  const bits = Object.values(FEATURES)
    .filter((bit) => (mask & bit) !== 0)
    .map(
      (bit) =>
        `(mod(floor(${bit >= 1048576 ? "uData[$S(canvas)].z" : "uData[3].w"} / ${bit >= 1048576 ? bit / 1048576 : bit}.0), 2.0) > 0.5)`,
    )
    .join(" || ");
  const dial = (
    {
      clouds: "weather.clouds.enabled",
      atmosphere: "weather.atmosphere.enabled",
      lightning: "weather.lightning.enabled",
      ice: "weather.ice.enabled",
      air: "weather.air.enabled",
      hail: "weather.hail.enabled",
      reflection: "glass.reflection",
      bounce: "glass.bounce",
      rim: "glass.rim",
      highlight: "glass.highlight",
      glint: "glass.glint",
      outline: "glass.outline",
      sunnyRays: "weather.sunny.rays",
      sunnyFlare: "weather.sunny.flare",
      sunnySparkle: "weather.sunny.sparkle",
    } as Record<string, string>
  )[name];
  return dial ? `(${bits}) && ($D(${dial}) > 0.0)` : bits;
}

function specialize(template: string, features?: number): string {
  const token = /\$IF\((\w+)\)|\$END/g;
  let output = "",
    cursor = 0;
  const stack: boolean[] = [];
  for (const match of template.matchAll(token)) {
    if (stack.every(Boolean)) output += template.slice(cursor, match.index);
    if (match[1]) {
      const keep = features === undefined || (features & featureMask(match[1])) !== 0;
      if (stack.every(Boolean) && keep) output += `if (${featureExpression(match[1])}) {`;
      stack.push(keep);
    } else {
      if (stack.every(Boolean)) output += "}";
      stack.pop();
    }
    cursor = match.index! + match[0].length;
  }
  if (stack.length) throw new Error("[orb3d] unclosed shader feature block");
  return output + template.slice(cursor);
}

/** Remove unreachable library functions after specialization. User functions remain roots, so
 * custom contents can still call shared helpers. GLSL, SkSL and Metal use the same call graph. */
function pruneLibrary(body: string): string {
  const clean = body.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
  const functions: { name: string; start: number; end: number; calls: string[] }[] = [];
  const declarations =
    /^[ \t]*(?:float|vec[234]|mat[234]|int|bool|void)[ \t]+(\w+)\s*\([^;{}]*\)\s*\{/gm;
  for (const match of clean.matchAll(declarations)) {
    let depth = 1,
      end = match.index! + match[0].length;
    for (; end < clean.length && depth; end++) {
      if (clean[end] === "{") depth++;
      else if (clean[end] === "}") depth--;
    }
    const calls = [
      ...clean.slice(match.index! + match[0].length, end).matchAll(/\b(\w+)\s*\(/g),
    ].map((call) => call[1]!);
    functions.push({ name: match[1]!, start: match.index!, end, calls });
  }
  const userStart = body.indexOf("// ---- your contents ----");
  const userEnd = body.indexOf("// ---- end of your contents ----");
  const userNames = userStart < 0 ? [] : (body.slice(userStart, userEnd).match(/\b\w+\b/g) ?? []);
  // Any shared helper named in custom code remains available, including macro aliases. Never
  // rewrite the custom block: preserving its marker also keeps compiler line reporting intact.
  const reachable = new Set(["orb", ...userNames]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const fn of functions)
      if (reachable.has(fn.name))
        for (const call of fn.calls) {
          if (!reachable.has(call)) {
            reachable.add(call);
            changed = true;
          }
        }
  }
  for (let i = functions.length - 1; i >= 0; i--) {
    const fn = functions[i]!;
    if (!reachable.has(fn.name)) body = body.slice(0, fn.start) + body.slice(fn.end);
  }
  return body;
}

const SWIZZLE = "xyzw";

function expand(
  template: string,
  layout: ProgramLayout,
  dialect: ShaderDialect,
  paint?: PaintProgram,
): string {
  const metal = dialect === "msl";
  const media = layout.shader === "media";
  const channel = (at: number): string =>
    `uData[${layout.dialSlot + Math.floor(at / 4)}].${SWIZZLE[at % 4]}`;
  const dial = (key: string): number => {
    const at = layout.dials.offset[key];
    if (at === undefined) throw new Error(`[orb3d] shader names an unknown dial: ${key}`);
    return at;
  };
  const scopes = [...template.matchAll(/(?:vec[234]|float|void)\s+(\w+)\s*\(([^{};]*)\)\s*\{/g)];
  const pointAt = (index: number): string => {
    const scope = scopes.filter((entry) => entry.index! < index).at(-1);
    if (scope?.[1] === "orb") return "f";
    const args = scope?.[2] ?? "";
    for (const name of ["s", "face", "p", "rd", "d", "drop", "q", "frag"]) {
      const match = new RegExp(`vec([23])\\s+${name}\\b`).exec(args);
      if (match) return match[1] === "2" ? name : name === "p" ? "p.xz * 0.025" : `${name}.xy`;
    }
    return "vec2(0.0)";
  };
  const extra = (paint?.pages ?? []).map((_, i) => `constant float4* uPaint${i}`).join(", ");
  const pass = (paint?.pages ?? []).map((_, i) => `uPaint${i}`).join(", ");
  const out = template
    .replace(
      /\$C\(([\w.]+)(?:;\s*([\w.]+))?\)/g,
      (token, key: string, point: string | undefined, index: number) => {
        const field = paint?.fields.findIndex((entry) => entry.key === canonicalDialKey(key)) ?? -1;
        return field >= 0 ? `paintField${field}($u ${point ?? pointAt(index)})` : token;
      },
    )
    .replace(/\$F\((\w+)\)/g, (_, name: string) => `(${featureExpression(name)})`)
    .replace(
      /\$DAYLIGHT/g,
      layout.type === "celestial" ? "smoothstep(-8.0, 6.0, $D(contents.elevation))" : "1.0",
    )
    .replace(/\$D\(([\w.]+)\)/g, (_, key: string) => channel(dial(key)))
    .replace(/\$C\(([\w.]+)(?:;\s*[\w.]+)?\)/g, (_, key: string) => {
      const at = dial(key);
      const slot = Math.floor(at / 4);
      // A colour inside one slot is a swizzle; one that straddles two is built from parts.
      if (slot === Math.floor((at + 2) / 4)) {
        return `uData[${layout.dialSlot + slot}].${SWIZZLE.slice(at % 4, (at % 4) + 3)}`;
      }
      return `vec3(${channel(at)}, ${channel(at + 1)}, ${channel(at + 2)})`;
    })
    .replace(/\$S\((\w+)\)/g, (_, block: string) => {
      const slot = layout.slot[block];
      if (slot === undefined) throw new Error(`[orb3d] shader names an unknown block: ${block}`);
      return String(slot);
    })
    .replace(/\$MAX\((\w+)\)/g, (_, name: string) => {
      const limit = SHADER_LIMITS[name];
      if (limit === undefined) throw new Error(`[orb3d] shader names an unknown limit: ${name}`);
      return String(limit);
    })
    .replace(/\$DS\b/g, String(layout.dialSlot))
    .replace(/\$CS\b/g, String(layout.contentsSlot))
    .replace(
      /\$U /g,
      metal
        ? `constant float4* uData, ${media ? "texture2d<float> uMedia, " : ""}${extra ? extra + ", " : ""}`
        : "",
    )
    .replace(
      /\$U\)/g,
      metal
        ? `constant float4* uData${media ? ", texture2d<float> uMedia" : ""}${extra ? ", " + extra : ""})`
        : ")",
    )
    .replace(/\$u /g, metal ? `uData, ${media ? "uMedia, " : ""}${pass ? pass + ", " : ""}` : "")
    .replace(/\$u\)/g, metal ? `uData${media ? ", uMedia" : ""}${pass ? ", " + pass : ""})` : ")")
    .replace(/\$atan2\(/g, metal ? "atan2(" : "atan(")
    // Metal passes what a function writes back by reference.
    .replace(/\binout (\w+) /g, metal ? "thread $1& " : "inout $1 ");
  const left = /\$\w+/.exec(out);
  if (left) throw new Error(`[orb3d] unexpanded shader token ${left[0]}`);
  return out;
}

/** The line of a shader where your own contents' code starts, counting from 1, or 0 if it has none. */
export function userCodeLine(shader: string): number {
  const at = shader.indexOf("// ---- your contents ----");
  return at < 0 ? 0 : shader.slice(0, at).split("\n").length + 1;
}

/** GLSL that Metal also understands, for your own contents: what the two spell differently. */
const METAL_COMPAT = `typedef float2 vec2;
typedef float3 vec3;
typedef float4 vec4;
typedef float2x2 mat2;
typedef float3x3 mat3;
typedef float4x4 mat4;
typedef int2 ivec2;
typedef int3 ivec3;
typedef int4 ivec4;
inline float mod(float x, float y) { return x - y * floor(x / y); }
inline float2 mod(float2 x, float y) { return x - y * floor(x / y); }
inline float3 mod(float3 x, float y) { return x - y * floor(x / y); }
inline float4 mod(float4 x, float y) { return x - y * floor(x / y); }
inline float2 mod(float2 x, float2 y) { return x - y * floor(x / y); }
inline float3 mod(float3 x, float3 y) { return x - y * floor(x / y); }
inline float4 mod(float4 x, float4 y) { return x - y * floor(x / y); }
inline float atan(float y, float x) { return atan2(y, x); }
inline float inversesqrt(float x) { return rsqrt(x); }
`;

/** Your own contents in Metal's spelling: program-scope constants and out parameters. */
function toMetal(code: string): string {
  return code
    .replace(/^const\s/gm, "constant ")
    .replace(/\b(?:inout|out)\s+(\w+)\s+(\w+)/g, "thread $1& $2")
    .replace(/\bradians\(/g, "(0.01745329252 * ")
    .replace(/\bdegrees\(/g, "(57.29577951 * ");
}

/** The fragment shader for a platform and contents. GLSL pairs with {@link VERTEX_SHADER}; MSL
 *  carries both stages, `orbVertex` and `orbFragment`, reading the uniform array from buffer 0
 *  (and a picture or clip from texture 0). SkSL reads a picture or clip from its one child. */
export function orbShader(dialect: ShaderDialect, source: ShaderSource): string {
  const layout = programLayout(source.contents);
  const { contents, drop } = contentsCode(source);
  let template =
    paintShader(source.paint) + HELPERS + WEATHER + contents + INSIDE + drop + WEATHER_VIEW + GLASS;
  if (source.features !== undefined && !(source.features & FEATURES.dispersion)) {
    template = template.replace(/\$D\(glass.dispersion\)/g, "0.0");
    if (!(source.features & (FEATURES.rain | FEATURES.snow | FEATURES.hail))) {
      const start = template.indexOf("  vec2 look = vec2(0.0);", template.indexOf("vec4 orb($U"));
      const end = template.indexOf("  // Tinted glass:", start);
      template =
        template.slice(0, start) +
        `
  float blur = $D(glass.frost) * 0.12 + fog * 0.16;
  vec3 col = insideAt($u f, px, level, clock, m, 1.0, blur);
  vec3 seen = vec3(0.0);
` +
        template.slice(end);
    }
  }
  if (source.features !== undefined && !(source.features & FEATURES.blur))
    template = template.replace(/\$D\(glass.frost\)/g, "0.0");
  let body = expand(specialize(template, source.features), layout, dialect, source.paint);
  if (CONTENTS[source.contents].shader === "custom") {
    const code = source.code ?? DEFAULT_SHADER_CODE;
    body = body.replace(USER_CODE, dialect === "msl" ? toMetal(code) : code);
  }
  body = pruneLibrary(body);
  const media = layout.shader === "media";
  const extraSlots = Math.max(0, layout.slots - UNIFORM_PAGE);
  if (dialect === "glsl" && extraSlots) {
    body = body.replace(/uData\[([^\]]+)\]/g, (_, index: string) => {
      if (/^\d+$/.test(index))
        return Number(index) < UNIFORM_PAGE
          ? `uData[${index}]`
          : `uDataExtra[${Number(index) - UNIFORM_PAGE}]`;
      return `readOrbData(${index})`;
    });
    body =
      `vec4 readOrbData(int i) { if (i < ${UNIFORM_PAGE}) return uData[i]; return uDataExtra[i - ${UNIFORM_PAGE}]; }\n` +
      body;
  }
  switch (dialect) {
    case "glsl":
      return `#version 300 es
precision highp float;
precision highp int;
layout(std140) uniform OrbData { vec4 uData[${Math.min(layout.slots, UNIFORM_PAGE)}]; };
${extraSlots ? `layout(std140) uniform OrbDataExtra { vec4 uDataExtra[${extraSlots}]; };` : ""}
${(source.paint?.pages ?? []).map((slots, i) => `layout(std140) uniform OrbPaint${i} { vec4 uPaint${i}[${slots}]; };`).join("\n")}
${
  media
    ? `uniform sampler2D uMedia;
vec4 sampleMedia(vec2 uv, float lod) { return textureLod(uMedia, uv, lod); }
`
    : ""
}out vec4 fragColor;
${body}
void main() {
  fragColor = orb(gl_FragCoord.xy);
}
`;
    case "sksl":
      // Skia's origin is the top-left corner, so turn y back up before drawing.
      return `uniform float4 uData[${layout.slots}];
${(source.paint?.pages ?? []).map((slots, i) => `uniform float4 uPaint${i}[${slots}];`).join("\n")}
${
  media
    ? `uniform shader uMedia;
// Skia picks a mipmap from the picture's own scale, not a level asked for, so frosting the
// picture blurs it by hand: a disc of taps as wide as the level asked for.
vec4 sampleMedia(vec2 uv, float lod) {
  vec2 p = uv * uData[3].xy;
  float r = (exp2(lod) - 1.6) * 1.05;
  if (r <= 0.0) return vec4(uMedia.eval(p));
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 24; i++) {
    float a = float(i) * 2.3999632;
    sum += vec4(uMedia.eval(p + r * sqrt((float(i) + 0.5) / 24.0) * vec2(cos(a), sin(a))));
  }
  return sum / 24.0;
}
`
    : ""
}${body}
half4 main(float2 fragCoord) {
  return half4(orb(float2(fragCoord.x, uData[0].y - fragCoord.y)));
}
`;
    case "msl":
      return `#include <metal_stdlib>
using namespace metal;
${METAL_COMPAT}${
        media
          ? `
float4 sampleMedia(constant float4* uData, texture2d<float> uMedia${(source.paint?.pages ?? []).map((_, i) => `, constant float4* uPaint${i}`).join("")}, float2 uv, float lod) {
  constexpr sampler linear(filter::linear, mip_filter::linear, address::clamp_to_edge);
  return uMedia.sample(linear, uv, level(lod));
}
`
          : ""
      }${body}
struct OrbVertexOut {
  float4 position [[position]];
};

// One triangle that covers the drawable, from the vertex id alone.
vertex OrbVertexOut orbVertex(uint id [[vertex_id]]) {
  float2 p = float2(float((id << 1) & 2), float(id & 2));
  OrbVertexOut out;
  out.position = float4(p * 2.0 - 1.0, 0.0, 1.0);
  return out;
}

// Metal's origin is the top-left corner, so turn y back up before drawing.
fragment float4 orbFragment(OrbVertexOut in [[stage_in]], constant float4* uData [[buffer(0)]]${
        media ? ", texture2d<float> uMedia [[texture(0)]]" : ""
      }${(source.paint?.pages ?? []).map((_, i) => `, constant float4* uPaint${i} [[buffer(${i + 1})]]`).join("")}) {
  return orb(uData, ${media ? "uMedia, " : ""}${(source.paint?.pages ?? []).map((_, i) => `uPaint${i}, `).join("")}float2(in.position.x, uData[0].y - in.position.y));
}
`;
  }
}

/** One triangle that covers the canvas, from gl_VertexID alone: no buffers, no attributes. */
export const VERTEX_SHADER = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;
