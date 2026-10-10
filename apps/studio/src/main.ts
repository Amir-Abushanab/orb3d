import type { ColorValue } from "@orb3d/core";
import "./style.css";
import {
  CONTENTS,
  clearDial,
  dialFor,
  ensureOrbConfig,
  setDial,
  stateNames,
  withContentsStates,
  type ContentsType,
  type OrbConfig,
  type OrbStateOverride,
} from "@orb3d/core";
import { OrbRenderer } from "@orb3d/core/renderer";
import { PRESETS, PRESET_NAMES, isPresetName, type PresetName } from "@orb3d/core/presets";
import { download, exportCode, exportEmbed, exportProgram, type Framework } from "./export";
import type { CodeDrawer } from "./code";
import { createContentsTools } from "./contents";
import { CLEAR_UNDO_MS, History, type Restored } from "./history";
import { HistoryControls } from "./historyControls";
import { createLevelSource, type LevelMode } from "./level";
import { createPanel } from "./panel";
import { HistoryThumbnailer } from "./thumbs";
import { createSunControl } from "./sun";
import { createPreviewConfig } from "./preview";

// ---------------------------------------------------------------------------------------------
// The document: a config, the preset it came from, and which state the panel is editing.
// ---------------------------------------------------------------------------------------------

interface Doc {
  preset: string;
  config: OrbConfig;
}

const SAVE_KEY = "orb-studio:doc";

/** The editor's starting states, with responding retaining the preset's speech behaviour. */
function editorPreset(name: PresetName): OrbConfig {
  const config = PRESETS[name]();
  return ensureOrbConfig({
    ...config,
    state: "thinking",
    states: {
      thinking: config.states.thinking ?? {},
      responding: config.states.speaking ?? {},
      muted: config.states.muted ?? {},
    },
  });
}

function encode(doc: Doc): string {
  const bytes = new TextEncoder().encode(JSON.stringify(doc));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(text: string): Doc | null {
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const json = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    const doc = JSON.parse(json) as Partial<Doc>;
    return { preset: String(doc.preset ?? "custom"), config: ensureOrbConfig(doc.config) };
  } catch {
    return null;
  }
}

