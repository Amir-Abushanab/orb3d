import { afterEach, describe, expect, it, vi } from "vitest";
import { OrbMedia } from "./media";

class Video extends EventTarget {
  videoWidth = 64;
  videoHeight = 64;
  readyState = 2;
  currentTime = 0;
  paused = true;
  callbacks = new Map<number, VideoFrameRequestCallback>();
  id = 0;
  load() {}
  removeAttribute() {}
  pause() {
    this.paused = true;
  }
  async play() {
    this.paused = false;
  }
  requestVideoFrameCallback(callback: VideoFrameRequestCallback): number {
    this.callbacks.set(++this.id, callback);
    return this.id;
  }
  cancelVideoFrameCallback(id: number) {
    this.callbacks.delete(id);
  }
  frame() {
    const [id, callback] = this.callbacks.entries().next().value!;
    this.callbacks.delete(id);
    callback(0, {} as VideoFrameCallbackMetadata);
  }
}

afterEach(() => vi.unstubAllGlobals());

function setup(decoded = true) {
  const video = new Video();
  if (!decoded) Object.defineProperty(video, "requestVideoFrameCallback", { value: undefined });
  vi.stubGlobal("HTMLVideoElement", Video);
  vi.stubGlobal("document", { createElement: () => video });
  const gl = {
    activeTexture: vi.fn(),
    createTexture: vi.fn(() => ({})),
    bindTexture: vi.fn(),
    texParameteri: vi.fn(),
    pixelStorei: vi.fn(),
    texImage2D: vi.fn(),
    texSubImage2D: vi.fn(),
    generateMipmap: vi.fn(),
    deleteTexture: vi.fn(),
  };
  const changed = vi.fn();
  const media = new OrbMedia("video", "clip.mp4", changed);
  video.dispatchEvent(new Event("loadeddata"));
  const bind = () => media.bind(gl as unknown as WebGL2RenderingContext);
  return { video, media, gl, changed, bind };
}

describe("decoded video texture updates", () => {
  it("uploads once per decoded frame despite changing playback time", () => {
    const { video, media, gl, bind } = setup();
    bind();
    for (let frame = 0; frame < 120; frame++) {
      video.currentTime += 1 / 120;
      bind();
    }
    expect(gl.texImage2D).toHaveBeenCalledTimes(1);
    expect(gl.generateMipmap).toHaveBeenCalledTimes(1);
    video.frame();
    bind();
    expect(gl.texSubImage2D).toHaveBeenCalledTimes(1);
    expect(gl.generateMipmap).toHaveBeenCalledTimes(2);
    expect(gl.texParameteri).toHaveBeenCalledTimes(4);
    media.dispose(gl as unknown as WebGL2RenderingContext);
    expect(video.callbacks.size).toBe(0);
  });

  it("redraws paused seeks, reallocates resized video and restores a lost texture", () => {
    const { video, media, gl, changed, bind } = setup();
    bind();
    video.frame();
    expect(changed).toHaveBeenCalledTimes(2);
    bind();
    video.videoWidth = 128;
    video.dispatchEvent(new Event("resize"));
    bind();
    expect(media.width).toBe(128);
    expect(gl.texImage2D).toHaveBeenCalledTimes(2);
    media.lose();
    bind();
    expect(gl.texImage2D).toHaveBeenCalledTimes(3);
    media.dispose(gl as unknown as WebGL2RenderingContext);
  });

  it("retains playback-time fallback in browsers without video frame callbacks", () => {
    const { video, media, gl, bind } = setup(false);
    bind();
    video.currentTime = 0.5;
    bind();
    bind();
    expect(gl.generateMipmap).toHaveBeenCalledTimes(2);
    media.dispose(gl as unknown as WebGL2RenderingContext);
  });
});
