import { FocusSession, EventPrep, DayReview } from "./TodayActions.tsx";
import { defineRegistry, useActions } from "@json-render/react";
import * as controls from "./controls.tsx";
import { cn } from "@/lib/utils";
import { catalog } from "./catalog.ts";
import { Figures } from "../ui/kit.tsx";
import { Capture, Chart, Form, Gauge, Hero, Metric, Table, TaskList, ThoughtList, Timeline } from "./components.tsx";

// Catalog entries → components: layout and controls from controls.tsx (plain Terminal elements), readings, charts
// and live lists from components.tsx. Adjusted for a phone-sized Pocket screen, in one place:
// - a vertical Stack fills the width;
// - a Grid is a group of figures (rule 4): two columns on a phone, the kit's three at most from sm up, with space
//   between the cells and none of the old tile frames;
// - Heading and Text use Pocket's one size, so a generated title never outshouts the readings.
// Actions are not here: <Surface> passes handlers that know the router and the stores.

const HEADING = "text-sm font-medium text-hi";
const TEXT: Record<string, string> = {
  body: "text-sm", lead: "text-base", caption: "text-xs text-dim", muted: "text-sm text-muted-foreground", code: "text-hi",
};

export const { registry } = defineRegistry(catalog, {
  components: {
    Stack: controls.Stack,
    Grid: ({ props, children }) => {
      const columns = Math.max(1, Math.min(6, props.columns ?? 1));
      // Figures has two or three columns; four cells read as two rows of two, six as two rows of three.
      if (columns === 1) return <div className={cn("grid", "grid-cols-1")}>{children}</div>;
      if (columns === 2 || columns === 4) return <Figures columns={2}>{children}</Figures>;
      return <div className="[&>div]:grid-cols-2 sm:[&>div]:grid-cols-3"><Figures columns={3}>{children}</Figures></div>;
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
