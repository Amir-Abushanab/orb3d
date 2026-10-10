/**
 * The shader editor: a drawer along the bottom of the stage, for contents that are a shader of
 * your own. Under the orb rather than in the panel, so the code has the width shader lines want and
 * the orb stays in view while it changes; it folds down to its header, and its top edge drags.
 *
 * CodeMirror 6, as in Materials Studio's editor, with GLSL highlighting. Edits compile as you
 * pause, and the compiler's complaints sit on the lines they are about. While the code does not
 * compile, the orb keeps showing the last version that did.
 */

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  HighlightStyle,
  indentUnit,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { clike } from "@codemirror/legacy-modes/mode/clike";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

const words = (list: string): Record<string, boolean> =>
  Object.fromEntries(list.split(" ").map((word) => [word, true]));

/**
 * GLSL as a shader of your own may write it: the GLSL ES 3.00 that every platform's dialect
 * shares (no textures, no derivatives), and the orb's helpers, which it can call like built-ins.
 */
const glsl = StreamLanguage.define(
  clike({
    name: "glsl",
    keywords: words(
      "const in out inout uniform struct return break continue discard for while do if else " +
        "precision highp mediump lowp",
    ),
    types: words(
      "float int uint bool void vec2 vec3 vec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 " +
        "bvec2 bvec3 bvec4 mat2 mat3 mat4",
    ),
    blockKeywords: words("for while do if else struct"),
    builtin: words(
      "radians degrees sin cos tan asin acos atan sinh cosh tanh pow exp log exp2 log2 sqrt " +
        "inversesqrt abs sign floor ceil trunc round fract mod min max clamp mix step " +
        "smoothstep length distance dot cross normalize faceforward reflect refract " +
        "lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not " +
        // The orb's own helpers, defined before your code.
        "sat cover wrapf boxSdf hash hash2 vnoise fbm rotate2",
    ),
    atoms: words("true false"),
    indentSwitch: false,
  }),
);

/** Light and low-contrast, to sit beside the studio's chrome; the same palette as Materials
 *  Studio's editor. */
const HIGHLIGHT = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.modifier], color: "#a24bc8" },
  { tag: [tags.typeName], color: "#b25a1e" },
  { tag: [tags.number, tags.bool, tags.atom], color: "#b25a1e" },
  { tag: [tags.standard(tags.variableName), tags.function(tags.variableName)], color: "#1f5fa8" },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment],
    color: "#9a97a2",
    fontStyle: "italic",
  },
  { tag: [tags.meta], color: "#a24bc8" },
  { tag: [tags.operator, tags.punctuation], color: "#6d6a75" },
]);

const THEME = EditorView.theme({
  "&": { height: "100%", fontSize: "12px", backgroundColor: "transparent", color: "#1b1a1f" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
    lineHeight: "1.6",
  },
  ".cm-content": { padding: "14px 0" },
  ".cm-gutters": {
    backgroundColor: "transparent",
    border: "none",
    color: "#c3c0c9",
    paddingLeft: "14px",
  },
  ".cm-lineNumbers .cm-gutterElement": { paddingRight: "10px" },
  ".cm-line": { paddingRight: "20px" },
  ".cm-activeLine": { backgroundColor: "rgba(27, 26, 31, 0.035)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#6d6a75" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "rgba(162, 75, 200, 0.18)",
  },
  ".cm-cursor": { borderLeftColor: "#1b1a1f" },
  ".cm-lintRange-error": { backgroundImage: "none", borderBottom: "1.5px solid #d0342c" },
  ".cm-tooltip": { fontSize: "11px" },
});

/** How long the typing has to pause before the code compiles. */
const COMPILE_DELAY = 500;
const STORE_KEY = "orb-studio:code-drawer";

export interface CodeDrawerHooks {
  /** New code to compile and keep. */
  onCode(code: string): void;
}

export interface CodeDrawer {
  /** Show the drawer for shader contents with this code, or hide it (null). */
  refresh(code: string | null): void;
  /** The compiler's message, by line, or null once the code compiles. */
  showError(message: string | null): void;
}

