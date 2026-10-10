/**
 * The undo and redo buttons and the version history, docked in the panel's header.
 *
 * Docked beside the title rather than floating over the stage: the stage holds the orb being
 * designed, and a control parked on it covers the work.
 *
 * Only a view: it draws a {@link HistoryState} and reports what was asked for through hooks; the
 * timeline lives in `History` (history.ts). Its styles are in style.css, under "History".
 */

import type { HistoryState } from "./history";

/** Where each version's thumbnail comes from (a `HistoryThumbnailer`). */
interface ThumbSource {
  cached(id: number): string | undefined;
  request(id: number, done: (url: string | null) => void): void;
}

export interface HistoryControlsHooks {
  onUndo(): void;
  onRedo(): void;
  onJump(id: number): void;
  /** Start the timeline over from the live version, which stays as it is. */
  onClear(): void;
  /** A thumbnail per version; without it the rows are text. */
  thumb?: ThumbSource;
}

const isMac = /Mac/i.test(navigator.userAgent);
const UNDO_TIP = isMac ? "Undo · ⌘Z" : "Undo · Ctrl+Z";
const REDO_TIP = isMac ? "Redo · ⇧⌘Z" : "Redo · Ctrl+Y";

// Inline line icons, so nothing waits on an icon font or the network.
const ICON = {
  undo: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  redo: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
  list: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>',
};

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Text for `innerHTML`, attribute context included: a version can be named after a state. */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

