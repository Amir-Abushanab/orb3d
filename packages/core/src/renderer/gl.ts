import { programLayout, UNIFORM_PAGE } from "../program/layout";
import { paintKey, PAINT_PAGE } from "../program/paint";
import type { OrbRuntime } from "../program/runtime";
import { VERTEX_SHADER, orbShader, userCodeLine, type ShaderSource } from "../program/shader";

/** A linked shader for one kind of contents (and one custom shader's code), with its buffers. */
interface Linked {
  key: string;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  paints: (WebGLBuffer | null)[];
  extra: WebGLBuffer | null;
  paintData?: Float32Array;
}

/** What tells one linked shader from another: its capabilities, contents, colours and code. */
export function shaderKey(source: ShaderSource): string {
  return `${source.features ?? "all"}:${source.contents}:${paintKey(source.paint)}:${source.code ?? ""}`;
}

/**
 * An orb's shader on a WebGL2 context you own, with no DOM: a page's canvas, or an OffscreenCanvas
 * in a worker. `use` links the shader a program needs and binds its uniform blocks (the program's
 * array a page at a time, and its colour fields); `draw` uploads a runtime's frame and draws one
 * full-canvas triangle. OrbRenderer draws through one. Pictures and clips are OrbRenderer's: bind
 * their texture to unit 0 before `draw` if you bring your own.
 */
export class OrbGL {
  readonly gl: WebGL2RenderingContext;
  readonly #vao: WebGLVertexArrayObject | null;
  #linked: Linked | null = null;
  #source: ShaderSource | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.#vao = gl.createVertexArray();
    gl.bindVertexArray(this.#vao);
  }

  /** The linked shader's key: {@link shaderKey} of its source, or the key `use` was given. */
  get key(): string | null {
    return this.#linked?.key ?? null;
  }

  /**
   * Draw `source` from now on, linking its shader unless that one is linked already. Throws when
   * the shader does not compile or link, keeping the one that did. Returns whether it linked.
   */
  use(source: ShaderSource, key = shaderKey(source)): boolean {
    if (this.#linked?.key === key) {
      this.#source = source;
      return false;
    }
    const linked = this.#link(key, source);
    this.#release();
    this.#linked = linked;
    this.#source = source;
    return true;
  }

  /** Upload the runtime's frame and draw it over a `width` × `height` viewport. */
  draw(runtime: OrbRuntime, width: number, height: number): void {
    const gl = this.gl;
    const linked = this.#linked;
    if (!linked) return;
    gl.viewport(0, 0, width, height);
    gl.useProgram(linked.program);
    gl.bindBuffer(gl.UNIFORM_BUFFER, linked.buffer);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, linked.buffer);
    const values = runtime.write(width, height);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, values.subarray(0, UNIFORM_PAGE * 4));
    if (linked.extra) {
      gl.bindBuffer(gl.UNIFORM_BUFFER, linked.extra);
      gl.bindBufferBase(gl.UNIFORM_BUFFER, 12, linked.extra);
      gl.bufferSubData(gl.UNIFORM_BUFFER, 0, values.subarray(UNIFORM_PAGE * 4));
    }
    const colors = runtime.paintData;
    const changed = linked.paintData !== colors;
    const paint = this.#source?.paint;
    for (let i = 0; i < linked.paints.length; i++) {
      const buffer = linked.paints[i];
      if (!buffer || !paint) continue;
      gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
      gl.bindBufferBase(gl.UNIFORM_BUFFER, i + 1, buffer);
      const start = i * PAINT_PAGE * 4;
      // Definitions change only on configuration edits; playback updates the state weights.
      const length = changed
        ? paint.pages[i]! * 4
        : i === 0
          ? Math.ceil(paint.states.length / 4) * 4
          : 0;
      if (length) gl.bufferSubData(gl.UNIFORM_BUFFER, 0, colors.subarray(start, start + length));
    }
    linked.paintData = colors;
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Delete the shader and buffers. After a lost context there is nothing to delete: drop it. */
  dispose(): void {
    this.#release();
    this.gl.deleteVertexArray(this.#vao);
  }

  #release(): void {
    const linked = this.#linked;
    if (!linked) return;
    const gl = this.gl;
    for (const buffer of linked.paints) if (buffer) gl.deleteBuffer(buffer);
    if (linked.extra) gl.deleteBuffer(linked.extra);
    gl.deleteBuffer(linked.buffer);
    gl.deleteProgram(linked.program);
    this.#linked = null;
  }

  #link(key: string, source: ShaderSource): Linked {
    const gl = this.gl;
    const compile = (type: number, text: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`[orb3d] shader failed to compile: ${log}`);
      }
      return shader;
    };
    const program = gl.createProgram()!;
    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const text = orbShader("glsl", source);
    let fragment: WebGLShader;
    try {
      fragment = compile(gl.FRAGMENT_SHADER, text);
    } catch (error) {
      gl.deleteShader(vertex);
      gl.deleteProgram(program);
      // Point a custom shader's errors at its own lines rather than the whole shader's.
      const first = userCodeLine(text);
      if (!first || !(error instanceof Error)) throw error;
      throw new Error(
        error.message
          .replace("[orb3d] shader failed to compile: ", "")
          .replace(/ERROR: \d+:(\d+):/g, (_, line: string) => `line ${Number(line) - first + 1}:`)
          .trim(),
        { cause: error },
      );
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`[orb3d] shader failed to link: ${log}`);
    }
    gl.useProgram(program);
    const uMedia = gl.getUniformLocation(program, "uMedia");
    if (uMedia) gl.uniform1i(uMedia, 0);
    const block = gl.getUniformBlockIndex(program, "OrbData");
    const bytes = gl.getActiveUniformBlockParameter(
      program,
      block,
      gl.UNIFORM_BLOCK_DATA_SIZE,
    ) as number;
    const buffer = gl.createBuffer()!;
    gl.uniformBlockBinding(program, block, 0);
    gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
    gl.bufferData(gl.UNIFORM_BUFFER, bytes, gl.DYNAMIC_DRAW);
    const extraBlock = gl.getUniformBlockIndex(program, "OrbDataExtra");
    const extra = extraBlock === gl.INVALID_INDEX ? null : gl.createBuffer()!;
    if (extra) {
      gl.uniformBlockBinding(program, extraBlock, 12);
      gl.bindBuffer(gl.UNIFORM_BUFFER, extra);
      gl.bufferData(
        gl.UNIFORM_BUFFER,
        (programLayout(source.contents).slots - UNIFORM_PAGE) * 16,
        gl.DYNAMIC_DRAW,
      );
    }
    const paints = (source.paint?.pages ?? []).map((slots, i) => {
      const paintBlock = gl.getUniformBlockIndex(program, `OrbPaint${i}`);
      if (paintBlock === gl.INVALID_INDEX) return null;
      const paintBuffer = gl.createBuffer()!;
      gl.uniformBlockBinding(program, paintBlock, i + 1);
      gl.bindBuffer(gl.UNIFORM_BUFFER, paintBuffer);
      gl.bufferData(gl.UNIFORM_BUFFER, slots * 16, gl.DYNAMIC_DRAW);
      return paintBuffer;
    });
    return { key, program, buffer, paints, extra };
  }
}
