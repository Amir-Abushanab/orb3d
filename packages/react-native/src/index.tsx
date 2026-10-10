import { mergeOrbConfig, type OrbConfigInput } from "@orb3d/core";
import {
  advanceRuntime,
  compileOrb,
  createRuntimeData,
  createUniformBindings,
  writeUniformBindings,
  paintKey,
  orbShader,
  setRuntimeLevel,
  setRuntimeMedia,
  setRuntimeState,
  settleRuntime,
  type OrbProgram,
  type RuntimeData,
} from "@orb3d/core/program";
import { PRESETS, isPresetName } from "@orb3d/core/presets";
import {
  AlphaType,
  Canvas,
  ColorType,
  FilterMode,
  Fill,
  ImageShader,
  MipmapMode,
  Shader,
  Skia,
  useImage,
  useVideo,
  type SkImage,
  type SkRuntimeEffect,
} from "./skia";
import { forwardRef, useEffect, useImperativeHandle, useMemo } from "react";
import type { ForwardedRef, ReactElement } from "react";
import { PixelRatio, type StyleProp, type ViewStyle } from "react-native";
import {
  useAnimatedReaction,
  useDerivedValue,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
} from "react-native-reanimated";

/** Image sources shared by Skia 2 and 3, without a type dependency on either optional peer. */
type AssetSource = { uri: string; width: number; height: number };
export type OrbSource =
  | string
  | number
  | Uint8Array
  | AssetSource
  | { __esModule: true; default: number | AssetSource | string }
  | null;

export interface Orb3DProps {
  /** A built-in look: `clear` (the default), `aura`, `landscape`, `sunset`, `dawn`, `storm` or
   *  `night`. */
  preset?: string;
  /** Merged over the preset: `{ glass: { frost: 0.5 } }` keeps the rest of the glass. */
  config?: OrbConfigInput;
  /** A compiled orb (Orb Studio's export, or `compileOrb`), used instead of preset and config. */
  program?: OrbProgram;
  /**
   * The picture or clip for image or video contents, instead of their `src`: for a picture,
   * anything `useImage` takes (a `require`d asset, a URL); for a clip, a URL or a local file URI.
   */
  source?: OrbSource;
  /** The state to show. Changing it springs the orb there. */
  state?: string;
  /** The input level, 0 to 1. For audio, use the ref's `setLevel` instead, so nothing re-renders. */
  level?: number;
  paused?: boolean;
  style?: StyleProp<ViewStyle>;
}

export interface Orb3DHandle {
  /** Feed the input level, 0 to 1, from any loop, without a render. */
  setLevel(value: number): void;
  setState(name: string): void;
}

const effects = new Map<string, SkRuntimeEffect | null>();

/** The SkSL for a program's contents, compiled once per kind (and per shader of your own). */
function effectFor(program: OrbProgram): SkRuntimeEffect | null {
  const key = `${program.features}:${program.contents}:${paintKey(program.paint)}:${program.code ?? ""}`;
  if (!effects.has(key)) effects.set(key, Skia.RuntimeEffect.Make(orbShader("sksl", program)));
  return effects.get(key) ?? null;
}

function compile(props: Orb3DProps): OrbProgram {
  if (props.program) return props.program;
  const name = props.preset ?? "clear";
  const base = isPresetName(name) ? PRESETS[name]() : PRESETS.clear();
  return compileOrb(props.config ? mergeOrbConfig(base, props.config) : base);
}

/** A transparent pixel, for the picture's place in the shader before one has loaded. Made on the
 *  JS thread, then handed to the UI thread's worklets. */
function blankImage(): SkImage {
  const image = Skia.Image.MakeImage(
    { width: 1, height: 1, alphaType: AlphaType.Premul, colorType: ColorType.RGBA_8888 },
    Skia.Data.fromBytes(new Uint8Array(4)),
    4,
  );
  if (!image) throw new Error("[orb3d] could not make a blank image");
  return image;
}

