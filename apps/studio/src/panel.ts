import { ColorEditor } from "./colorEditor";
import { fillHex, type ColorValue } from "@orb3d/core";
// The control panel, generated from the dial lists: every dial the core knows is a control here,
// grouped as the core groups them, so adding a dial to the model adds it to the studio. The glass's
// dials are always there; the contents' come and go with the kind of contents, in a folder of their
// own.
import {
  CONTENTS,
  CONTENTS_TYPES,
  GLASS_DIALS,
  getDialValue,
  type ContentsType,
  type Dial,
  type OrbConfig,
} from "@orb3d/core";
import { Pane, type FolderApi, type ListBladeApi } from "tweakpane";
import { sunCartesian, sunPolar } from "./sun";

type Binding = ReturnType<FolderApi["addBinding"]>;

export interface PanelHandlers {
  /** A dial moved. `last` is true when a drag ends, the moment worth an undo step. */
  onDial(key: string, value: number | ColorValue | boolean, last: boolean): void;
  onSunPosition(x: number, y: number): void;
  /** Clear the editing state's override of one dial, or of all of them. */
  onClear(key?: string | readonly string[]): void;
  onPreset(name: string): void;
  onContents(type: ContentsType): void;
  onCanvas(patch: Partial<OrbConfig>): void;
  onDuration(seconds: number): void;
}

export interface Panel {
  /** Show `config` as seen from `editing` (a state, or null for the base). */
  refresh(config: OrbConfig, editing: string | null, preset: string): void;
}

/** The glass's groups, in panel order. */
const GLASS_GROUPS = [
  "Glass",
  "Light",
  "Edge",
  "Room",
  "Weather",
  "Halo",
  "Shadow",
  "Motion",
  "React",
  "Post",
];

/** Overridden dials say so in their label, so a state's differences from the base are visible. */
const MARK = " •";

