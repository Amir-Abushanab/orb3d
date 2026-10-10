import { orbFrame } from "@orb3d/core/program";
import type { OrbConfig } from "@orb3d/core";

export interface SunPosition {
  x: number;
  y: number;
}

/** Direction is clockwise from up; distance is in orb-radius units. */
export function sunPolar({ x, y }: SunPosition): { direction: number; distance: number } {
  return { direction: (Math.atan2(x, y) * 180) / Math.PI, distance: Math.hypot(x, y) };
}

export function sunCartesian(direction: number, distance: number): SunPosition {
  const angle = (direction * Math.PI) / 180;
  return { x: Math.sin(angle) * distance, y: Math.cos(angle) * distance };
}

export function createSunControl(
  area: HTMLElement,
  orb: HTMLElement,
  toggle: HTMLButtonElement,
  handlers: {
    onStart(): void;
    onChange(position: SunPosition): void;
    onEnd(): void;
  },
): { refresh(config: OrbConfig, editing: string | null): void } {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "sun-handle";
  handle.textContent = "☀";
  handle.hidden = true;
  const help = document.createElement("p");
  help.className = "sun-help";
  help.textContent = "Drag the sun · Arrow keys move · Shift for larger steps";
  help.hidden = true;
  area.append(handle, help);
  let position: SunPosition = { x: 0, y: 0 };
  let config: OrbConfig;
  let state = "idle";
  let pointer: { id: number; x: number; y: number; start: SunPosition } | null = null;
  let keyGesture = false;
  const radius = (): number =>
    config
      ? config.weather.view === "orb"
        ? orbFrame(config, orb.clientWidth, orb.clientHeight, state).radius
        : orb.clientHeight / 2
      : 1;
  function place(): void {
    const box = orb.getBoundingClientRect();
    const bounds = area.getBoundingClientRect();
    const r = radius();
    const frame =
      config.weather.view === "orb"
        ? orbFrame(config, box.width, box.height, state)
        : { x: box.width / 2, y: box.height / 2 };
    const x = box.left + frame.x - bounds.left + position.x * r;
    const y = box.top + box.height - frame.y - bounds.top - position.y * r;
    // Keep a source outside the visible preview reachable at its edge.
    handle.style.left = `${Math.min(Math.max(24, x), bounds.width - 24)}px`;
    handle.style.top = `${Math.min(Math.max(24, y), bounds.height - 24)}px`;
    handle.setAttribute(
      "aria-label",
      `Sun position, X ${position.x.toFixed(2)}, Y ${position.y.toFixed(2)}. Use arrow keys to move.`,
    );
    handle.title = `Sun position: X ${position.x.toFixed(2)}, Y ${position.y.toFixed(2)}`;
  }
  function move(next: SunPosition): void {
    handlers.onChange({
      x: Math.max(-3, Math.min(3, next.x)),
      y: Math.max(-3, Math.min(3, next.y)),
    });
  }
  toggle.addEventListener("click", () => {
    const visible = handle.hidden;
    handle.hidden = !visible;
    help.hidden = !visible;
    toggle.setAttribute("aria-pressed", String(visible));
    place();
    if (visible) handle.focus({ preventScroll: true });
  });
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || pointer) return;
    handlers.onStart();
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, start: { ...position } };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const r = radius();
    move({
      x: pointer.start.x + (event.clientX - pointer.x) / r,
      y: pointer.start.y - (event.clientY - pointer.y) / r,
    });
  });
  function endPointer(event: PointerEvent): void {
    if (!pointer || event.pointerId !== pointer.id) return;
    pointer = null;
    handlers.onEnd();
  }
  handle.addEventListener("pointerup", endPointer);
  handle.addEventListener("pointercancel", endPointer);
  handle.addEventListener("lostpointercapture", endPointer);
  handle.addEventListener("keydown", (event) => {
    const delta: Record<string, SunPosition> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: 1 },
      ArrowDown: { x: 0, y: -1 },
    };
    const direction = delta[event.key];
    if (!direction) return;
    event.preventDefault();
    if (!keyGesture) {
      handlers.onStart();
      keyGesture = true;
    }
    const step = event.shiftKey ? 0.2 : 0.05;
    move({ x: position.x + direction.x * step, y: position.y + direction.y * step });
  });
  function endKeys(): void {
    if (!keyGesture) return;
    keyGesture = false;
    handlers.onEnd();
  }
  handle.addEventListener("keyup", endKeys);
  handle.addEventListener("blur", endKeys);
  const observer = new ResizeObserver(place);
  observer.observe(area);
  observer.observe(orb);
  return {
    refresh(nextConfig, editing) {
      config = nextConfig;
      state = editing ?? config.state;
      const override = editing ? config.states[editing]?.light : undefined;
      position = { x: override?.x ?? config.light.x, y: override?.y ?? config.light.y };

      place();
    },
  };
}
