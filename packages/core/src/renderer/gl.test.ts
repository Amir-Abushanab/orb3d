import { describe, expect, it } from "vitest";
import { ensureOrbConfig } from "../config/model";
import { gradientColor } from "../config/fill";
import { PRESETS } from "../presets";
import { compileOrb } from "../program/compile";
import { UNIFORM_PAGE } from "../program/layout";
import { OrbRuntime } from "../program/runtime";
import { OrbGL } from "./gl";

/** A WebGL2 context that records what is asked of it. The next fragment shader fails on demand. */
function context() {
  const calls: [string, ...unknown[]][] = [];
  let made = 0;
  let failNext = false;
  const programs: unknown[] = [];
  const record =
    (name: string, result?: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return result?.(...args);
    };
  const blocks: Record<string, number> = { OrbData: 0, OrbDataExtra: 1, OrbPaint0: 2 };
  const gl = {
    INVALID_INDEX: 4294967295,
    UNIFORM_BLOCK_DATA_SIZE: 1,
    UNIFORM_BUFFER: 2,
    VERTEX_SHADER: 3,
    FRAGMENT_SHADER: 4,
    COMPILE_STATUS: 5,
    LINK_STATUS: 6,
    DYNAMIC_DRAW: 7,
    TRIANGLES: 8,
    createVertexArray: record("createVertexArray", () => ({ vao: ++made })),
    bindVertexArray: record("bindVertexArray"),
    deleteVertexArray: record("deleteVertexArray"),
    createShader: record("createShader", (type) => ({ shader: ++made, type })),
    shaderSource: record("shaderSource"),
    compileShader: record("compileShader"),
    getShaderParameter: (shader: { type: number }) => {
      if (shader.type !== 4 || !failNext) return true;
      failNext = false;
      return false;
    },
    getShaderInfoLog: () => "ERROR: 0:1: nope",
    isContextLost: () => false,
    deleteShader: record("deleteShader"),
    createProgram: record("createProgram", () => {
      const program = { program: ++made };
      programs.push(program);
      return program;
    }),
    attachShader: record("attachShader"),
    linkProgram: record("linkProgram"),
    getProgramParameter: () => true,
    deleteProgram: record("deleteProgram"),
    useProgram: record("useProgram"),
    getUniformLocation: () => null,
    getUniformBlockIndex: (_program: unknown, name: string) => blocks[name] ?? 4294967295,
    getActiveUniformBlockParameter: () => 16384,
    uniformBlockBinding: record("uniformBlockBinding"),
    createBuffer: record("createBuffer", () => ({ buffer: ++made })),
    bindBuffer: record("bindBuffer"),
    bindBufferBase: record("bindBufferBase"),
    bufferData: record("bufferData"),
    bufferSubData: record("bufferSubData"),
    deleteBuffer: record("deleteBuffer"),
    viewport: record("viewport"),
    drawArrays: record("drawArrays"),
  };
  const named = (name: string) => calls.filter(([n]) => n === name).map(([, ...args]) => args);
  return {
    gl: gl as unknown as WebGL2RenderingContext,
    named,
    programs,
    failNextShader: () => (failNext = true),
  };
}

/** The sunset, with a colour field so the program carries a page of colours. */
function painted() {
  const sunset = PRESETS.sunset();
  return compileOrb(
    ensureOrbConfig({ ...sunset, glass: { ...sunset.glass, edgeColor: gradientColor("linear") } }),
  );
}

describe("OrbGL", () => {
  it("binds the program's two pages and its colours where the shader reads them", () => {
    const { gl, named } = context();
    const program = painted();
    expect(program.paint?.pages.length).toBeGreaterThan(0);
    new OrbGL(gl).use(program);
    expect(named("uniformBlockBinding").map(([, block, binding]) => [block, binding])).toEqual([
      [0, 0],
      [1, 12],
      [2, 1],
    ]);
  });

  it("draws a frame: the first page, the rest, the colours, then one triangle", () => {
    const { gl, named } = context();
    const program = painted();
    const runtime = new OrbRuntime(program);
    const orb = new OrbGL(gl);
    orb.use(program);
    orb.draw(runtime, 64, 48);
    expect(named("viewport")).toEqual([[0, 0, 64, 48]]);
    const uploads = named("bufferSubData").map(([, , data]) => (data as Float32Array).length);
    const values = runtime.write(64, 48);
    expect(uploads.slice(0, 2)).toEqual([UNIFORM_PAGE * 4, values.length - UNIFORM_PAGE * 4]);
    expect(uploads[2]).toBe(program.paint!.pages[0]! * 4);
    expect(named("drawArrays")).toEqual([[8, 0, 3]]);
    // Playback after that sends the colours' state weights only.
    orb.draw(runtime, 64, 48);
    const again = named("bufferSubData").map(([, , data]) => (data as Float32Array).length);
    expect(again[5]).toBe(Math.ceil(program.paint!.states.length / 4) * 4);
  });

  it("links a shader once, and again only for other contents", () => {
    const { gl, named } = context();
    const orb = new OrbGL(gl);
    expect(orb.use(compileOrb(PRESETS.sunset()))).toBe(true);
    expect(orb.use(compileOrb(PRESETS.sunset()))).toBe(false);
    expect(named("createProgram")).toHaveLength(1);
    expect(orb.use(compileOrb(PRESETS.aura()))).toBe(true);
    expect(named("createProgram")).toHaveLength(2);
    expect(named("deleteProgram")).toHaveLength(1);
  });

  it("keeps drawing the linked shader when the next does not compile", () => {
    const { gl, named, programs, failNextShader } = context();
    const orb = new OrbGL(gl);
    const sunset = compileOrb(PRESETS.sunset());
    orb.use(sunset);
    const linked = orb.key;
    failNextShader();
    expect(() => orb.use(compileOrb(PRESETS.aura()))).toThrow(/failed to compile/);
    expect(orb.key).toBe(linked);
    orb.draw(new OrbRuntime(sunset), 8, 8);
    expect(named("useProgram").at(-1)?.[0]).toBe(programs[0]);
    expect(named("drawArrays")).toHaveLength(1);
  });
});