export function createPanel(
  container: HTMLElement,
  presets: readonly string[],
  handlers: PanelHandlers,
): Panel {
  const pane = new Pane({ container });
  // One flat object keyed by dial path: what the controls show and write.
  const values: Record<string, number | string | boolean> = {};
  const bindings = new Map<string, { dial: Dial; binding: Binding; editor?: ColorEditor }>();
  let editing: string | null = null;
  let syncing = false;
  let shown: ContentsType | null = null;
  let shownConfig: OrbConfig;

  const preset = pane.addBlade({
    view: "list",
    label: "Preset",
    options: [...presets.map((p) => ({ text: p, value: p })), { text: "custom", value: "custom" }],
    value: presets[0],
  }) as ListBladeApi<string>;
  preset.on("change", (ev) => {
    if (!syncing && ev.value !== "custom") handlers.onPreset(ev.value);
  });

  // The kind of contents is structure, not a dial: switching it changes which controls apply.
  const kind = pane.addBlade({
    view: "list",
    label: "Contents",
    options: CONTENTS_TYPES.map((type) => ({ text: CONTENTS[type].label, value: type })),
    value: "none",
  }) as ListBladeApi<ContentsType>;
  kind.on("change", (ev) => {
    if (!syncing) handlers.onContents(ev.value);
  });

  const canvas = { size: 1, background: "transparent", quality: 1, duration: 1.1 };
  const timing = pane.addBinding(canvas, "duration", {
    label: "Transition (s)",
    min: 0.05,
    max: 5,
    step: 0.05,
  });
  timing.on("change", (ev) => {
    if (!syncing) handlers.onDuration(ev.value);
  });

  // Rebuilt whenever the kind of contents changes.
  let contentsFolder: FolderApi | null = null;

  const glassFolders = new Map<string, FolderApi>();
  for (const group of GLASS_GROUPS) {
    glassFolders.set(group, pane.addFolder({ title: group, expanded: group === "Glass" }));
  }
  const weather = glassFolders.get("Weather")!;
  for (const dial of GLASS_DIALS.filter((candidate) => candidate.group === "Weather").toSorted(
    (a, b) =>
      [
        "weather.air.enabled",
        "weather.air.amount",
        "weather.air.depth",
        "weather.gravity",
        "weather.wind",
        "weather.windSpeed",
        "weather.gusts",
        "weather.turbulence",
        "weather.reducedMotion",
        "weather.water.lens",
        "weather.water.shade",
      ].indexOf(a.key) -
      [
        "weather.air.enabled",
        "weather.air.amount",
        "weather.air.depth",
        "weather.gravity",
        "weather.wind",
        "weather.windSpeed",
        "weather.gusts",
        "weather.turbulence",
        "weather.reducedMotion",
        "weather.water.lens",
        "weather.water.shade",
      ].indexOf(b.key),
  ))
    addDial(weather, dial);
  const weatherView = weather.addBlade({
    view: "list",
    label: "View",
    options: [
      { text: "Orb glass", value: "orb" },
      { text: "Hero sky", value: "sky" },
      { text: "Weather overlay", value: "overlay" },
    ],
    value: "orb",
  }) as ListBladeApi<OrbConfig["weather"]["view"]>;
  weatherView.on("change", (ev) => {
    if (!syncing) handlers.onCanvas({ weather: { ...shownConfig.weather, view: ev.value } });
  });
  for (const group of [
    "Rain",
    "Snow",
    "Fog",
    "Sunny",
    "Clouds",
    "Atmosphere",
    "Lightning",
    "Hail",
    "Ice",
  ]) {
    glassFolders.set(group, weather.addFolder({ title: group, expanded: false }));
  }
  // Enables appear first within each pattern, independent of their packed channel positions.
  for (const dial of [...GLASS_DIALS].toSorted(
    (a, b) =>
      Number(b.kind === "boolean") - Number(a.kind === "boolean") ||
      Number(b.key === "weather.rain.density") - Number(a.key === "weather.rain.density"),
  )) {
    if (dial.group !== "Weather") addDial(glassFolders.get(dial.group)!, dial);
  }

  const sun = { direction: 0, distance: 0 };
  const sunBindings = [
    glassFolders
      .get("Sunny")!
      .addBinding(sun, "direction", { label: "Direction (°)", min: -180, max: 180, step: 1 }),
    glassFolders
      .get("Sunny")!
      .addBinding(sun, "distance", { label: "Distance", min: 0, max: 3, step: 0.01 }),
  ];
  sunBindings[0]!.element.title = "Source direction: 0° up · 90° right · ±180° down · −90° left";
  sunBindings[1]!.element.title =
    "Source distance from the centre: 1 at the orb edge; larger values place it outside";
  for (const binding of sunBindings) {
    binding.on("change", () => {
      if (syncing) return;
      const position = sunCartesian(sun.direction, sun.distance);
      handlers.onSunPosition(position.x, position.y);
    });
    binding.element.addEventListener("contextmenu", (event) => {
      if (!editing) return;
      event.preventDefault();
      handlers.onClear(["light.x", "light.y"]);
    });
  }

  const clear = pane.addButton({ title: "Clear this state's overrides" });
  clear.on("click", () => handlers.onClear());

  const output = pane.addFolder({ title: "Canvas", expanded: false });
  output
    .addBinding(canvas, "size", { label: "Size", min: 0.1, max: 1, step: 0.01 })
    .on("change", (ev) => {
      if (!syncing) handlers.onCanvas({ size: ev.value });
    });
  output
    .addBinding(canvas, "quality", { label: "Quality", min: 0.25, max: 1, step: 0.05 })
    .on("change", (ev) => {
      if (!syncing) handlers.onCanvas({ quality: ev.value });
    });
  const background = output.addBlade({
    view: "list",
    label: "Background",
    options: [
      { text: "transparent", value: "transparent" },
      { text: "white", value: "#ffffff" },
      { text: "black", value: "#000000" },
    ],
    value: "transparent",
  }) as ListBladeApi<string>;
  background.on("change", (ev) => {
    if (!syncing) handlers.onCanvas({ background: ev.value });
  });

  function addDial(folder: FolderApi, dial: Dial): void {
    values[dial.key] = dial.kind === "color" ? "#000000" : dial.kind === "boolean" ? true : 0;
    const binding =
      dial.kind !== "number"
        ? folder.addBinding(values, dial.key, { label: dial.label })
        : folder.addBinding(values, dial.key, {
            label: dial.label,
            min: dial.min,
            max: dial.max,
            step: dial.step,
          });
    let editor: ColorEditor | undefined;
    if (dial.kind === "color") {
      editor = new ColorEditor(`${folder.title} ${dial.label}`, (value, last) => {
        if (syncing) return;
        handlers.onDial(dial.key, value, last);
      });
      binding.element.querySelector(".tp-lblv_v")?.replaceChildren(editor.button);
    }
    binding.on("change", (ev) => {
      if (syncing) return;
      handlers.onDial(dial.key, ev.value as number | string | boolean, ev.last);
      if (editing) binding.label = dial.label + MARK;
    });
    if (dial.hint) binding.element.title = dial.hint;
    // A right click on an overridden dial hands it back to the base.
    binding.element.addEventListener("contextmenu", (event) => {
      if (!editing) return;
      event.preventDefault();
      handlers.onClear(dial.key);
    });
    bindings.set(dial.key, { dial, binding, ...(editor ? { editor } : {}) });
  }

  /** The contents' dials, in a folder of their own after the transition. */
  function showContents(type: ContentsType): void {
    if (shown === type) return;
    shown = type;
    if (contentsFolder) {
      contentsFolder.dispose();
      for (const [key, { dial, editor }] of bindings) {
        if (!GLASS_DIALS.includes(dial)) {
          editor?.destroy();
          bindings.delete(key);
          delete values[key];
        }
      }
    }
    contentsFolder = null;
    const dials = CONTENTS[type].dials;
    if (dials.length === 0) return;
    contentsFolder = pane.addFolder({ title: CONTENTS[type].label, expanded: true, index: 3 });
    const groups = new Map<string, FolderApi>();
    for (const dial of dials) {
      if (dial.key.startsWith("contents.sky.stops.")) continue;
      let folder = groups.get(dial.group);
      if (!folder) {
        folder = contentsFolder.addFolder({ title: dial.group, expanded: groups.size < 2 });
        groups.set(dial.group, folder);
      }
      addDial(folder, dial);
    }
  }

  return {
    refresh(config, nextEditing, presetName) {
      syncing = true;
      shownConfig = config;
      weatherView.value = config.weather.view;
      editing = nextEditing;
      showContents(config.contents.type);
      const override = editing ? (config.states[editing] ?? {}) : {};
      const setting = (key: string): unknown =>
        getDialValue(override, key) ?? getDialValue(config, key);
      const airInUse =
        config.weather.view !== "orb" &&
        ((setting("weather.rain.enabled") && Number(setting("weather.rain.density")) > 0) ||
          (setting("weather.snow.enabled") &&
            Number(setting("weather.snow.density")) > 0 &&
            (Number(setting("weather.snow.amount")) > 0 ||
              Number(setting("weather.snow.react")) > 0)) ||
          (setting("weather.hail.enabled") &&
            Number(setting("weather.hail.amount")) > 0 &&
            Number(setting("weather.hail.density")) > 0));
      Object.assign(
        sun,
        sunPolar({
          x: override.light?.x ?? config.light.x,
          y: override.light?.y ?? config.light.y,
        }),
      );
      const sunOwn = override.light?.x !== undefined || override.light?.y !== undefined;
      sunBindings[0]!.label = "Direction (°)" + (sunOwn ? MARK : "");
      sunBindings[1]!.label = "Distance" + (sunOwn ? MARK : "");
      for (const [key, { dial, binding, editor }] of bindings) {
        const own = getDialValue(override, key);
        const value = own ?? getDialValue(config, key);
        const effect = /^weather\.([^.]+)\./.exec(key)?.[1];
        const enableKey = effect ? `weather.${effect}.enabled` : "";
        const enabled = getDialValue(override, enableKey) ?? getDialValue(config, enableKey);
        const inactive =
          (key !== enableKey && enabled === false) || (key.startsWith("weather.air.") && !airInUse);
        binding.disabled = inactive;
        if (editor) editor.button.disabled = inactive;
        values[key] =
          dial.kind === "color"
            ? fillHex(value as ColorValue)
            : (value as number | string | boolean);
        if (editor) editor.refresh(value as ColorValue);
        binding.label = dial.label + (own === undefined ? "" : MARK);
      }
      kind.value = config.contents.type;
      canvas.size = config.size;
      canvas.quality = config.quality;
      canvas.duration = editing
        ? (config.states[editing]?.duration ?? config.transition.duration)
        : config.transition.duration;
      timing.label = editing ? `Into ${editing} (s)` : "Transition (s)";
      background.value = ["transparent", "#ffffff", "#000000"].includes(config.background)
        ? config.background
        : "transparent";
      preset.value = presetName;
      clear.hidden = !editing;
      pane.refresh();
      syncing = false;
    },
  };
}