/** A share link first, then this browser's last session, then clear glass; and which it was. */
function initialDoc(): { doc: Doc; from: string } {
  const shared = /[#&]c=([\w-]+)/.exec(location.hash)?.[1];
  if (shared) {
    const doc = decode(shared);
    if (doc) return { doc, from: "shared link" };
  }
  try {
    const saved = localStorage.getItem(SAVE_KEY);
    const doc = saved ? decode(saved) : null;
    if (doc) return { doc, from: "last session" };
  } catch {
    // storage blocked: start fresh
  }
  return { doc: { preset: "clear", config: editorPreset("clear") }, from: "clear" };
}

const opening = initialDoc();
let doc = opening.doc;
let editing: string | null = null;

// ---------------------------------------------------------------------------------------------
// History: every change is a version, one per gesture. Undo and redo step through them; the list
// goes back to any of them.
// ---------------------------------------------------------------------------------------------

const timeline = new History({
  getLive: () => doc.config,
  getPresetName: () => doc.preset,
  onChange: () => historyControls?.update(timeline.getState()),
});

/** A discrete change, already made to `doc`: apply it and record it as a version of its own. A
 *  pending edit was flushed before the change, so it keeps its own version too. */
function commit(label?: string, removed: string[] = []): void {
  apply(removed);
  timeline.commit(doc.config, doc.preset, label);
}

/** Go back (or forward) to a version. Not recorded: the timeline already knows where it is. */
function restore(version: Restored | null): void {
  if (!version) return;
  const removed = stateNames(doc.config).filter((s) => !(s in version.config.states));
  doc = { preset: version.presetName, config: version.config };
  if (editing && !(editing in doc.config.states)) editing = null;
  apply(removed);
}

function undo(): void {
  timeline.flush();
  restore(timeline.undo());
}

function redo(): void {
  timeline.flush();
  restore(timeline.redo());
}

// ---------------------------------------------------------------------------------------------
// The preview
// ---------------------------------------------------------------------------------------------

const orbEl = document.getElementById("orb")!;
const openingPreview = createPreviewConfig(doc.config);
let previewBaseState = openingPreview.state;
const renderer = new OrbRenderer(orbEl, openingPreview, { adaptiveQuality: true });
renderer.start();
const sunControl = createSunControl(
  document.getElementById("orb-area")!,
  orbEl,
  document.getElementById("move-sun") as HTMLButtonElement,
  {
    onStart: () => timeline.flush(),
    onChange: ({ x, y }) => changeDials({ "light.x": x, "light.y": y }, false),
    onEnd() {
      timeline.markDirty();
      timeline.flush();
    },
  },
);
document.getElementById("notice")!.hidden = !matchMedia("(prefers-reduced-motion: reduce)").matches;

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Push the document to the preview, panel and state bar, and save it. Keep the live Base or named
 * state while editing; fall back to Base if that state was removed. `removed` names states the
 * preview still has and the document no longer does.
 */
function apply(removed: string[] = []): void {
  const previousBase = previewBaseState;
  const live = renderer.getState();
  const preview = createPreviewConfig(doc.config);
  previewBaseState = preview.state;
  renderer.setConfig({
    ...preview,
    state: live === previousBase || !(live in preview.states) ? previewBaseState : live,
    states: {
      ...preview.states,
      ...Object.fromEntries(removed.map((name) => [name, null])),
      ...(previousBase !== previewBaseState && !(previousBase in doc.config.states)
        ? { [previousBase]: null }
        : {}),
    } as OrbConfig["states"],
  });
  document.getElementById("orb")!.dataset.weatherView = doc.config.weather.view;
  panel.refresh(doc.config, editing, doc.preset);
  sunControl.refresh(doc.config, editing);
  tools.refresh(doc.config);
  syncCode();
  renderStates();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const encoded = encode(doc);
    try {
      localStorage.setItem(SAVE_KEY, encoded);
    } catch {
      // storage blocked: the share link still carries it
    }
    window.history.replaceState(null, "", `#c=${encoded}`);
  }, 250);
}

// ---------------------------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------------------------

function changeDials(
  changes: Record<string, number | ColorValue | boolean>,
  debounceHistory = true,
): void {
  const target = editing
    ? structuredClone(doc.config.states[editing] ?? {})
    : structuredClone(doc.config);
  for (const [key, value] of Object.entries(changes)) {
    const dial = dialFor(doc.config.contents.type, key);
    if (dial) setDial(target as unknown as Record<string, unknown>, dial, value, doc.config);
  }
  doc.config = ensureOrbConfig(
    editing
      ? { ...doc.config, states: { ...doc.config.states, [editing]: target as OrbStateOverride } }
      : (target as OrbConfig),
  );
  doc.preset = "custom";
  apply();
  // The sun handle commits on release, including gestures paused longer than the typing delay.
  if (debounceHistory) timeline.markDirty();
}

const panel = createPanel(document.getElementById("pane")!, PRESET_NAMES, {
  onDial(key, value, last) {
    changeDials({ [key]: value }, last);
  },
  onSunPosition(x, y) {
    changeDials({ "light.x": x, "light.y": y });
  },
  onClear(key) {
    if (!editing) return;
    timeline.flush();
    const states = structuredClone(doc.config.states);
    const keys = typeof key === "string" ? [key] : key;
    const dials = keys?.flatMap((path) => {
      const dial = dialFor(doc.config.contents.type, path);
      return dial ? [dial] : [];
    });
    if (dials) {
      for (const dial of dials) clearDial(states[editing] as Record<string, unknown>, dial);
    } else states[editing] = {};
    doc.config = ensureOrbConfig({ ...doc.config, states });
    doc.preset = "custom";
    commit(
      dials
        ? `${editing}: ${dials.length === 1 ? dials[0]!.label.toLowerCase() : "sun position"} to base`
        : `${editing}: overrides cleared`,
    );
  },
  onPreset(name) {
    if (!isPresetName(name)) return;
    timeline.flush();
    const removed = stateNames(doc.config);
    doc = { preset: name, config: editorPreset(name) };
    if (editing && !(editing in doc.config.states)) editing = null;
    commit(
      `preset ${name}`,
      removed.filter((s) => !(s in doc.config.states)),
    );
  },
  onContents(type) {
    setContents(type);
  },
  onCanvas(patch) {
    doc.config = ensureOrbConfig({ ...doc.config, ...patch });
    apply();
    timeline.markDirty();
  },
  onDuration(seconds) {
    if (editing) {
      const states = structuredClone(doc.config.states);
      states[editing]!.duration = seconds;
      doc.config = ensureOrbConfig({ ...doc.config, states });
    } else {
      doc.config = ensureOrbConfig({ ...doc.config, transition: { duration: seconds } });
    }
    doc.preset = "custom";
    apply();
    timeline.markDirty();
  },
});