/** "line 3: 'oops' : undeclared identifier" lines, as diagnostics on those lines. */
function diagnostics(state: EditorState, message: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const text of message.split("\n")) {
    const match = /^line (-?\d+):\s*(.*)$/.exec(text.trim());
    if (!match) continue;
    const number = Math.min(Math.max(Number(match[1]), 1), state.doc.lines);
    const line = state.doc.line(number);
    out.push({
      from: line.from,
      to: Math.max(line.to, line.from),
      severity: "error",
      message: match[2]!,
    });
  }
  // A message with no line in it (a link failure, say) still says something is wrong.
  if (out.length === 0 && message.trim()) {
    out.push({ from: 0, to: 0, severity: "error", message: message.trim() });
  }
  return out;
}

function readStore(): { open: boolean; height: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as {
      open?: unknown;
      height?: unknown;
    } | null;
    return {
      open: saved?.open !== false,
      height: typeof saved?.height === "number" ? saved.height : 260,
    };
  } catch {
    return { open: true, height: 260 };
  }
}

export function createCodeDrawer(drawer: HTMLElement, hooks: CodeDrawerHooks): CodeDrawer {
  const toggle = drawer.querySelector<HTMLButtonElement>(".code-toggle")!;
  const status = drawer.querySelector<HTMLElement>(".code-status")!;
  const host = drawer.querySelector<HTMLElement>(".code-editor")!;
  const grip = drawer.querySelector<HTMLElement>(".code-grip")!;
  const saved = readStore();
  let open = saved.open;
  let height = saved.height;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let applied = "";
  let failed = false;

  const save = (): void => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ open, height }));
    } catch {
      // storage blocked: the drawer forgets, which is fine
    }
  };

  const layout = (): void => {
    drawer.dataset.open = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    drawer.style.setProperty("--code-height", `${height}px`);
  };

  /** Compile what is in the editor now, if it changed. */
  const run = (): void => {
    clearTimeout(timer);
    const code = view.state.doc.toString();
    if (code === applied) return;
    applied = code;
    status.textContent = "Compiling…";
    hooks.onCode(code);
  };

  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: "",
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        lintGutter(),
        indentUnit.of("  "),
        EditorState.tabSize.of(2),
        glsl,
        syntaxHighlighting(HIGHLIGHT),
        THEME,
        keymap.of([
          { key: "Mod-Enter", run: () => (run(), true) },
          indentWithTab,
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          clearTimeout(timer);
          timer = setTimeout(run, COMPILE_DELAY);
        }),
        EditorView.contentAttributes.of({ "aria-label": "Shader code" }),
      ],
    }),
  });

  toggle.addEventListener("click", () => {
    open = !open;
    layout();
    save();
    if (open) view.focus();
  });

  // Drag the top edge to make room for more code, or for more orb.
  grip.addEventListener("pointerdown", (event) => {
    if (!open) return;
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = height;
    const stage = drawer.parentElement!;
    const move = (e: PointerEvent): void => {
      const max = Math.max(160, stage.clientHeight - 220);
      height = Math.round(Math.min(max, Math.max(120, startHeight + startY - e.clientY)));
      layout();
    };
    const up = (): void => {
      grip.removeEventListener("pointermove", move);
      save();
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up, { once: true });
    grip.addEventListener("pointercancel", up, { once: true });
  });

  layout();

  return {
    refresh(code) {
      drawer.hidden = code === null;
      if (code === null) return;
      // Leave the editor alone while it is ahead of the config: you are typing.
      const current = view.state.doc.toString();
      if (code !== applied && code !== current) {
        applied = code;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
        clearTimeout(timer);
      }
    },
    showError(message) {
      failed = message !== null;
      view.dispatch(setDiagnostics(view.state, message ? diagnostics(view.state, message) : []));
      const count = message ? diagnostics(view.state, message).length : 0;
      status.textContent = failed ? `${count} ${count === 1 ? "error" : "errors"}` : "Compiled";
      status.dataset.state = failed ? "error" : "ok";
    },
  };
}
