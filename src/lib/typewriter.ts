// Typewriter mode: keeps the caret's line vertically centered in the
// viewport so the author's eye stays in one spot while writing. Zero deps,
// runtime-toggled via `html.typewriter-mode` (set by the React hook) so the
// extension itself is always installed — no editor rebuild on toggle.
//
// Performance notes:
//   • No-ops when the class is absent (cheap class check per update).
//   • All scroll work is batched through a single rAF: at most 1 scroll per
//     frame regardless of how many updates fire (typing, mouse, yjs apply).
//   • `coordsAtPos` is cheap in CM 6 (O(log lines)) and doesn't force layout
//     beyond what CM already needs.
//   • A small dead-zone (2px) skips no-op scrolls so steady-state typing
//     within a visual line doesn't jitter the viewport.
import { EditorView } from "@codemirror/view";

export function typewriterMode() {
  let pending = false;
  return EditorView.updateListener.of((update) => {
    if (!document.documentElement.classList.contains("typewriter-mode")) return;
    // Only schedule a recenter when something moved the caret or the doc.
    // Intentionally does NOT listen to `viewportChanged` — that also fires on
    // manual scroll, which would fight the user and trap them on the active
    // line.
    if (!update.selectionSet && !update.docChanged) return;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const { view } = update;
      const head = view.state.selection.main.head;
      const coords = view.coordsAtPos(head);
      if (!coords) return;
      const scroller = view.scrollDOM;
      const rect = scroller.getBoundingClientRect();
      // 40% from top (not 50%) so the eye has more empty space below the
      // caret — less strain when reading back what was just typed.
      const targetY = rect.top + rect.height * 0.4;
      const delta = coords.top - targetY;
      if (Math.abs(delta) < 2) return;
      scroller.scrollTop += delta;
    });
  });
}
