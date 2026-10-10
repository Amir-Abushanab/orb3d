// Isolated WebGL test surface for continuous contact frames. One compiled shader and uniform
// buffer are reused throughout a sequence, just as in OrbRenderer. No studio/browser state is used.
import { chromium } from "playwright";

export async function createRainMotion(size, height = size) {
  const browser = await chromium.launch({
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: size, height } });
    await page.setContent(
      `<body style="margin:0"><canvas width="${size}" height="${height}"></canvas>`,
    );
    return {
      async prepare(vertex, fragment, slots, paintPages = []) {
        await page.evaluate(
          ({
            vertex: vertexSource,
            fragment: fragmentSource,
            slots: slotCount,
            paints: pageSizes,
          }) => {
            const gl =
              window.rainMotion?.gl ??
              document.querySelector("canvas").getContext("webgl2", {
                preserveDrawingBuffer: true,
                antialias: false,
              });
            if (!gl) throw new Error("WebGL2 unavailable for the motion diagnostic");
            if (window.rainMotion) {
              gl.deleteBuffer(window.rainMotion.buffer);
              if (window.rainMotion.extra) gl.deleteBuffer(window.rainMotion.extra);
              for (const buffer of window.rainMotion.paints ?? [])
                if (buffer) gl.deleteBuffer(buffer);
              gl.deleteProgram(window.rainMotion.program);
            }
            const compile = (type, source) => {
              const shader = gl.createShader(type);
              gl.shaderSource(shader, source);
              gl.compileShader(shader);
              if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                const error = gl.getShaderInfoLog(shader);
                gl.deleteShader(shader);
                throw new Error(error);
              }
              return shader;
            };
            const program = gl.createProgram();
            const vs = compile(gl.VERTEX_SHADER, vertexSource);
            const fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
            gl.attachShader(program, vs);
            gl.attachShader(program, fs);
            gl.linkProgram(program);
            gl.deleteShader(vs);
            gl.deleteShader(fs);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS))
              throw new Error(gl.getProgramInfoLog(program));
            gl.useProgram(program);
            const block = gl.getUniformBlockIndex(program, "OrbData");
            gl.uniformBlockBinding(program, block, 0);
            const buffer = gl.createBuffer();
            gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
            gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, buffer);
            gl.bufferData(gl.UNIFORM_BUFFER, Math.min(slotCount, 1024) * 16, gl.DYNAMIC_DRAW);
            gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
            const extraBlock = gl.getUniformBlockIndex(program, "OrbDataExtra");
            const extra = extraBlock === gl.INVALID_INDEX ? null : gl.createBuffer();
            if (extra) {
              gl.uniformBlockBinding(program, extraBlock, 12);
              gl.bindBuffer(gl.UNIFORM_BUFFER, extra);
              gl.bindBufferBase(gl.UNIFORM_BUFFER, 12, extra);
              gl.bufferData(gl.UNIFORM_BUFFER, (slotCount - 1024) * 16, gl.DYNAMIC_DRAW);
            }
            const paints = pageSizes.map((pageSlots, i) => {
              const colorBlock = gl.getUniformBlockIndex(program, `OrbPaint${i}`);
              if (colorBlock === gl.INVALID_INDEX) return null;
              const colorBuffer = gl.createBuffer();
              gl.uniformBlockBinding(program, colorBlock, i + 1);
              gl.bindBuffer(gl.UNIFORM_BUFFER, colorBuffer);
              gl.bufferData(gl.UNIFORM_BUFFER, pageSlots * 16, gl.DYNAMIC_DRAW);
              return colorBuffer;
            });
            window.rainMotion = { gl, program, buffer, extra, paints, pageSizes };
          },
          { vertex, fragment, slots, paints: paintPages },
        );
      },
      async frame(uniforms, paintValues = []) {
        await page.evaluate(
          ({ values, colors }) => {
            const { gl, buffer } = window.rainMotion;
            gl.bindBuffer(gl.UNIFORM_BUFFER, buffer);
            gl.bufferSubData(gl.UNIFORM_BUFFER, 0, new Float32Array(values.slice(0, 4096)));
            if (window.rainMotion.extra) {
              gl.bindBuffer(gl.UNIFORM_BUFFER, window.rainMotion.extra);
              gl.bufferSubData(gl.UNIFORM_BUFFER, 0, new Float32Array(values.slice(4096)));
            }
            for (let i = 0; i < window.rainMotion.paints.length; i++) {
              const colorBuffer = window.rainMotion.paints[i];
              if (!colorBuffer) continue;
              gl.bindBuffer(gl.UNIFORM_BUFFER, colorBuffer);
              gl.bindBufferBase(gl.UNIFORM_BUFFER, i + 1, colorBuffer);
              gl.bufferSubData(
                gl.UNIFORM_BUFFER,
                0,
                new Float32Array(
                  colors.slice(i * 4096, i * 4096 + window.rainMotion.pageSizes[i] * 4),
                ),
              );
            }
            gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, buffer);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            const error = gl.getError();
            if (error !== gl.NO_ERROR) throw new Error(`rain motion WebGL error ${error}`);
          },
          { values: Array.from(uniforms), colors: Array.from(paintValues) },
        );
        return page.locator("canvas").screenshot({ omitBackground: true });
      },
      close: () => browser.close(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
