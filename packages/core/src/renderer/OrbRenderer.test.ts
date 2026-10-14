import { afterEach, describe, expect, it, vi } from "vitest";
import { OrbRenderer } from "./OrbRenderer";

const noOp = () => {};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderer(adaptiveQuality: boolean) {
  let tick!: FrameRequestCallback;
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    tick = callback;
    return ++id;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(performance, "now").mockReturnValue(0);
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", document);
  const gl = {
    INVALID_INDEX: 4294967295,
    UNIFORM_BLOCK_DATA_SIZE: 1,
    createVertexArray: () => ({}),
    bindVertexArray: noOp,
    deleteVertexArray: noOp,
    createShader: () => ({}),
    shaderSource: noOp,
    compileShader: noOp,
    getShaderParameter: () => true,
    isContextLost: () => false,
    createProgram: () => ({}),
    attachShader: noOp,
    linkProgram: noOp,
    deleteShader: noOp,
    getProgramParameter: () => true,
    useProgram: noOp,
    getUniformLocation: () => null,
    getUniformBlockIndex: (_program: unknown, name: string) =>
      name === "OrbData" ? 0 : 4294967295,
    getActiveUniformBlockParameter: () => 16384,
    createBuffer: () => ({}),
    uniformBlockBinding: noOp,
    bindBuffer: noOp,
    bufferData: noOp,
    viewport: noOp,
    bindBufferBase: noOp,
    bufferSubData: noOp,
    drawArrays: noOp,
    deleteBuffer: noOp,
    deleteProgram: noOp,
  };
  const captures: number[] = [];
  const canvas = Object.assign(new EventTarget(), {
    width: 0,
    height: 0,
    getContext: () => gl,
    toBlob: (callback: BlobCallback) => {
      captures.push(canvas.width);
      callback(new Blob());
    },
  });
  const orb = new OrbRenderer(
    { clientWidth: 640, clientHeight: 640 } as HTMLElement,
    { dprMax: 1 },
    { adaptiveQuality, canvas: canvas as unknown as HTMLCanvasElement },
  );
  orb.start();
  return {
    orb,
    canvas,
    captures,
    frames: () => {
      for (let i = 1; i <= 80; i++) tick(i * 40);
    },
  };
}

describe("adaptive renderer captures", () => {
  it("captures at authored resolution and restores live resolution afterwards", async () => {
    const { orb, canvas, captures, frames } = renderer(true);
    frames();
    const liveWidth = canvas.width;
    const scale = orb.resolutionScale;
    expect(liveWidth).toBeLessThan(640);
    await orb.captureImage("image/png", undefined, 0);
    expect(captures).toEqual([640]);
    expect(canvas.width).toBe(liveWidth);
    expect(orb.resolutionScale).toBe(scale);
    orb.setOutputSize({ width: 1024, height: 1024 });
    expect(canvas.width).toBe(1024);
    await orb.captureImage();
    expect(captures).toEqual([640, 1024]);
    orb.setOutputSize();
    expect(canvas.width).toBe(liveWidth);
    orb.dispose();
  });

  it("keeps fixed quality when adaptation is disabled", () => {
    const { orb, canvas, frames } = renderer(false);
    frames();
    expect(canvas.width).toBe(640);
    expect(orb.resolutionScale).toBe(1);
    orb.dispose();
  });
});
