import {
  COLOR_POINTS,
  gradientColor,
  normalizeFill,
  sampleFill,
  fillHex,
  toHex,
  type ColorValue,
  type GradientColor,
  type GradientType,
} from "@orb3d/core";

const MODES = ["Solid", "Linear", "Radial", "Conic", "Mesh"] as const;
const clamp = (v: number): number => Math.min(1, Math.max(0, v));
let nextId = 0;

/** A shared editor for every colour dial, following wave3d's movable mesh/stop picker. */
export class ColorEditor {
  readonly button = document.createElement("button");
  readonly #popover = document.createElement("div");
  readonly #swatch = document.createElement("canvas");
  readonly #field = document.createElement("div");
  readonly #canvas = document.createElement("canvas");
  readonly #mode = document.createElement("select");
  readonly #color = document.createElement("input");
  readonly #hex = document.createElement("input");
  readonly #controls = document.createElement("div");
  readonly #add = document.createElement("button");
  readonly #remove = document.createElement("button");
  readonly #value = document.createElement("span");
  readonly #emit: (value: ColorValue, last: boolean) => void;
  #fill: ColorValue = "#000000";
  #cached?: GradientColor;
  #meshSeen = false;
  #selected = 0;
  #handles: HTMLButtonElement[] = [];
  #drag: number | null = null;
  #raf = 0;
  #shape = "";
  #swatchPainted = "";
  #fieldPainted = "";

