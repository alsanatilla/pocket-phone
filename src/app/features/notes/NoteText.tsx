import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, drawSelection, keymap, placeholder, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";

// A note is written in Markdown, but it should not look like source while it is written. CodeMirror (the editor
// under Obsidian, among others) gives us a real text editor; a small view plugin draws the Markdown in place:
// headings in Pocket's pixel face, bold and code styled, bullets as dots. The markers stay on the line the cursor
// is on, so what is being edited is always shown honestly — and the saved text is still plain Markdown.

class Bullet extends WidgetType {
  toDOM() { const node = document.createElement("span"); node.className = "cm-bullet"; node.textContent = "• "; return node; }
}

const HEADING = /^(#{1,6})[ \t]+/;
const BULLET = /^(\s*)[-*+][ \t]+/;
const QUOTE = /^>[ \t]?/;
const THOUGHT = /^>>[ \t]?/;
const INLINE = /(\*\*[^*\n]+\*\*)|(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\n]+\))/g;

/** The Markdown drawn as the document, on every line the cursor is not on. */
function decorations(view: EditorView): DecorationSet {
  const ranges: { from: number; to: number; value: Decoration }[] = [];
  // Markers show only where someone is writing: the cursor's line, while the editor has focus.
  const active = view.hasFocus ? view.state.doc.lineAt(view.state.selection.main.head).number : -1;
  const bullet = Decoration.replace({ widget: new Bullet() });
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos), text = line.text, editing = line.number === active;
      const heading = HEADING.exec(text), marker = BULLET.exec(text);
      if (heading) {
        ranges.push({ from: line.from, to: line.from, value: Decoration.line({ class: "cm-h" + heading[1]!.length }) });
        if (!editing) ranges.push({ from: line.from, to: line.from + heading[0].length, value: Decoration.replace({}) });
      } else if (THOUGHT.test(text)) {
        ranges.push({ from: line.from, to: line.from, value: Decoration.line({ class: "cm-thought" }) });
      } else if (marker && !editing) {
        ranges.push({ from: line.from + marker[1]!.length, to: line.from + marker[0].length, value: bullet });
      } else if (QUOTE.test(text)) {
        ranges.push({ from: line.from, to: line.from, value: Decoration.line({ class: "cm-quote" }) });
      }
      if (!editing && !heading) {
        for (const match of text.matchAll(INLINE)) {
          const start = line.from + (match.index ?? 0), whole = match[0];
          if (whole.startsWith("**")) {
            ranges.push({ from: start, to: start + 2, value: Decoration.replace({}) });
            ranges.push({ from: start + 2, to: start + whole.length - 2, value: Decoration.mark({ class: "cm-strong" }) });
            ranges.push({ from: start + whole.length - 2, to: start + whole.length, value: Decoration.replace({}) });
          } else if (whole.startsWith("`")) {
            ranges.push({ from: start, to: start + 1, value: Decoration.replace({}) });
            ranges.push({ from: start + 1, to: start + whole.length - 1, value: Decoration.mark({ class: "cm-code" }) });
            ranges.push({ from: start + whole.length - 1, to: start + whole.length, value: Decoration.replace({}) });
          } else {
            const label = whole.slice(1, whole.indexOf("]")), end = start + 1 + label.length;
            ranges.push({ from: start, to: start + 1, value: Decoration.replace({}) });
            ranges.push({ from: start + 1, to: end, value: Decoration.mark({ class: "cm-link" }) });
            ranges.push({ from: end, to: start + whole.length, value: Decoration.replace({}) });
          }
        }
      }
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

const livePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = decorations(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) this.decorations = decorations(update.view);
  }
}, { decorations: plugin => plugin.decorations });

const lineAt = (state: EditorState) => state.doc.lineAt(state.selection.main.head).number - 1;

export function NoteText({ value, onChange, onNudge, onBlur, autoFocus = false, startAt = "end" }: {
  value: string;
  onChange: (text: string, cursorLine: number) => void;
  onNudge: (cursorLine: number) => void;
  onBlur: () => void;
  autoFocus?: boolean;
  startAt?: "start" | "end";
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onNudge, onBlur });
  callbacks.current = { onChange, onNudge, onBlur };

  useEffect(() => {
    if (!host.current) return;
    const instance = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          drawSelection(),
          EditorView.theme({
            "&": { backgroundColor: "transparent" },
            "&.cm-focused": { outline: "none" },
            ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--primary) 7%, transparent)" },
            ".cm-content": { caretColor: "var(--primary)" },
          }),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": "Note text", "aria-multiline": "true", spellcheck: "false", autocorrect: "off" }),
          placeholder("# Title\n\nWrite in Markdown…  >> a thought @tomorrow parks it"),
          livePreview,
          EditorView.updateListener.of(update => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString(), lineAt(update.state));
            else if (update.selectionSet) callbacks.current.onNudge(lineAt(update.state));
          }),
          EditorView.domEventHandlers({ blur: () => { callbacks.current.onBlur(); } }),
        ],
      }),
    });
    view.current = instance;
    if (autoFocus) {
      instance.focus();
      instance.dispatch({ selection: { anchor: startAt === "start" ? 0 : instance.state.doc.length } });
    }
    return () => { instance.destroy(); view.current = null; };
    // Mounted once per note; the text arrives through the effect below and edits go out through the listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Text that changed elsewhere (a sync merge, the classic app) replaces the document; our own edits already match.
  useEffect(() => {
    const instance = view.current;
    if (!instance) return;
    const current = instance.state.doc.toString();
    if (current === value) return;
    instance.dispatch({ changes: { from: 0, to: current.length, insert: value } });
  }, [value]);

  // The whole column below the text is part of the page: a click there writes at the end.
  return <div ref={host} className="cm-note min-h-[50vh]" onClick={() => view.current?.focus()} />;
}
