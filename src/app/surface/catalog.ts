import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions as shadcn } from "@json-render/shadcn/catalog";
import { z } from "zod";

// What a generated Pocket surface may be built from. Layout and controls come from json-render's shadcn catalog;
// Pocket adds big readings, charts, a timeline and live lists. The model chooses and arranges; how each piece
// looks is fixed here, so a generated screen always looks like Pocket.
//
// Free-form className is removed from every component: classes the model invents would not exist in the build,
// and the look is not the model's to change.

// The shadcn definitions are plain objects with a zod `props` schema; drop className and keep the rest.
type Definition = { props: z.ZodObject<z.ZodRawShape>; [key: string]: unknown };
const withoutClassName = <D extends Definition>(definition: D): D => {
  const props = definition.props.shape.className ? definition.props.omit({ className: true }) : definition.props;
  return { ...definition, props };
};

const tone = z.enum(["accent", "movement", "calendar", "thought", "warning", "muted"]).nullable()
  .describe("Pocket's signal colour: accent (amber, default), movement (green), calendar (blue), thought (violet), warning (coral), muted");
const point = z.object({ label: z.string(), value: z.number() });
const source = z.object({ title: z.string(), url: z.string().nullable().optional() }).describe("Where the figures come from: a name and, for the web, its URL");

export const catalog = defineCatalog(schema, {
  components: {
    Stack: withoutClassName(shadcn.Stack),
    Grid: withoutClassName(shadcn.Grid),
    Card: withoutClassName(shadcn.Card),
    Heading: withoutClassName(shadcn.Heading),
    Text: withoutClassName(shadcn.Text),
    Badge: withoutClassName(shadcn.Badge),
    Alert: withoutClassName(shadcn.Alert),
    Progress: withoutClassName(shadcn.Progress),
    Separator: withoutClassName(shadcn.Separator),
    Tabs: withoutClassName(shadcn.Tabs),
    Accordion: withoutClassName(shadcn.Accordion),
    Collapsible: withoutClassName(shadcn.Collapsible),
    Button: withoutClassName(shadcn.Button),

    FocusSession: {
      props: z.object({ title: z.string().nullable() }),
      description: "Live focus session: choose a real task, start/pause/resume a persistent timer, check its steps and open its source note. Include once on daytime screens or whenever /focus is present. Reads live data; never supply invented tasks or durations.",
    },
    EventPrep: {
      props: z.object({ title: z.string().nullable() }),
      description: "Live next calendar event with time, linked preparation task, editable checklist, source note and open-event action. Include once when an event is near. Do not duplicate this event in a Hero or timeline.",
    },
    DayReview: {
      props: z.object({ title: z.string().nullable() }),
      description: "Evening wrap-up: real completed tasks, unfinished due tasks with tomorrow/later/done actions, tomorrow's first task, and a saved daily note. Include once in the evening. Replaces TaskList and done-count metrics.",
    },
    Hero: {
      props: z.object({
        eyebrow: z.string().nullable().describe("A short line above, e.g. the time or a greeting"),
        value: z.union([z.string(), z.number()]).describe("The one big reading or phrase of the moment"),
        unit: z.string().nullable(),
        caption: z.string().nullable().describe("One sentence under it"),
        tone,
      }),
      description: "The headline of the screen: one huge pixel-font reading or phrase. Use at most one, at the top.",
    },
    Metric: {
      props: z.object({
        label: z.string(),
        value: z.union([z.string(), z.number()]),
        unit: z.string().nullable(),
        hint: z.string().nullable().describe("A short note under the value"),
        tone,
      }),
      events: ["press"],
      description: "A compact reading tile (count, time, score). Put 2–4 of them in a Grid. Bind on.press to open its area.",
    },
    Gauge: {
      props: z.object({ label: z.string(), value: z.number().describe("0–100"), caption: z.string().nullable(), tone }),
      description: "A ring gauge for a 0–100 score such as recovery or progress through the day.",
    },
    Chart: {
      props: z.object({
        kind: z.enum(["area", "bar", "line"]),
        title: z.string().nullable(),
        data: z.array(point).nullable().optional().describe("One series: points in order; or bind to a state path such as /movement/recoveryTrend"),
        series: z.array(z.object({ name: z.string(), tone: tone.optional(), data: z.array(point) })).max(5).nullable().optional()
          .describe("Several series to compare (up to 5), each with the same labels in the same order; shown with a legend"),
        unit: z.string().nullable(),
        tone,
        note: z.string().nullable().optional().describe("One line under the chart: period, definition, caveat"),
        source: source.nullable().optional(),
      }),
      description: "A wide chart of numbers over time or across categories. Use for trends and comparisons, not single numbers.",
    },
    Table: {
      props: z.object({
        title: z.string().nullable(),
        columns: z.array(z.string()).min(1).max(6),
        rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).max(40).describe("One array per row, in column order"),
        note: z.string().nullable().optional(),
        source: source.nullable().optional(),
      }),
      description: "Rows of figures or facts that are read, not seen as a shape. Numbers align right.",
    },
    Timeline: {
      props: z.object({
        title: z.string().nullable(),
        items: z.array(z.object({
          time: z.string(), title: z.string(), detail: z.string().nullable().optional(),
          past: z.boolean().nullable().optional(), now: z.boolean().nullable().optional(),
        })).describe("Bind to /agenda/today, or list steps of a plan"),
      }),
      description: "A vertical timeline of the day or of a plan; the current item is highlighted.",
    },
    TaskList: {
      props: z.object({
        title: z.string().nullable(),
        source: z.enum(["due", "open", "chosen"]).describe("due: due today or overdue; open: all open; chosen: the task chosen to do next"),
        limit: z.number().nullable(),
      }),
      description: "The person's real tasks, live, with a check button to complete each. Never invent tasks; use this.",
    },
    ThoughtList: {
      props: z.object({
        title: z.string().nullable(),
        source: z.enum(["ready", "open"]).describe("ready: due to be revisited now; open: all parked"),
        limit: z.number().nullable(),
      }),
      description: "The person's parked thoughts, live, each with 'make task'.",
    },
    Capture: {
      props: z.object({ mode: z.enum(["thought", "task", "ask"]), placeholder: z.string().nullable() }),
      description: "One input line: park a thought, add a task, or ask Pip. Usually one per screen.",
    },
    Form: {
      props: z.object({
        title: z.string().nullable(),
        description: z.string().nullable(),
        fields: z.array(z.object({
          name: z.string().describe("Short and unique; the answer comes back under it"),
          label: z.string().describe("What to ask, in the person's words"),
          type: z.enum(["text", "number", "choice"]),
          options: z.array(z.string()).nullable().optional().describe("The choices, for type choice"),
          placeholder: z.string().nullable(),
          required: z.boolean().nullable(),
        })).min(1).max(6),
        submitLabel: z.string().nullable(),
      }),
      description: "Ask for a few answers in one card: labeled fields and one send that passes them to Pip as a message. Use it instead of several questions in a row; keep only the fields you really need.",
    },
  },
  actions: {
    open: { params: z.object({ to: z.enum(["/today", "/notes", "/pip", "/tasks", "/thoughts", "/calendar", "/clock", "/movement", "/gym", "/travel", "/brief"]) }), description: "Open an area of Pocket" },
    askPip: { params: z.object({ prompt: z.string() }), description: "Open Pip with this question about the person's own data" },
    completeTask: { params: z.object({ uid: z.string() }), description: "Mark a task done (use the uid from state)" },
    parkThought: { params: z.object({ text: z.string() }), description: "Park a thought to decide on later" },
  },
});

export type PocketCatalog = typeof catalog;