function Orb3DInner(props: Orb3DProps, ref: ForwardedRef<Orb3DHandle>): ReactElement {
  const configKey = props.program ? null : JSON.stringify(props.config ?? null);
  const compiled = useMemo(() => compile(props), [props.program, props.preset, configKey]);
  // A shader of your own that does not compile on this device leaves the glass clear.
  const { program, effect } = useMemo(() => {
    const own = effectFor(compiled);
    if (own) return { program: compiled, effect: own };
    console.warn("[orb3d] the orb's shader did not compile on this device; showing clear glass");
    const clear = compileOrb({ ...PRESETS.clear(), contents: { type: "none" } });
    return { program: clear, effect: effectFor(clear)! };
  }, [compiled]);
  const reduced = useReducedMotion();
  const still = reduced || (props.paused ?? program.paused);
  const ratio = PixelRatio.get();

  // The picture or clip, when the contents hold one. Both hooks always run; each is handed
  // nothing unless it is the one in use.
  const kind = program.media?.kind;
  const source = props.source ?? program.media?.src ?? null;
  const image = useImage(kind === "image" ? source : null);
  const video = useVideo(kind === "video" && typeof source === "string" ? source : null, {
    looping: true,
    paused: still,
  });

  // Everything the frame loop touches lives on the UI thread, in shared values: the program, the
  // runtime's springs and clocks, and the uniform array they are written into. Only the UI thread
  // ever changes them in place; the JS thread only replaces them, so nothing is mutated after it
  // has been shared.
  const shared = useSharedValue<OrbProgram>(program);
  const data = useSharedValue<RuntimeData>(createRuntimeData(program, props.state));
  const initialUniforms = useMemo(() => createUniformBindings(program), [program]);
  const uniforms = useSharedValue(initialUniforms);
  const size = useSharedValue({ width: 0, height: 0 });
  const state = useSharedValue(props.state ?? program.state);
  const level = useSharedValue(props.level ?? 0);
  const holding = useSharedValue(still);
  const version = useSharedValue(0);
  // The picture as the shader sees it: scaled down toward the orb's own size, so Skia samples a
  // mipmap rather than shimmering, with its size in those pixels.
  const media = useSharedValue({ width: 0, height: 0, scale: 1 });

  useEffect(() => {
    shared.value = program;
    data.value = createRuntimeData(program, state.value);
    uniforms.value = initialUniforms;
    version.value += 1;
  }, [program]);

  useEffect(() => {
    if (props.state !== undefined) state.value = props.state;
  }, [props.state]);

  useEffect(() => {
    if (props.level !== undefined) level.value = props.level;
  }, [props.level]);

  useImperativeHandle(
    ref,
    () => ({
      setLevel: (value) => {
        level.value = value;
      },
      setState: (name) => {
        state.value = name;
      },
    }),
    [],
  );

  const publishUniforms = (out: Record<string, number[]>): Record<string, number[]> => {
    "worklet";
    writeUniformBindings(data.value, shared.value, out, size.value.width, size.value.height, ratio);
    return out;
  };

  /** One frame on the UI thread: follow the state and level, step by dt, write the uniforms. */
  const draw = (dt: number): void => {
    "worklet";
    const runtime = data.value;
    const orb = shared.value;
    if (runtime.state !== state.value) setRuntimeState(runtime, orb, state.value, holding.value);
    setRuntimeLevel(runtime, level.value);
    setRuntimeMedia(runtime, media.value.width, media.value.height);
    // Holding still, a state change cuts and the level lands at once; otherwise both spring.
    if (holding.value) {
      runtime.level = runtime.levelTarget;
      if (reduced) settleRuntime(runtime);
    } else advanceRuntime(runtime, orb, dt);
    // Force the Skia subscriber notification while retaining the object and every uniform page.
    uniforms.modify(publishUniforms, true);
  };

  const frame = useFrameCallback((info) => {
    "worklet";
    draw(Math.min(Math.max((info.timeSincePreviousFrame ?? 0) / 1000, 0), 0.1));
  }, false);

  useEffect(() => {
    holding.value = still;
    frame.setActive(!still);
  }, [still]);

  // The frame the shader samples (a blank pixel until there is one), and its scaled size.
  const blank = useMemo(blankImage, []);
  const picture = useDerivedValue(() => {
    const current = kind === "video" ? video.currentFrame.value : kind === "image" ? image : null;
    const width = current ? current.width() : 0;
    const height = current ? current.height() : 0;
    const side = Math.max(1, Math.min(size.value.width, size.value.height) * ratio);
    const scale = width > 0 ? Math.min(1, Math.max(1 / 16, side / Math.min(width, height))) : 1;
    const scaledWidth = width * scale,
      scaledHeight = height * scale;
    const was = media.value;
    if (was.width !== scaledWidth || was.height !== scaledHeight || was.scale !== scale) {
      media.value = { width: scaledWidth, height: scaledHeight, scale };
    }
    return current ?? blank;
  }, [image, kind]);
  const pictureTransform = useDerivedValue(() => [{ scale: media.value.scale }]);

  // Holding still, draw again whenever something visible changes: size, state, level, look.
  useAnimatedReaction(
    () => [
      size.value.width,
      size.value.height,
      state.value,
      level.value,
      version.value,
      media.value.width,
      media.value.height,
      holding.value,
    ],
    () => {
      if (holding.value) draw(0);
    },
  );

  return (
    <Canvas style={props.style} onSize={size}>
      <Fill>
        <Shader source={effect} uniforms={uniforms}>
          {program.shader === "media" ? (
            <ImageShader
              image={picture}
              transform={pictureTransform}
              tx="clamp"
              ty="clamp"
              sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.Linear }}
            />
          ) : null}
        </Shader>
      </Fill>
    </Canvas>
  );
}

/**
 * A glass orb with states, drawn with React Native Skia.
 *
 *     <Orb3D preset="aura" state={agent.state} style={{ width: 96, height: 96 }} />
 *
 * Changing `state` springs the orb to it. The frame loop runs on the UI thread through Reanimated,
 * so a busy JS thread does not stall it. Under Reduce Motion it holds a still frame and cuts
 * between states.
 */
export const Orb3D = forwardRef(Orb3DInner);
Orb3D.displayName = "Orb3D";

export default Orb3D;
export type { OrbConfig } from "@orb3d/core";
export type { OrbProgram } from "@orb3d/core/program";
