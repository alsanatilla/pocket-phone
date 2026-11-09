import { createRoot } from "react-dom/client";
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { defineRegistry, Renderer, JSONUIProvider } from "@json-render/react";
import { z } from "zod";

// Pocket's card, rendered by json-render's own React renderer.
//
// The catalog below is the standard one (Card, Section, Text, Fields/Field, Table, Chart, Divider, Actions,
// Button, LinkButton) expressed in Pocket's components: the props are validated by the library, the registry
// decides what a Table looks like here. A fenced ```pocket block arrives as a spec, never as HTML.

const style = z.enum(["primary", "muted"]).nullable().optional();

const catalog = defineCatalog(schema, {
  components: {
    Card: { props: z.object({ title: z.string().nullable(), subtitle: z.string().nullable() }), description: "A titled card" },
    Section: { props: z.object({}).loose(), description: "Groups related elements" },
    Text: { props: z.object({ content: z.string(), style }), description: "A paragraph" },
    Fields: { props: z.object({}).loose(), description: "Label and value rows" },
    Field: { props: z.object({ label: z.string(), value: z.string() }), description: "One label and value" },
    Table: { props: z.object({ headers: z.array(z.string()), rows: z.array(z.array(z.string())), caption: z.string().nullable().optional(), align: z.string().nullable().optional() }), description: "A small table" },
    Chart: { props: z.object({ title: z.string().nullable().optional(), chart: z.object({ data: z.array(z.number()) }).loose() }), description: "A bar chart" },
    Divider: { props: z.object({}).loose(), description: "A separator" },
    Actions: { props: z.object({}).loose(), description: "A row of buttons" },
    Button: { props: z.object({ label: z.string(), id: z.string().nullable().optional(), value: z.string().nullable().optional(), style }), description: "A button that answers Pip" },
    LinkButton: { props: z.object({ label: z.string(), url: z.string() }), description: "A link styled as a button" }
  },
  actions: {}
});

const { registry } = defineRegistry(catalog, {
  components: {
    Card: ({ props, children }) => (
      <section className="pocket-card">
        <div className="pocket-bar" />
        {props.title ? <div className="pocket-title">{props.title}</div> : null}
        {props.subtitle ? <div className="pocket-sub">{props.subtitle}</div> : null}
        {children ? <div className="pocket-body">{children}</div> : null}
      </section>
    ),
    Section: ({ children }) => <div className="pocket-section">{children}</div>,
    Text: ({ props }) => <div className={"pocket-text" + (props.style === "muted" ? " pocket-muted" : "")}>{props.content}</div>,
    Fields: ({ children }) => <div className="pocket-fields">{children}</div>,
    Field: ({ props }) => (
      <div className="pocket-row"><span className="pocket-k">{props.label}</span><span className="pocket-v">{props.value}</span></div>
    ),
    Table: ({ props }) => {
      const columns = Math.min(4, Math.max(props.headers.length, ...props.rows.map(row => row.length)));
      return (
        <div className="pocket-table">
          <div className={"pocket-tr pocket-thead pocket-c" + columns}>
            {props.headers.map((header, index) => <span className="pocket-th" key={index}>{header}</span>)}
          </div>
          {props.rows.map((row, index) => (
            <div className={"pocket-tr pocket-c" + columns} key={index}>
              {Array.from({ length: columns }, (_, cell) => <span className="pocket-td" key={cell}>{row[cell] ?? ""}</span>)}
            </div>
          ))}
          {props.caption ? <div className="pocket-label">{props.caption}</div> : null}
        </div>
      );
    },
    Chart: ({ props }) => {
      const values = props.chart?.data ?? [];
      if (values.length < 2) return null;
      const max = Math.max(...values, 1);
      return (
        <div className="pocket-chart">
          {props.title ? <div className="pocket-label">{props.title}</div> : null}
          <div className="pocket-bars">
            {values.map((value, index) => (
              <span className={"pocket-col pocket-h" + Math.min(10, Math.max(1, Math.round((value / max) * 10)))} key={index} />
            ))}
          </div>
        </div>
      );
    },
    Divider: () => <div className="pocket-divider" />,
    Actions: ({ children }) => <div className="pocket-actions">{children}</div>,
    Button: ({ props }) => (
      <span
        className={"pocket-button" + (props.style === "primary" ? " pocket-primary" : "")}
        role="button"
        tabIndex={0}
        data-pocket-action={props.id || props.label}
        data-pocket-value={props.value || props.label}
      >{props.label}</span>
    ),
    LinkButton: ({ props }) => (
      <a className="pocket-link" href={props.url} target="_blank" rel="noopener noreferrer">{props.label}</a>
    )
  }
});

const roots = new WeakMap();

/** The server encodes the spec's UTF-8 bytes; atob alone would turn every non-ASCII character into mojibake. */
function decode(value) {
  try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), char => char.charCodeAt(0)))); } catch { return null; }
}

const KNOWN = new Set(Object.keys(catalog.data.components));

/**
 * Mounts every spec the markdown renderer left as a placeholder. Idempotent per element. A placeholder the new
 * client already drew (data-renderer) is left alone; a card in the new catalog, which this classic renderer cannot
 * draw, becomes a link to the new client.
 */
export function hydrateCards(node) {
  for (const slot of node.querySelectorAll(".pocket-spec[data-spec]")) {
    if (roots.has(slot) || slot.dataset.renderer) continue;
    const spec = decode(slot.getAttribute("data-spec") || "");
    if (!spec || !spec.elements) continue;
    const root = createRoot(slot);
    roots.set(slot, root);
    const modern = Object.values(spec.elements).some(element => !KNOWN.has(element?.type));
    root.render(modern ? (
      <section className="pocket-card">
        <div className="pocket-bar" />
        <div className="pocket-sub">This reply has a card the new Pocket draws.</div>
        <a className="pocket-link" href="/#/pip">open in the new Pocket</a>
      </section>
    ) : (
      <JSONUIProvider registry={registry} initialState={spec.state ?? {}}>
        <Renderer spec={spec} registry={registry} />
      </JSONUIProvider>
    ));
  }
}

/** Frees the React roots inside a node that is about to be replaced; unmounting waits a microtask (it may run mid-render). */
export function releaseCards(node) {
  const leaving = [];
  for (const slot of node.querySelectorAll(".pocket-spec[data-spec]")) {
    const root = roots.get(slot);
    if (root) { roots.delete(slot); leaving.push(root); }
  }
  if (leaving.length) queueMicrotask(() => leaving.forEach(root => { try { root.unmount(); } catch { /* already gone */ } }));
}

/**
 * One classic card as a React element, for clients that render replies in React (the new chat). A card in the
 * new catalog, which this renderer cannot draw, becomes a link to the new client, as in hydrateCards.
 */
export function LegacyCard({ spec }) {
  const modern = Object.values(spec?.elements || {}).some(element => !KNOWN.has(element?.type));
  if (modern) return (
    <section className="pocket-card">
      <div className="pocket-bar" />
      <div className="pocket-sub">This reply has a card the new Pocket draws.</div>
      <a className="pocket-link" href="/#/pip">open in the new Pocket</a>
    </section>
  );
  return (
    <JSONUIProvider registry={registry} initialState={spec.state ?? {}}>
      <Renderer spec={spec} registry={registry} />
    </JSONUIProvider>
  );
}
