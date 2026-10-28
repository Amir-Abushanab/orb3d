// React Native Skia ships under two names: `react-native-skia` from 3.0, on Graphite (Vulkan on
// Android, Metal on Apple platforms), and `@shopify/react-native-skia` before it, on Ganesh
// (OpenGL ES on Android). The orb uses the same few exports from either, so this takes whichever
// the app has installed, the newer first. Metro treats a require inside try/catch as optional, so
// the one that is missing is not a build error. Metro has to see these requires as written, which
// is why the package points React Native at its source (the `react-native` condition) rather than
// at the build, where the bundler has rewritten them.
//
// Skia 3.x renames and removes APIs in minor releases, so what changed is looked up rather than
// assumed: the raster image factory (`MakeImage`, then `MakeRasterImage` from 3.4.2, then
// `MakeRaster` from 3.8.0), the texture image factory (`MakeImageFromGPUTexture`, then
// `MakeFromGPUTexture` from 3.8.0), and `useVideo`, which Skia 2 and 3.0.0 to 3.0.4 have and 3.0.5
// removed in favour of React Native WebGPU (see ./video.ts).
import type * as Skia3 from "react-native-skia";
import type { ImageInfo, SkData, SkImage } from "react-native-skia";
import type { SharedValue } from "react-native-reanimated";

declare const require: (id: string) => unknown;

/** What `useVideo` returns in Skia 2 and 3.0.0 to 3.0.4, and what ./video.ts returns after. */
export interface VideoFrames {
  currentFrame: SharedValue<SkImage | null>;
}
export type UseVideo = (
  source: string | null,
  options: { looping: boolean; paused: boolean },
) => VideoFrames;

type Required = Pick<
  typeof Skia3,
  | "AlphaType"
  | "Canvas"
  | "ColorType"
  | "FilterMode"
  | "Fill"
  | "ImageShader"
  | "MipmapMode"
  | "Shader"
  | "Skia"
  | "useImage"
>;
type SkiaModule = Required & { useVideo?: UseVideo };

const REQUIRED: (keyof Required)[] = [
  "AlphaType",
  "Canvas",
  "ColorType",
  "FilterMode",
  "Fill",
  "ImageShader",
  "MipmapMode",
  "Shader",
  "Skia",
  "useImage",
];
const RASTER = ["MakeRaster", "MakeRasterImage", "MakeImage"] as const;
const SUPPORTED =
  "react-native-skia 3.x (tested from 3.0.0 to 3.7.2) or @shopify/react-native-skia 2.x";

function check(skia: SkiaModule, name: string): SkiaModule {
  const missing: string[] = REQUIRED.filter((key) => skia[key] == null);
  const images = skia.Skia?.Image as unknown as Record<string, unknown> | undefined;
  if (images && !RASTER.some((key) => typeof images[key] === "function")) {
    missing.push(`Skia.Image.${RASTER[0]}`);
  }
  if (missing.length) {
    throw new Error(
      `[orb3d] @orb3d/react-native runs on ${SUPPORTED}; the installed ${name} has no ${missing.join(", ")}`,
    );
  }
  return skia;
}

function load(): SkiaModule {
  let skia3: SkiaModule | undefined;
  try {
    skia3 = require("react-native-skia") as SkiaModule;
  } catch {
    // not installed: try the 2.x name
  }
  if (skia3) return check(skia3, "react-native-skia");
  let skia2: SkiaModule | undefined;
  try {
    skia2 = require("@shopify/react-native-skia") as SkiaModule;
  } catch {
    // neither: say so below
  }
  if (skia2) return check(skia2, "@shopify/react-native-skia");
  throw new Error(`[orb3d] @orb3d/react-native needs React Native Skia: install ${SUPPORTED}`);
}

const skia = load();
// Typed by name, so the declarations can say what each is without reaching into Skia's internals.
export const AlphaType: typeof Skia3.AlphaType = skia.AlphaType;
export const Canvas: typeof Skia3.Canvas = skia.Canvas;
export const ColorType: typeof Skia3.ColorType = skia.ColorType;
export const FilterMode: typeof Skia3.FilterMode = skia.FilterMode;
export const Fill: typeof Skia3.Fill = skia.Fill;
export const ImageShader: typeof Skia3.ImageShader = skia.ImageShader;
export const MipmapMode: typeof Skia3.MipmapMode = skia.MipmapMode;
export const Shader: typeof Skia3.Shader = skia.Shader;
export const Skia: typeof Skia3.Skia = skia.Skia;
export const useImage: typeof Skia3.useImage = skia.useImage;
/** Skia's own `useVideo`, where it still has one: Skia 2 and 3.0.0 to 3.0.4. */
export const skiaUseVideo: UseVideo | undefined =
  typeof skia.useVideo === "function" ? skia.useVideo : undefined;
export type { SkImage, SkRuntimeEffect } from "react-native-skia";

type Factories = Record<string, ((...args: never[]) => unknown) | undefined>;

/** A CPU image from pixels, under whichever name this Skia gives the factory. */
export function makeRasterImage(
  info: ImageInfo,
  data: SkData,
  bytesPerRow: number,
): SkImage | null {
  const images = Skia.Image as unknown as Factories;
  const name = RASTER.find((key) => typeof images[key] === "function")!;
  const make = images[name] as (
    info: ImageInfo,
    data: SkData,
    bytesPerRow: number,
  ) => SkImage | null;
  return make.call(images, info, data, bytesPerRow);
}

/** An image sampling a WebGPU texture of the shared device (Skia 3.0.5 and later). */
export function makeTextureImage(texture: { readonly nativePointer: bigint }): SkImage {
  const images = Skia.Image as unknown as Factories;
  const make = (images.MakeFromGPUTexture ?? images.MakeImageFromGPUTexture) as
    | ((texture: { readonly nativePointer: bigint }) => SkImage)
    | undefined;
  if (!make) throw new Error("[orb3d] this react-native-skia cannot wrap a WebGPU texture");
  return make.call(images, texture);
}

/** The raw WGPUDevice Skia renders with, for React Native WebGPU's `importDevice` (Skia 3.0.5+). */
export function nativeDevice(): bigint {
  const own = Skia as unknown as { getNativeDevice?: () => bigint };
  if (typeof own.getNativeDevice !== "function") {
    throw new Error("[orb3d] this react-native-skia does not share its GPU device with WebGPU");
  }
  return own.getNativeDevice();
}
