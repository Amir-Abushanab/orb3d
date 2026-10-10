// The contents' own tools, at the top of the panel: what a dial cannot hold, a picture or clip's
// source (a URL, a file, or a sample) and how it fits. A shader's code has a drawer of its own
// under the orb (code.ts).
import type { ContentsType, OrbConfig } from "@orb3d/core";

export interface ContentsToolsHandlers {
  /** Change part of the contents' structure: `src` or `fit`. */
  onChange(patch: Record<string, unknown>): void;
  /** Put a sample picture or clip in the glass. */
  onSample(type: Extract<ContentsType, "image" | "video">, src: string): void;
  toast(message: string): void;
}

export interface ContentsTools {
  refresh(config: OrbConfig): void;
}

/** A picture this small is kept in the document as a data URL, so it survives a reload. */
const KEEP_BYTES = 1.5 * 1024 * 1024;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children);
  return el;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("read failed")));
    reader.readAsDataURL(file);
  });
}

export function createContentsTools(
  container: HTMLElement,
  handlers: ContentsToolsHandlers,
): ContentsTools {
  // A picture or a clip.
  const source = element("input", {
    type: "url",
    placeholder: "https://… an image or video URL",
    spellcheck: false,
  });
  source.setAttribute("aria-label", "Source");
  const file = element("input", { type: "file", hidden: true });
  const choose = element("button", { type: "button", textContent: "Choose a file…" });
  const sample = element("button", { type: "button", textContent: "Sample" });
  const cover = element("button", { type: "button", textContent: "Cover" });
  const contain = element("button", { type: "button", textContent: "Contain" });
  const fit = element("div", { className: "segmented" }, cover, contain);
  fit.setAttribute("role", "radiogroup");
  fit.setAttribute("aria-label", "Fit");
  const media = element(
    "section",
    { className: "tool" },
    element("h2", { textContent: "Source" }),
    source,
    element("div", { className: "row" }, choose, sample, fit),
    file,
  );

  container.append(media);
  let kind: ContentsType = "none";

  source.addEventListener("change", () => handlers.onChange({ src: source.value.trim() }));
  choose.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const picked = file.files?.[0];
    file.value = "";
    if (!picked) return;
    const video = picked.type.startsWith("video/");
    if (!video && !picked.type.startsWith("image/")) {
      handlers.toast("That is neither a picture nor a clip.");
      return;
    }
    let src: string;
    if (!video && picked.size <= KEEP_BYTES) {
      src = await readAsDataUrl(picked);
    } else {
      // Earlier files still belong to undo history. The browser releases these on unload.
      src = URL.createObjectURL(picked);
      handlers.toast("This file lasts until you reload: host it and paste its URL to keep it.");
    }
    const wanted = video ? "video" : "image";
    if (kind === wanted) handlers.onChange({ src });
    else handlers.onSample(wanted, src);
  });
  sample.addEventListener("click", () => {
    const type = kind === "video" ? "video" : "image";
    handlers.onSample(type, type === "video" ? "/samples/lake.mp4" : "/samples/lake.jpg");
  });
  cover.addEventListener("click", () => handlers.onChange({ fit: "cover" }));
  contain.addEventListener("click", () => handlers.onChange({ fit: "contain" }));

  return {
    refresh(config) {
      const { contents } = config;
      kind = contents.type;
      const isMedia = contents.type === "image" || contents.type === "video";
      container.hidden = !isMedia;
      if (isMedia) {
        const local = /^(?:data|blob):/.test(contents.src);
        if (document.activeElement !== source) source.value = local ? "" : contents.src;
        source.placeholder = local
          ? "your file: paste a URL to replace it"
          : `https://… ${contents.type === "video" ? "a video" : "an image"} URL`;
        file.accept = contents.type === "video" ? "video/*" : "image/*";
        cover.setAttribute("aria-pressed", String(contents.fit === "cover"));
        contain.setAttribute("aria-pressed", String(contents.fit === "contain"));
      }
    },
  };
}