/**
 * Put other contents in the same glass: their defaults, and in each state their own overrides in
 * place of the old contents'. The glass and its states' glass overrides stay as they are.
 */
function setContents(
  type: ContentsType,
  patch: Record<string, unknown> = {},
  label = `contents ${CONTENTS[type].label.toLowerCase()}`,
): void {
  timeline.flush();
  const model = CONTENTS[type];
  const contentsStates = model.states();
  contentsStates.responding ??= contentsStates.speaking ?? {};
  doc.config = ensureOrbConfig({
    ...doc.config,
    contents: { ...model.defaults(), ...patch } as OrbConfig["contents"],
    states: withContentsStates(doc.config.states, contentsStates),
  });
  doc.preset = "custom";
  commit(label);
}

// ---------------------------------------------------------------------------------------------
// The contents' own tools: a picture or clip's source, a shader's code.
// ---------------------------------------------------------------------------------------------

const tools = createContentsTools(document.getElementById("contents-tools")!, {
  onChange(patch) {
    timeline.flush();
    doc.config = ensureOrbConfig({
      ...doc.config,
      contents: { ...doc.config.contents, ...patch } as OrbConfig["contents"],
    });
    doc.preset = "custom";
    commit("fit" in patch ? `fit ${String(patch.fit)}` : "source");
  },
  onSample(type, src) {
    setContents(
      type,
      { src },
      src.startsWith("/samples/") ? `sample ${type}` : `${type} from file`,
    );
  },
  toast: (message) => toast(message),
});

// A shader's code, in its drawer under the orb. Each pause in the typing compiles, and is kept as
// a version. The editor (CodeMirror) loads the first time the contents are a shader: most orbs
// never need it.
const drawer = document.getElementById("code-drawer")!;
let code: CodeDrawer | null = null;
let codeLoading = false;

function syncCode(): void {
  const { contents } = doc.config;
  if (contents.type !== "shader") {
    drawer.hidden = true;
    return;
  }
  if (code) {
    code.refresh(contents.code);
    code.showError(renderer.shaderError);
    return;
  }
  if (codeLoading) return;
  codeLoading = true;
  void import("./code").then(({ createCodeDrawer }) => {
    code = createCodeDrawer(drawer, {
      onCode(text) {
        if (doc.config.contents.type !== "shader") return;
        doc.config = ensureOrbConfig({
          ...doc.config,
          contents: { ...doc.config.contents, code: text },
        });
        doc.preset = "custom";
        apply();
        timeline.markDirty();
      },
    });
    syncCode();
  });
}

// ---------------------------------------------------------------------------------------------
// The state bar: pick the state to show and edit; Base edits what every state starts from.
// ---------------------------------------------------------------------------------------------

const statesEl = document.getElementById("states")!;
const editingEl = document.getElementById("editing")!;

function show(name: string | null): void {
  editing = name;
  apply();
  renderer.setState(name ?? previewBaseState);
  renderStates();
}

