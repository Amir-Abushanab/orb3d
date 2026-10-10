import type { OrbConfig } from "@orb3d/core";

/** A preview-only empty override lets Base show its own dials without changing the document. */
export function createPreviewConfig(config: OrbConfig): OrbConfig {
  let base = "__studio_base__";
  while (Object.hasOwn(config.states, base)) base += "_";
  return { ...config, state: base, states: { ...config.states, [base]: {} } };
}
