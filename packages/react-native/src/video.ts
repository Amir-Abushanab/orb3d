// Video contents. Skia 2 and 3.0.0 to 3.0.4 decode a clip themselves, with `useVideo`. From 3.0.5,
// React Native Skia leaves video to React Native WebGPU, an optional peer: its player decodes the
// clip into native frames, each new frame is rendered into a texture on the GPU device Skia shares
// with it (converting YUV to RGB and applying the clip's rotation), and Skia wraps that texture as
// an image, without a copy. This follows the "native buffers" section of Skia's WebGPU guide.
import { useEffect, useMemo, useRef } from "react";
import { useSharedValue } from "react-native-reanimated";
import {
  makeTextureImage,
  nativeDevice,
  skiaUseVideo,
  type SkImage,
  type UseVideo,
  type VideoFrames,
} from "./skia";

declare const require: (id: string) => unknown;
declare function requestAnimationFrame(callback: () => void): number;
declare function cancelAnimationFrame(handle: number): void;

// The few parts of React Native WebGPU this uses, typed here so the package has no type
// dependency on an optional peer (or on @webgpu/types, which it brings).
type Rotation = 0 | 90 | 180 | 270;
interface NativeVideoFrame {
  readonly width: number;
  readonly height: number;
  release(): void;
}
interface VideoPlayer {
  copyLatestFrame(): NativeVideoFrame | null;
  play(): void;
  pause(): void;
  release(): void;
  currentTime: number;
  loop: boolean;
  readonly rotation: Rotation;
}
interface Texture {
  readonly width: number;
  readonly height: number;
  readonly nativePointer: bigint;
  destroy(): void;
}
interface Device {
  createTexture(descriptor: { size: [number, number]; format: string; usage: number }): Texture;
  readonly queue: {
    copyExternalImageToTexture(
      source: { source: NativeVideoFrame; rotation: Rotation },
      destination: { texture: Texture },
      size: [number, number],
    ): void;
  };
}
interface WebGPU {
  createVideoPlayer(source: string): VideoPlayer;
  importDevice(pointer: bigint): Device;
}

// GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT: the copy renders the frame
// into the texture, and Skia samples it. The values are fixed by the WebGPU spec.
const USAGE = 0x04 | 0x10;

let webgpu: WebGPU | null | undefined;

/** React Native WebGPU, or why video contents cannot play without it. */
function loadWebGPU(): WebGPU {
  if (webgpu === undefined) {
    try {
      webgpu = require("react-native-webgpu") as WebGPU;
    } catch {
      webgpu = null;
    }
  }
  if (!webgpu || typeof webgpu.createVideoPlayer !== "function") {
    throw new Error(
      "[orb3d] video contents on react-native-skia 3.0.5 and later need react-native-webgpu (0.11.1 or later, the version paired with your Skia): install it, or use image contents",
    );
  }
  return webgpu;
}

function textureFormat(): string {
  const gpu = (globalThis as { navigator?: { gpu?: { getPreferredCanvasFormat?(): string } } })
    .navigator?.gpu;
  return gpu?.getPreferredCanvasFormat?.() ?? "bgra8unorm";
}

/** `useVideo` for Skia 3.0.5 and later: frames from React Native WebGPU's player. */
const useWebGPUVideo: UseVideo = (source, { looping, paused }) => {
  // Throws while rendering, so the error names the missing peer instead of a blank orb.
  if (source) loadWebGPU();
  const currentFrame = useSharedValue<SkImage | null>(null);
  const player = useRef<VideoPlayer | null>(null);
  const settings = useRef({ looping, paused });
  settings.current = { looping, paused };

  useEffect(() => {
    if (!source) return;
    const gpu = loadWebGPU();
    const device = gpu.importDevice(nativeDevice());
    const format = textureFormat();
    const video = gpu.createVideoPlayer(source);
    player.current = video;
    video.loop = settings.current.looping;
    if (settings.current.paused) video.currentTime = 0;
    else video.play();
    let texture: Texture | null = null;
    let frameHandle = 0;
    const publish = (image: SkImage | null): void => {
      const previous = currentFrame.value;
      currentFrame.value = image;
      previous?.dispose();
    };
    const render = (): void => {
      const frame = video.copyLatestFrame();
      if (frame) {
        // The frame is upright once rotated, and a quarter turn swaps its sides.
        const turned = video.rotation === 90 || video.rotation === 270;
        const width = turned ? frame.height : frame.width;
        const height = turned ? frame.width : frame.height;
        if (!texture || texture.width !== width || texture.height !== height) {
          publish(null);
          texture?.destroy();
          texture = device.createTexture({ size: [width, height], format, usage: USAGE });
        }
        device.queue.copyExternalImageToTexture(
          { source: frame, rotation: video.rotation },
          { texture },
          [width, height],
        );
        // The texture holds the pixels once the copy is issued: hand the buffer back.
        frame.release();
        // A new image is what makes the canvas draw again.
        publish(makeTextureImage(texture));
      }
      frameHandle = requestAnimationFrame(render);
    };
    frameHandle = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frameHandle);
      player.current = null;
      video.release();
      publish(null);
      texture?.destroy();
    };
  }, [source]);

  useEffect(() => {
    if (player.current) player.current.loop = looping;
  }, [looping]);

  useEffect(() => {
    const video = player.current;
    if (!video) return;
    if (paused) video.pause();
    else video.play();
  }, [paused]);

  return useMemo<VideoFrames>(() => ({ currentFrame }), [currentFrame]);
};

/**
 * The frames of a clip, as a shared value of the current one: Skia's own `useVideo` where it has
 * one, React Native WebGPU's player where it does not. Which one is fixed when the module loads, so
 * the hooks each render calls stay the same.
 */
export const useVideo: UseVideo = skiaUseVideo ?? useWebGPUVideo;