function relTime(t: number): string {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function iconButton(act: string, icon: string, label: string, tip: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "hist-btn";
  button.dataset.act = act;
  button.innerHTML = icon;
  button.setAttribute("aria-label", label);
  button.dataset.tip = tip;
  return button;
}

export class HistoryControls {
  readonly #hooks: HistoryControlsHooks;
  readonly #undo: HTMLButtonElement;
  readonly #redo: HTMLButtonElement;
  readonly #toggle: HTMLButtonElement;
  readonly #panel: HTMLDivElement;
  readonly #clear: HTMLButtonElement;
  readonly #list: HTMLUListElement;
  #open = false;
  #state: HistoryState = { canUndo: false, canRedo: false, entries: [] };
  #tick = 0;
  #scrollFrame = 0;

  constructor(host: HTMLElement, hooks: HistoryControlsHooks) {
    this.#hooks = hooks;
    const root = document.createElement("div");
    root.className = "hist";

    // The list is a popover hanging from the cluster, over the panel below it.
    this.#panel = document.createElement("div");
    this.#panel.className = "hist-panel";
    this.#panel.hidden = true;
    const head = document.createElement("div");
    head.className = "hist-head";
    const title = document.createElement("span");
    title.textContent = "History";
    this.#clear = document.createElement("button");
    this.#clear.type = "button";
    this.#clear.className = "hist-clear";
    this.#clear.dataset.act = "clear";
    this.#clear.textContent = "Clear";
    head.append(title, this.#clear);
    this.#list = document.createElement("ul");
    this.#list.className = "hist-list";
    this.#panel.append(head, this.#list);

    const bar = document.createElement("div");
    bar.className = "hist-bar";
    this.#undo = iconButton("undo", ICON.undo, "Undo", UNDO_TIP);
    this.#redo = iconButton("redo", ICON.redo, "Redo", REDO_TIP);
    this.#toggle = iconButton("toggle", ICON.list, "Version history", "Version history");
    this.#toggle.setAttribute("aria-expanded", "false");
    bar.append(this.#undo, this.#redo, this.#toggle);

    root.append(this.#panel, bar);
    root.addEventListener("click", this.#onClick);
    if (hooks.thumb) this.#list.addEventListener("scroll", this.#onScroll);
    // Clicking anywhere else, or Escape, puts the list away.
    document.addEventListener("pointerdown", (event) => {
      if (this.#open && !root.contains(event.target as Node)) this.#setOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (this.#open && event.key === "Escape") this.#setOpen(false);
    });
    host.append(root);
    this.#render();
  }

  update(state: HistoryState): void {
    this.#state = state;
    this.#render();
  }

  #onClick = (event: MouseEvent): void => {
    const button = (event.target as HTMLElement).closest("button");
    if (!button || button.getAttribute("aria-disabled") === "true") return;
    const act = button.dataset.act;
    if (act === "undo") this.#hooks.onUndo();
    else if (act === "redo") this.#hooks.onRedo();
    else if (act === "toggle") this.#setOpen(!this.#open);
    else if (act === "clear") this.#hooks.onClear();
    else if (button.dataset.id) this.#hooks.onJump(Number(button.dataset.id));
  };

  #setOpen(open: boolean): void {
    this.#open = open;
    this.#panel.hidden = !open;
    this.#toggle.setAttribute("aria-expanded", String(open));
    this.#toggle.classList.toggle("is-active", open);
    clearInterval(this.#tick);
    this.#tick = open ? window.setInterval(() => this.#refreshTimes(), 20000) : 0;
    this.#render();
  }

  #render(): void {
    this.#disable(this.#undo, !this.#state.canUndo);
    this.#disable(this.#redo, !this.#state.canRedo);
    // Nothing to clear while the timeline is only where it started.
    this.#disable(this.#clear, this.#state.entries.length <= 1);
    if (!this.#open) return;
    // The newest, current version at the top.
    const rows: string[] = [];
    for (let i = this.#state.entries.length - 1; i >= 0; i--) {
      const entry = this.#state.entries[i]!;
      rows.push(
        `<li><button type="button" class="hist-row${entry.current ? " is-current" : ""}" data-id="${entry.id}"` +
          `${entry.current ? ' aria-current="true"' : ""}>` +
          (this.#hooks.thumb ? `<span class="hist-thumb"></span>` : "") +
          `<span class="hist-label">${escapeHtml(entry.label)}</span>` +
          `<span class="hist-time">${relTime(entry.time)}</span>` +
          `</button></li>`,
      );
    }
    this.#list.innerHTML = rows.join("") || '<li class="hist-empty">Edits appear here</li>';
    this.#fillThumbs();
  }

  #onScroll = (): void => {
    if (this.#scrollFrame) return;
    this.#scrollFrame = requestAnimationFrame(() => {
      this.#scrollFrame = 0;
      this.#fillThumbs();
    });
  };

  /**
   * Thumbnails for the rows in or near view: from the cache at once, otherwise drawn when asked.
   * Measured rather than observed, so it works while the tab is in the background, and lazy: a row
   * nobody scrolls to is never drawn.
   */
  #fillThumbs(): void {
    const thumb = this.#hooks.thumb;
    if (!thumb || !this.#open) return;
    const view = this.#list.getBoundingClientRect();
    const margin = 80;
    for (const row of this.#list.querySelectorAll<HTMLElement>(".hist-row")) {
      const id = Number(row.dataset.id);
      const cached = thumb.cached(id);
      if (cached) {
        this.#setThumb(row, cached);
        continue;
      }
      if (row.dataset.requested) continue;
      const rect = row.getBoundingClientRect();
      if (rect.bottom < view.top - margin || rect.top > view.bottom + margin) continue;
      row.dataset.requested = "";
      thumb.request(id, (url) => {
        if (!url) return;
        const now = this.#list.querySelector<HTMLElement>(`.hist-row[data-id="${id}"]`);
        if (now) this.#setThumb(now, url);
      });
    }
  }

  #setThumb(row: HTMLElement, url: string): void {
    const el = row.querySelector<HTMLElement>(".hist-thumb");
    if (el) el.style.backgroundImage = `url("${url}")`;
  }

  /** Only the times, so the tick never redraws a thumbnail. */
  #refreshTimes(): void {
    for (const row of this.#list.querySelectorAll<HTMLElement>(".hist-row")) {
      const entry = this.#state.entries.find((e) => e.id === Number(row.dataset.id));
      const time = row.querySelector(".hist-time");
      if (entry && time) time.textContent = relTime(entry.time);
    }
  }

  // aria-disabled rather than `disabled`, so the shortcut's tooltip still shows while the action
  // is unavailable.
  #disable(button: HTMLButtonElement, disabled: boolean): void {
    button.setAttribute("aria-disabled", String(disabled));
    button.classList.toggle("is-disabled", disabled);
  }
}