function renderStates(): void {
  const live = renderer.getState();
  const chip = (label: string, name: string | null): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chip";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(editing === name));
    if ((name && name === live) || (name === null && live === previewBaseState))
      button.dataset.live = "";
    button.addEventListener("click", () => show(name));
    return button;
  };
  const chips: HTMLElement[] = [chip("Base", null)];
  for (const name of stateNames(doc.config)) {
    const button = chip(name, name);
    if (name !== doc.config.state) {
      const remove = document.createElement("span");
      remove.className = "remove";
      remove.textContent = "×";
      remove.title = `Delete ${name}`;
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        timeline.flush();
        const states = { ...doc.config.states };
        delete states[name];
        doc.config = ensureOrbConfig({ ...doc.config, states });
        if (editing === name) editing = null;
        if (renderer.getState() === name) renderer.setState(doc.config.state);
        doc.preset = "custom";
        commit(`delete ${name}`, [name]);
      });
      button.append(remove);
    }
    chips.push(button);
  }
  const add = document.createElement("input");
  add.className = "add";
  add.placeholder = "+ state";
  add.size = 7;
  add.setAttribute("aria-label", "Add a state");
  add.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const name = add.value.trim().replace(/\s+/g, "-");
    if (!name || name in doc.config.states) return;
    timeline.flush();
    doc.config = ensureOrbConfig({
      ...doc.config,
      states: { ...doc.config.states, [name]: {} },
    });
    doc.preset = "custom";
    timeline.commit(doc.config, doc.preset, `add ${name}`);
    show(name);
  });
  chips.push(add);
  statesEl.replaceChildren(...chips);
  editingEl.textContent = editing
    ? `Editing ${editing}: changes apply to this state only. Right-click a marked control to reset it.`
    : "Editing the base: changes apply to every state that does not override them.";
}

// ---------------------------------------------------------------------------------------------
// Level, cycling and backdrop
// ---------------------------------------------------------------------------------------------

const level = createLevelSource((value) => renderer.setLevel(value));
const slider = document.getElementById("level-slider") as HTMLInputElement;
slider.addEventListener("input", () => level.setManual(Number(slider.value)));

function pressOne(group: Element, selector: string, active: Element): void {
  for (const button of group.querySelectorAll(selector)) {
    button.setAttribute("aria-pressed", String(button === active));
  }
}

const levelGroup = document.querySelector("#level .segmented")!;
for (const button of levelGroup.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
  button.addEventListener("click", async () => {
    try {
      await level.setMode(button.dataset.mode as LevelMode);
      const active = levelGroup.querySelector(`[data-mode="${level.mode}"]`)!;
      pressOne(levelGroup, "[data-mode]", active);
      slider.disabled = level.mode !== "manual";
    } catch {
      toast("The microphone is not available here.");
    }
  });
}

const cycle = document.getElementById("cycle")!;
let cycleTimer: ReturnType<typeof setInterval> | undefined;

function cycleStep(): void {
  const names = stateNames(doc.config);
  renderer.setState(names[(names.indexOf(renderer.getState()) + 1) % names.length]!);
  renderStates();
}

cycle.addEventListener("click", () => {
  const on = cycle.getAttribute("aria-pressed") !== "true";
  cycle.setAttribute("aria-pressed", String(on));
  clearInterval(cycleTimer);
  if (!on) return;
  cycleStep();
  cycleTimer = setInterval(cycleStep, 2600);
});

const stage = document.getElementById("stage")!;
const backdrop = document.getElementById("backdrop")!;
for (const button of backdrop.querySelectorAll<HTMLButtonElement>("[data-backdrop]")) {
  button.addEventListener("click", () => {
    stage.dataset.backdrop = button.dataset.backdrop;
    pressOne(backdrop, "[data-backdrop]", button);
  });
}

// ---------------------------------------------------------------------------------------------
// Undo, redo and the version history
// ---------------------------------------------------------------------------------------------

