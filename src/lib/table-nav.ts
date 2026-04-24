// Keyboard navigation for markdown tables (inspired by W11 Notepad's
// in-table editing flow, but stays pure-markdown so the document round-trips
// cleanly):
//   Tab        → jump to start of next cell; wraps to first cell of next
//                table row; no-op past the last cell of the last row.
//   Shift+Tab  → jump to start of previous cell; wraps to last cell of prev
//                row; no-op before the first cell.
//   Enter      → when cursor is inside a table row, append a new empty row
//                below with the same column count; cursor lands in first
//                cell. If cursor is not at end-of-line, just inserts the new
//                row AFTER this line (doesn't split mid-text).
// Falls through to default keymap for any line that isn't part of a
// markdown table.
import { keymap, type KeyBinding, type EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";

function isTableRow(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return false;
  // At least one interior pipe ⇒ at least one cell.
  return t.indexOf("|", 1) !== -1;
}

/** Column ranges (content spans between consecutive pipes), offsets relative
 *  to the line start. Excludes the pipe characters themselves. */
function parseCells(text: string): { start: number; end: number }[] {
  const cells: { start: number; end: number }[] = [];
  let cellStart = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "|") {
      if (cellStart !== -1) cells.push({ start: cellStart, end: i });
      cellStart = i + 1;
    }
  }
  return cells;
}

/** Skip leading whitespace inside a cell so the cursor lands on the first
 *  real character (or on the trailing-pipe boundary if the cell is empty). */
function cellCursorPos(state: EditorState, lineFrom: number, cell: { start: number; end: number }): number {
  let pos = lineFrom + cell.start;
  const end = lineFrom + cell.end;
  while (pos < end && state.doc.sliceString(pos, pos + 1) === " ") pos++;
  return pos;
}

function findCellIndex(cells: { start: number; end: number }[], offset: number): number {
  for (let i = 0; i < cells.length; i++) {
    if (offset >= cells[i].start && offset <= cells[i].end) return i;
  }
  return -1;
}

function moveToCell(view: EditorView, lineFrom: number, cell: { start: number; end: number }) {
  const pos = cellCursorPos(view.state, lineFrom, cell);
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
}

function tabForward(view: EditorView): boolean {
  const { state } = view;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  if (!isTableRow(line.text)) return false;
  const cells = parseCells(line.text);
  const idx = findCellIndex(cells, head - line.from);
  if (idx === -1) return false;
  if (idx < cells.length - 1) {
    moveToCell(view, line.from, cells[idx + 1]);
    return true;
  }
  // Last cell → next row's first cell if still in table.
  if (line.number >= state.doc.lines) return false;
  const next = state.doc.line(line.number + 1);
  if (!isTableRow(next.text)) return false;
  const nextCells = parseCells(next.text);
  if (nextCells.length === 0) return false;
  moveToCell(view, next.from, nextCells[0]);
  return true;
}

function tabBackward(view: EditorView): boolean {
  const { state } = view;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  if (!isTableRow(line.text)) return false;
  const cells = parseCells(line.text);
  const idx = findCellIndex(cells, head - line.from);
  if (idx === -1) return false;
  if (idx > 0) {
    moveToCell(view, line.from, cells[idx - 1]);
    return true;
  }
  if (line.number <= 1) return false;
  const prev = state.doc.line(line.number - 1);
  if (!isTableRow(prev.text)) return false;
  const prevCells = parseCells(prev.text);
  if (prevCells.length === 0) return false;
  moveToCell(view, prev.from, prevCells[prevCells.length - 1]);
  return true;
}

/** Build an empty row string with widths matching the given template cells
 *  so the new row aligns visually with the existing table. */
function buildEmptyRow(templateCells: { start: number; end: number }[]): string {
  const parts = templateCells.map((c) => " ".repeat(Math.max(1, c.end - c.start)));
  return `|${parts.join("|")}|`;
}

function enterNewRow(view: EditorView): boolean {
  const { state } = view;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  if (!isTableRow(line.text)) return false;
  const cells = parseCells(line.text);
  if (cells.length === 0) return false;

  const newRow = buildEmptyRow(cells);
  const newCells = parseCells(newRow);
  const insertAt = line.to;
  const newLineStart = insertAt + 1;
  // Cursor goes to first cell of the new row. Use the known structure of
  // buildEmptyRow (`|<spaces>|...`) to place the cursor right after the
  // opening pipe — we can't call cellCursorPos here because it would read
  // the pre-change document at positions that only exist in the post-change
  // document.
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert: `\n${newRow}` },
    selection: { anchor: newLineStart + newCells[0].start },
    scrollIntoView: true,
  });
  return true;
}

export function tableNavKeymap(): KeyBinding[] {
  return [
    { key: "Tab", run: tabForward },
    { key: "Shift-Tab", run: tabBackward },
    { key: "Enter", run: enterNewRow },
  ];
}

/** Ready-to-use extension — wraps the keymap at a precedence that beats
 *  completion / default keymaps. Put it BEFORE `defaultKeymap` in the
 *  extension list. */
export function tableNav() {
  return keymap.of(tableNavKeymap());
}
