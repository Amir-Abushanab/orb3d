# Orb Studio

Design an orb and its states, then export it.

```sh
pnpm install
pnpm dev
```

- **Preset** loads a built-in look; `clear`, an empty glass ball, is the default. Editing anything
  makes it `custom`.
- **Contents** puts something in the glass: clear glass, a gradient, an image, a video, a shader of
  your own, the sunset or the landscape. Its controls come and go with it; the glass's stay.
  For an image or a video, paste a URL, choose a file (a small picture is kept in the document;
  anything else lasts until a reload) or try the **Sample**. A shader's code opens in a drawer under
  the orb, with GLSL highlighting: it compiles whenever you pause typing (⌘↵ compiles at once), its
  errors are marked on their lines, and until it compiles again the orb keeps showing the last code
  that did. Fold the drawer down to its header, or drag its top edge to resize it.
- **The state bar** under the orb picks the state to show and edit. The live state has a dot.
  New documents and presets start with **thinking**, **responding**, and **muted**.
  **Base** previews and edits what every state starts from; a state edits only its overrides, which the panel
  marks with •. Right-click a marked control to hand it back to the base, or use **Clear this
  state's overrides**. Type a name into **+ state** to add one; **×** deletes one.
- **Transition** is how long a state change takes to settle; on a state it is how long moving into
  that state takes.
- **Level** feeds the orb's input: the slider, **Voice** (a synthetic voice that rises and falls
  like speech) or **Mic**. Tune how a state answers it in the **React** folder.
- **Cycle** steps through the states every few seconds.
- **Light**, **Dark** and **Checker** change the backdrop, to check the orb over any page.
- **Weather** puts Air, glass tilt and wind above the individual patterns. Air is incoming
  precipitation in **Hero sky** and **Weather overlay**; it becomes inactive when rain, snow and
  hail are off. Water already sitting on the orb remains controlled by the individual patterns.
- **History**: undo and redo (⌘Z, ⇧⌘Z or Ctrl+Y) and, beside them, the list of versions, each
  with a thumbnail of the orb and what changed ("frost", "thinking: sun y", "preset aura"). Click
  one to go back to it. A drag is one version, not one per frame. **Clear** starts the list over
  from where you are; press **U** within a few seconds to take that back.

**Export** gives code for React, the custom element, plain JS, a CDN script, React Native, SwiftUI or
Android, carrying only what differs from the preset (a file chosen from this computer becomes a
placeholder to replace with its URL); `program.json` for Swift and Android; `poster.png` (the opening state's first frame at 1024 px, which the live
orb hands off from without a jump); `config.json`; `embed.html`, a self-contained page with the
runtime and image/video media inlined; and a share link. HTML exports include samples and files
chosen on this computer; a failed media download is reported before exporting. Android code
uses a local AAR while remote publishing is pending. The document also lives in the URL and in this browser, so a
reload keeps it.