  constructor(label: string, emit: (value: ColorValue, last: boolean) => void) {
    this.#emit = emit;
    this.button.type = "button";
    this.button.className = "color-launch";
    this.button.setAttribute("aria-label", `${label} editor`);
    this.button.setAttribute("aria-haspopup", "dialog");
    this.#swatch.width = 64;
    this.#swatch.height = 20;
    this.#swatch.setAttribute("aria-hidden", "true");
    this.button.append(this.#swatch, this.#value);
    this.#popover.className = "color-editor";
    this.#popover.id = `color-editor-${++nextId}`;
    this.#popover.setAttribute("role", "dialog");
    this.#popover.setAttribute("aria-label", `${label} editor`);
    this.#popover.setAttribute("popover", "auto");
    this.button.setAttribute("popovertarget", this.#popover.id);
    const heading = document.createElement("div");
    heading.className = "color-heading";
    const title = document.createElement("strong");
    title.textContent = label;
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close colour editor");
    close.addEventListener("click", () => this.#close());
    heading.append(title, close);
    this.#mode.setAttribute("aria-label", "Colour mode");
    for (const mode of MODES) {
      const option = document.createElement("option");
      option.value = mode.toLowerCase();
      option.textContent = mode;
      this.#mode.append(option);
    }
    this.#mode.addEventListener("change", () => {
      const type = this.#mode.value;
      if (type === "solid") {
        if (typeof this.#fill !== "string") this.#cached = this.#fill;
        this.#fill = fillHex(this.#fill);
      } else {
        const old = this.#fill;
        const next =
          typeof old === "string"
            ? (this.#cached ?? gradientColor(type as GradientType, old))
            : old;
        if (type === "mesh" && !this.#meshSeen)
          next.points = next.points.map((point) => ({
            ...point,
            color: toHex(sampleFill(old, point.x, point.y)),
          }));
        if (type === "mesh") this.#meshSeen = true;
        this.#fill = { ...next, type: type as GradientType };
      }
      this.#selected = 0;
      this.#shape = "";
      this.#changed(true);
    });
    this.#field.className = "color-field";
    this.#field.setAttribute("aria-label", "Gradient points");
    this.#canvas.width = 160;
    this.#canvas.height = 112;
    this.#canvas.setAttribute("aria-hidden", "true");
    this.#field.append(this.#canvas);
    this.#field.addEventListener("dblclick", (event) => {
      if (event.target === this.#canvas) this.#insert(this.#position(event));
    });
    this.#color.type = "color";
    this.#color.setAttribute("aria-label", "Selected colour");
    this.#hex.type = "text";
    this.#hex.className = "color-hex";
    this.#hex.setAttribute("aria-label", "Hex colour");
    this.#hex.spellcheck = false;
    for (const input of [this.#color, this.#hex]) {
      const update = (last: boolean): void => {
        const value = normalizeFill(input.value, this.#selectedColor());
        if (typeof value !== "string") return;
        if (typeof this.#fill === "string") this.#fill = value;
        else if (this.#fill.type === "mesh") this.#fill.points[this.#selected]!.color = value;
        else this.#fill.stops[this.#selected]!.color = value;
        this.#changed(last);
      };
      if (input === this.#color) input.addEventListener("input", () => update(false));
      input.addEventListener("change", () => update(true));
    }
    const row = document.createElement("div");
    row.className = "color-row";
    this.#add.type = this.#remove.type = "button";
    this.#add.textContent = "+";
    this.#add.setAttribute("aria-label", "Add colour point");
    this.#remove.textContent = "−";
    this.#remove.setAttribute("aria-label", "Remove selected colour point");
    this.#add.addEventListener("click", () => this.#insert());
    this.#remove.addEventListener("click", () => this.#delete());
    row.append(this.#color, this.#hex, this.#add, this.#remove);
    this.#controls.className = "color-controls";
    const help = document.createElement("p");
    help.className = "color-help";
    help.textContent = "Drag points · double-click to add · arrows move · Delete removes";
    this.#popover.append(heading, this.#mode, this.#field, row, this.#controls, help);
    document.body.append(this.#popover);
    this.button.addEventListener("click", () => {
      this.#render();
      this.#place();
      if (typeof this.#popover.showPopover !== "function") {
        this.#popover.hidden = !this.#popover.hidden;
        this.button.setAttribute("aria-expanded", String(!this.#popover.hidden));
      }
    });
    this.#popover.addEventListener("toggle", (event) => {
      const open = (event as ToggleEvent).newState === "open";
      this.button.setAttribute("aria-expanded", String(open));
      if (open) {
        this.#place();
        this.#render();
        this.#mode.focus();
      } else if (this.#popover.contains(document.activeElement)) this.button.focus();
    });
    this.#popover.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.#close();
    });
    if (typeof this.#popover.showPopover !== "function") this.#popover.hidden = true;
  }
  refresh(value: ColorValue): void {
    if (this.#drag === null) this.#fill = structuredClone(value);
    if (typeof value !== "string" && value.type === "mesh") this.#meshSeen = true;
    this.#render();
  }
  destroy(): void {
    cancelAnimationFrame(this.#raf);
    this.#popover.remove();
    this.button.remove();
  }
  #close(): void {
    if (typeof this.#popover.hidePopover === "function") this.#popover.hidePopover();
    else this.#popover.hidden = true;
    this.button.focus();
  }
  #place(): void {
    const rect = this.button.getBoundingClientRect();
    this.#popover.style.left = `${Math.max(12, Math.min(rect.left - 340, window.innerWidth - 352))}px`;
    this.#popover.style.top = `${Math.max(12, Math.min(rect.top, window.innerHeight - 530))}px`;
  }
  #selectedColor(): string {
    return typeof this.#fill === "string"
      ? this.#fill
      : this.#fill.type === "mesh"
        ? (this.#fill.points[this.#selected]?.color ?? "#000000")
        : (this.#fill.stops[this.#selected]?.color ?? "#000000");
  }
  #position(event: MouseEvent): [number, number] {
    const rect = this.#field.getBoundingClientRect();
    return [
      clamp((event.clientX - rect.left) / rect.width),
      clamp(1 - (event.clientY - rect.top) / rect.height),
    ];
  }
  #changed(last: boolean): void {
    this.#render();
    this.#emit(normalizeFill(this.#fill), last);
  }
  #insert(position?: [number, number]): void {
    if (typeof this.#fill === "string") return;
    const mesh = this.#fill.type === "mesh",
      nodes = mesh ? this.#fill.points : this.#fill.stops;
    if (nodes.length >= COLOR_POINTS) return;
    if (mesh) {
      const [x, y] = position ?? [0.5, 0.5];
      this.#fill.points.push({ x, y, color: toHex(sampleFill(this.#fill, x, y)), influence: 0.65 });
    } else {
      const stops = this.#fill.stops;
      let place = 0.5,
        gap = 0;
      for (let i = 1; i < stops.length; i++)
        if (stops[i]!.position - stops[i - 1]!.position > gap) {
          gap = stops[i]!.position - stops[i - 1]!.position;
          place = (stops[i]!.position + stops[i - 1]!.position) / 2;
        }
      place = position?.[0] ?? place;
      this.#fill.stops.push({ position: place, color: this.#selectedColor() });
    }
    this.#selected = nodes.length - 1;
    this.#shape = "";
    this.#changed(true);
  }
  #delete(): void {
    if (typeof this.#fill === "string") return;
    const nodes = this.#fill.type === "mesh" ? this.#fill.points : this.#fill.stops;
    if (nodes.length <= 2) return;
    nodes.splice(this.#selected, 1);
    this.#selected = Math.min(this.#selected, nodes.length - 1);
    this.#shape = "";
    this.#changed(true);
  }
  #nudge(dx: number, dy: number): void {
    if (typeof this.#fill === "string") return;
    if (this.#fill.type === "mesh") {
      const p = this.#fill.points[this.#selected]!;
      p.x = clamp(p.x + dx);
      p.y = clamp(p.y + dy);
    } else
      this.#fill.stops[this.#selected]!.position = clamp(
        this.#fill.stops[this.#selected]!.position + dx,
      );
  }
  #paint(canvas: HTMLCanvasElement): void {
    const context = canvas.getContext("2d");
    if (!context) return;
    if (typeof this.#fill === "string") {
      context.fillStyle = this.#fill;
      context.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const image = context.createImageData(canvas.width, canvas.height),
      fill = normalizeFill(this.#fill);
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        const color = sampleFill(fill, x / (canvas.width - 1), 1 - y / (canvas.height - 1)),
          at = (y * canvas.width + x) * 4;
        for (let i = 0; i < 3; i++) image.data[at + i] = Math.round(color[i]! * 255);
        image.data[at + 3] = 255;
      }
    context.putImageData(image, 0, 0);
  }
  #render(): void {
    const signature = JSON.stringify(this.#fill);
    if (signature !== this.#swatchPainted) {
      this.#paint(this.#swatch);
      this.#swatchPainted = signature;
    }
    const mode = typeof this.#fill === "string" ? "solid" : this.#fill.type;
    this.#value.textContent =
      mode === "solid" ? fillHex(this.#fill) : mode[0]!.toUpperCase() + mode.slice(1);
    this.#mode.value = mode;
    const nodes =
      typeof this.#fill === "string" ? [] : mode === "mesh" ? this.#fill.points : this.#fill.stops;
    this.#selected = Math.min(this.#selected, Math.max(0, nodes.length - 1));
    const shape = `${mode}:${nodes.length}`;
    if (shape !== this.#shape) {
      this.#shape = shape;
      for (const handle of this.#handles) handle.remove();
      this.#handles = nodes.map((_, i) => {
        const handle = document.createElement("button");
        handle.type = "button";
        handle.className = "color-point";
        handle.setAttribute(
          "aria-label",
          `${mode === "mesh" ? "Mesh point" : "Gradient stop"} ${i + 1}`,
        );
        handle.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          this.#selected = i;
          this.#drag = event.pointerId;
          handle.setPointerCapture(event.pointerId);
          this.#render();
        });
        handle.addEventListener("pointermove", (event) => {
          if (this.#drag !== event.pointerId || typeof this.#fill === "string") return;
          const [x, y] = this.#position(event);
          if (this.#fill.type === "mesh") {
            const p = this.#fill.points[i]!;
            p.x = x;
            p.y = y;
          } else this.#fill.stops[i]!.position = x;
          if (!this.#raf)
            this.#raf = requestAnimationFrame(() => {
              this.#raf = 0;
              this.#changed(false);
            });
        });
        const end = (event: PointerEvent): void => {
          if (this.#drag !== event.pointerId) return;
          cancelAnimationFrame(this.#raf);
          this.#raf = 0;
          this.#drag = null;
          this.#changed(true);
        };
        handle.addEventListener("pointerup", end);
        handle.addEventListener("pointercancel", end);
        handle.addEventListener("lostpointercapture", end);
        handle.addEventListener("click", () => {
          this.#selected = i;
          this.#render();
        });
        handle.addEventListener("keydown", (event) => {
          this.#selected = i;
          const step = event.shiftKey ? 0.05 : 0.01;
          const delta: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, step],
            ArrowDown: [0, -step],
          };
          if (delta[event.key]) {
            event.preventDefault();
            this.#nudge(...delta[event.key]!);
            this.#changed(true);
          } else if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            this.#delete();
          }
        });
        this.#field.append(handle);
        return handle;
      });
      this.#controls.replaceChildren();
      if (typeof this.#fill !== "string") {
        const control = (
          label: string,
          min: number,
          max: number,
          step: number,
          read: () => number,
          write: (v: number) => void,
        ): void => {
          const row = document.createElement("label"),
            text = document.createElement("span"),
            input = document.createElement("input");
          text.textContent = label;
          input.type = "number";
          input.min = String(min);
          input.max = String(max);
          input.step = String(step);
          input.setAttribute("aria-label", label);
          input.dataset.control = label;
          input.addEventListener("change", () => {
            write(Math.min(max, Math.max(min, Number(input.value) || 0)));
            this.#changed(true);
          });
          row.append(text, input);
          this.#controls.append(row);
          input.value = String(read());
        };
        if (mode === "mesh") {
          control(
            "Softness",
            0,
            1,
            0.01,
            () => (this.#fill as GradientColor).softness,
            (v) => {
              (this.#fill as GradientColor).softness = v;
            },
          );
          control(
            "Influence",
            0.05,
            1.5,
            0.01,
            () => (this.#fill as GradientColor).points[this.#selected]!.influence,
            (v) => {
              (this.#fill as GradientColor).points[this.#selected]!.influence = v;
            },
          );
          for (const [axis, label] of [
            ["x", "Point X"],
            ["y", "Point Y"],
          ] as const)
            control(
              label,
              0,
              1,
              0.01,
              () => (this.#fill as GradientColor).points[this.#selected]![axis],
              (v) => {
                (this.#fill as GradientColor).points[this.#selected]![axis] = v;
              },
            );
        } else {
          control(
            "Stop position",
            0,
            1,
            0.01,
            () => (this.#fill as GradientColor).stops[this.#selected]!.position,
            (v) => {
              (this.#fill as GradientColor).stops[this.#selected]!.position = v;
            },
          );
          control(
            "Angle (°)",
            -180,
            180,
            1,
            () => (this.#fill as GradientColor).angle,
            (v) => {
              (this.#fill as GradientColor).angle = v;
            },
          );
          control(
            "Scale",
            0.05,
            4,
            0.01,
            () => (this.#fill as GradientColor).scale,
            (v) => {
              (this.#fill as GradientColor).scale = v;
            },
          );
          for (const [axis, label] of [
            [0, "Centre X"],
            [1, "Centre Y"],
          ] as const)
            control(
              label,
              0,
              1,
              0.01,
              () => (this.#fill as GradientColor).center[axis],
              (v) => {
                (this.#fill as GradientColor).center[axis] = v;
              },
            );
        }
      }
    }
    for (let i = 0; i < this.#handles.length; i++) {
      const p = nodes[i]!,
        handle = this.#handles[i]!;
      handle.style.left = `${("x" in p ? p.x : p.position) * 100}%`;
      handle.style.top = `${("y" in p ? 1 - p.y : 0.85) * 100}%`;
      handle.style.background = p.color;
      handle.setAttribute("aria-pressed", String(i === this.#selected));
    }
    this.#color.value = this.#hex.value = this.#selectedColor();
    this.#add.hidden = this.#remove.hidden = this.#field.hidden = mode === "solid";
    this.#add.disabled = nodes.length >= COLOR_POINTS;
    this.#remove.disabled = nodes.length <= 2;
    // Keep editors cheap while closed; the compact swatch is enough for the control panel.
    if (
      (typeof this.#popover.showPopover === "function"
        ? this.#popover.matches(":popover-open")
        : !this.#popover.hidden) &&
      signature !== this.#fieldPainted
    ) {
      this.#paint(this.#canvas);
      this.#fieldPainted = signature;
    }
    if (typeof this.#fill !== "string")
      for (const input of this.#controls.querySelectorAll<HTMLInputElement>("input")) {
        const p = this.#fill.points[this.#selected],
          stop = this.#fill.stops[this.#selected];
        const values: Record<string, number> = {
          Softness: this.#fill.softness,
          Influence: p?.influence ?? 0.65,
          "Point X": p?.x ?? 0.5,
          "Point Y": p?.y ?? 0.5,
          "Stop position": stop?.position ?? 0,
          "Angle (°)": this.#fill.angle,
          Scale: this.#fill.scale,
          "Centre X": this.#fill.center[0],
          "Centre Y": this.#fill.center[1],
        };
        if (document.activeElement !== input)
          input.value = String(Math.round(values[input.dataset.control!]! * 1000) / 1000);
      }
  }
}
