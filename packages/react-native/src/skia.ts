// React Native Skia ships under two names: `react-native-skia` from 3.0, on Graphite (Vulkan on
// Android, Metal on Apple platforms), and `@shopify/react-native-skia` before it, on Ganesh
// (OpenGL ES on Android). The orb uses the same few exports from either, so this takes whichever
// the app has installed, the newer first. Metro treats a require inside try/catch as optional, so
// the one that is missing is not a build error. Metro has to see these requires as written, which
// is why the package points React Native at its source (the `react-native` condition) rather than
// at the build, where the bundler has rewritten them.
import type * as Skia3 from "react-native-skia";

declare const require: (id: string) => unknown;

type SkiaModule = Pick<
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
  | "useVideo"
>;

function load(): SkiaModule {
  try {
    return require("react-native-skia") as SkiaModule;
  } catch {
    // not installed: try the 2.x name
  }
  try {
    return require("@shopify/react-native-skia") as SkiaModule;
  } catch {
    // neither: say so below
  }
  throw new Error(
    "[orb3d] @orb3d/react-native needs React Native Skia: install react-native-skia (3.x) or @shopify/react-native-skia (2.x)",
  );
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
export const useVideo: typeof Skia3.useVideo = skia.useVideo;
export type { SkImage, SkRuntimeEffect } from "react-native-skia";
