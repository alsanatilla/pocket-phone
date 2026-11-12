import { FocusSession, EventPrep, DayReview } from "./TodayActions.tsx";
import { defineRegistry, useActions } from "@json-render/react";
import * as controls from "./controls.tsx";
import { cn } from "@/lib/utils";
import { catalog } from "./catalog.ts";
import { Capture, Chart, Form, Gauge, Hero, Metric, Table, TaskList, ThoughtList, Timeline } from "./components.tsx";

// Catalog entries → components: layout and controls from controls.tsx (plain Terminal elements), readings, charts
// and live lists from components.tsx. Adjusted for a phone-sized Pocket screen, in one place:
// - a vertical Stack fills the width;
// - a Grid is a group of figures (rule 6): two columns on a phone, its full count from sm up, with hairlines
//   between the cells and none of the old tile frames;
// - Heading and Text use Pocket's one size, so a generated title never outshouts the readings.
// Actions are not here: <Surface> passes handlers that know the router and the stores.

const GRID_COLUMNS: Record<number, string> = {
  1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4", 5: "grid-cols-2 sm:grid-cols-5", 6: "grid-cols-2 sm:grid-cols-6",
};

/**
 * Rule 6: a group of figures is columns divided by hairlines, between a hairline above and below. The first cell of
 * every row loses the left line and its padding; a later row gets a hairline above it. On a phone every grid is two
 * columns, so the phone rules count by odd cells; from sm up they count by the grid's own column count. The classes
 * are written out because Tailwind only sees class names that are in the source.
 */
const FIGURES: Record<number, string> = {
  1: "[&>*]:py-2 [&>*:nth-child(n+2)]:border-t",
  2: "[&>*]:border-l [&>*]:py-2 [&>*]:pl-3 [&>*:nth-child(odd)]:border-l-0 [&>*:nth-child(odd)]:pl-0 [&>*:nth-child(n+3)]:border-t",
  3: "[&>*]:border-l [&>*]:py-2 [&>*]:pl-3 max-sm:[&>*:nth-child(odd)]:border-l-0 max-sm:[&>*:nth-child(odd)]:pl-0 max-sm:[&>*:nth-child(n+3)]:border-t sm:[&>*:nth-child(3n+1)]:border-l-0 sm:[&>*:nth-child(3n+1)]:pl-0 sm:[&>*:nth-child(n+4)]:border-t",
  4: "[&>*]:border-l [&>*]:py-2 [&>*]:pl-3 max-sm:[&>*:nth-child(odd)]:border-l-0 max-sm:[&>*:nth-child(odd)]:pl-0 max-sm:[&>*:nth-child(n+3)]:border-t sm:[&>*:nth-child(4n+1)]:border-l-0 sm:[&>*:nth-child(4n+1)]:pl-0 sm:[&>*:nth-child(n+5)]:border-t",
  5: "[&>*]:border-l [&>*]:py-2 [&>*]:pl-3 max-sm:[&>*:nth-child(odd)]:border-l-0 max-sm:[&>*:nth-child(odd)]:pl-0 max-sm:[&>*:nth-child(n+3)]:border-t sm:[&>*:nth-child(5n+1)]:border-l-0 sm:[&>*:nth-child(5n+1)]:pl-0 sm:[&>*:nth-child(n+6)]:border-t",
  6: "[&>*]:border-l [&>*]:py-2 [&>*]:pl-3 max-sm:[&>*:nth-child(odd)]:border-l-0 max-sm:[&>*:nth-child(odd)]:pl-0 max-sm:[&>*:nth-child(n+3)]:border-t sm:[&>*:nth-child(6n+1)]:border-l-0 sm:[&>*:nth-child(6n+1)]:pl-0 sm:[&>*:nth-child(n+7)]:border-t",
};

const HEADING = "text-sm font-medium text-hi";
const TEXT: Record<string, string> = {
  body: "text-sm", lead: "text-base", caption: "text-xs text-dim", muted: "text-sm text-muted-foreground", code: "text-hi",
};

export const { registry } = defineRegistry(catalog, {
  components: {
    Stack: controls.Stack,
    Grid: ({ props, children }) => {
      const columns = Math.max(1, Math.min(6, props.columns ?? 1));
      return <div className={cn("grid gap-0 border-y", GRID_COLUMNS[columns], FIGURES[columns])}>{children}</div>;
    },
    Card: controls.Card,
    Heading: ({ props }) => {
      const Tag = props.level ?? "h2";
      return <Tag className={HEADING}>{props.text}</Tag>;
    },
    Text: ({ props }) => <p className={TEXT[props.variant ?? "body"]}>{props.text}</p>,
    Badge: controls.Badge,
    Alert: controls.Alert,
    Progress: controls.Progress,
    Separator: controls.Separator,
    Tabs: controls.Tabs,
    Accordion: controls.Accordion,
    Collapsible: controls.Collapsible,
    Button: controls.Button,

    FocusSession: ({ props }) => <FocusSession {...props} />,
    EventPrep: ({ props }) => <EventPrep {...props} />,
    DayReview: ({ props }) => <DayReview {...props} />,
    Hero: ({ props }) => <Hero {...props} />,
    Metric: ({ props, on }) => {
      const press = on("press");
      return <Metric {...props} onPress={press.bound ? press.emit : undefined} />;
    },
    Gauge: ({ props }) => <Gauge {...props} />,
    Chart: ({ props }) => <Chart {...props} />,
    Table: ({ props }) => <Table {...props} />,
    Timeline: ({ props }) => <Timeline {...props} />,
    TaskList: ({ props }) => <TaskList {...props} />,
    ThoughtList: ({ props }) => <ThoughtList {...props} />,
    // "ask" runs the askPip action, so Pip opens exactly as it does from a generated button.
    Capture: function CaptureElement({ props }) {
      const { execute } = useActions();
      return <Capture {...props} onAsk={prompt => void execute({ action: "askPip", params: { prompt } })} />;
    },
    // A form's answers go back as one message, the same path as a typed one.
    Form: function FormElement({ props }) {
      const { execute } = useActions();
      return <Form {...props} onAsk={prompt => void execute({ action: "askPip", params: { prompt } })} />;
    },
  },
  actions: {
    // Handlers come from <Surface>; these keep the registry complete for the type check.
    open: async () => {}, askPip: async () => {}, completeTask: async () => {}, parkThought: async () => {},
  },
});
