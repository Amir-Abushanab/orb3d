// `@orb3d/core/program`: an orb as data, for running one on another platform. Compile a config to
// a program, step the runtime each frame and hand its array to the shader for your platform.
// Pure: no DOM, no WebGL, so it runs in a worklet, a test or a build script as well.
export { compileOrb } from "./compile";
export type { CompileOptions, OrbProgram, OrbProgramState } from "./compile";
export {
  OrbRuntime,
  advanceRuntime,
  createRuntimeData,
  createUniforms,
  createUniformBindings,
  omegaFor,
  seekRuntime,
  setRuntimeLevel,
  setRuntimeMedia,
  setRuntimeState,
  settleRuntime,
  springStep,
  writeRuntime,
  writeUniformBindings,
} from "./runtime";
export type { RuntimeData, RuntimeSnapshot } from "./runtime";
export { orbShader, VERTEX_SHADER } from "./shader";
export type { ShaderDialect, ShaderSource } from "./shader";
export { programLayout, MAX_SLOTS } from "./layout";
export type { ProgramLayout } from "./layout";

export { createPaintUniforms, writePaintRuntime } from "./runtime";
export { paintKey } from "./paint";
export type { PaintProgram } from "./paint";
export { orbFrame, effectFrame } from "./frame";
export type { OrbFrame } from "./frame";