const historyControls = new HistoryControls(document.getElementById("history-slot")!, {
  onUndo: undo,
  onRedo: redo,
  onJump(id) {
    timeline.flush();
    restore(timeline.jumpTo(id));
  },
  // Start over from where the orb is now, which stays as it is. Reversible while the toast is up,
  // because a history cleared by mistake is gone otherwise.
  onClear() {
    timeline.clear(doc.config, doc.preset);
    toast("History cleared. Press U to undo that", CLEAR_UNDO_MS);
  },
  thumb: new HistoryThumbnailer((id) => timeline.getConfig(id)),
});

/** Whether a key belongs to the control that has focus: a field, the code, a dropdown. */
function typing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)
  );
}

addEventListener("keydown", (event) => {
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  if (key !== "z" && key !== "y") return;
  // In a field the browser's own text undo wins; behind the export dialog nothing changes.
  if (typing(event.target) || dialog.open) return;
  event.preventDefault();
  if (key === "y" || event.shiftKey) redo();
  else undo();
});

// U takes back a cleared history, while the offer lasts.
addEventListener("keydown", (event) => {
  if (event.key !== "u" || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
  if (typing(event.target) || dialog.open) return;
  if (timeline.undoClear()) toast("History restored");
});

// A drag ends: what it changed becomes one version now, rather than when the debounce runs out.
// The microtask lets the panel settle on its final value first.
const flushOnRelease = (): void => {
  if (timeline.isDirty()) queueMicrotask(() => timeline.flush());
};
addEventListener("pointerup", flushOnRelease);
addEventListener("pointercancel", flushOnRelease);

// ---------------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------------

const dialog = document.getElementById("export") as HTMLDialogElement;
const codeEl = document.getElementById("code")!;
const frameworkGroup = document.getElementById("framework")!;
let framework: Framework = "react";

function renderCode(): void {
  codeEl.textContent = exportCode(framework, doc.config, doc.preset);
}

document.getElementById("open-export")!.addEventListener("click", () => {
  renderCode();
  dialog.showModal();
});

for (const button of frameworkGroup.querySelectorAll<HTMLButtonElement>("[data-framework]")) {
  button.addEventListener("click", () => {
    framework = button.dataset.framework as Framework;
    pressOne(frameworkGroup, "[data-framework]", button);
    renderCode();
  });
}

async function copy(text: string, message: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast("Copy failed: select the text and copy it by hand.");
  }
}

document.getElementById("copy-code")!.addEventListener("click", () => {
  void copy(codeEl.textContent ?? "", "Code copied");
});

document.getElementById("copy-link")!.addEventListener("click", () => {
  void copy(`${location.origin}${location.pathname}#c=${encode(doc)}`, "Share link copied");
});

document.getElementById("download-config")!.addEventListener("click", () => {
  download("orb.json", JSON.stringify(doc.config, null, 2) + "\n", "application/json");
});

document.getElementById("download-program")!.addEventListener("click", () => {
  download("orb.program.json", exportProgram(doc.config), "application/json");
});

/** The opening state at time 0, the frame the live orb starts on, so the handoff has no jump. */
document.getElementById("download-poster")!.addEventListener("click", async () => {
  const live = renderer.getState();
  renderer.setOutputSize({ width: 1024, height: 1024 });
  renderer.setState(doc.config.state, { immediate: true });
  try {
    download("orb.png", await renderer.captureImage("image/png", undefined, 0));
  } finally {
    renderer.setState(live, { immediate: true });
    renderer.setOutputSize();
  }
});

const embedButton = document.getElementById("download-embed") as HTMLButtonElement;
embedButton.addEventListener("click", async () => {
  embedButton.disabled = true;
  try {
    const background = stage.dataset.backdrop === "dark" ? "#16131a" : "#efedeb";
    download("orb.html", await exportEmbed(doc.config, background), "text/html");
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not export the HTML. Try again.", 6000);
  } finally {
    embedButton.disabled = false;
  }
});

// ---------------------------------------------------------------------------------------------

const toastEl = document.getElementById("toast")!;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string, ms = 2200): void {
  toastEl.textContent = message;
  toastEl.dataset.show = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => delete toastEl.dataset.show, ms);
}

apply();
timeline.reset(doc.config, doc.preset, opening.from);
