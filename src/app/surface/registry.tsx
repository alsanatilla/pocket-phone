import { defineRegistry, useActions } from "@json-render/react";
import { shadcnComponents as shadcn } from "@json-render/shadcn";
import { cn } from "@/lib/utils";
import { catalog } from "./catalog.ts";
import { Capture, Chart, Gauge, Hero, Metric, Table, TaskList, ThoughtList, Timeline } from "./components.tsx";

// Catalog entries → components. Most layout and controls are json-render's shadcn implementations; where their
// defaults do not fit a phone-sized Pocket screen they are adjusted here, in one place:
// - a vertical Stack fills the width;
// - a Grid has at most two columns on a phone, its full count from sm up;
// - Heading and Text use Pocket's type scale, so a generated title never outshouts the readings.
// Actions are not here: <Surface> passes handlers that know the router and the stores.

const GRID_COLUMNS: Record<number, string> = {
  1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4", 5: "grid-cols-2 sm:grid-cols-5", 6: "grid-cols-2 sm:grid-cols-6",
};
const GRID_GAP: Record<string, string> = { sm: "gap-2", md: "gap-3", lg: "gap-4", xl: "gap-6" };

const HEADING: Record<string, string> = {
  h1: "font-pixel text-4xl leading-none", h2: "font-pixel text-3xl leading-none", h3: "font-pixel text-2xl leading-none", h4: "text-sm font-medium",
};
const TEXT: Record<string, string> = {
  body: "text-sm", lead: "text-base", caption: "text-xs text-muted-foreground", muted: "text-sm text-muted-foreground", code: "font-mono text-xs bg-muted px-1",
};

export const { registry } = defineRegistry(catalog, {
  components: {
    Stack: ({ props, ...rest }) => shadcn.Stack({ ...rest, props: { ...props, align: props.align ?? (props.direction === "horizontal" ? "start" : "stretch") } }),
    Grid: ({ props, children }) => {
      const columns = Math.max(1, Math.min(6, props.columns ?? 1));
      return <div className={cn("grid", GRID_COLUMNS[columns], GRID_GAP[props.gap ?? "md"] ?? "gap-3")}>{children}</div>;
    },
    Card: shadcn.Card,
    Heading: ({ props }) => {
      const Tag = props.level ?? "h2";
      return <Tag className={HEADING[Tag]}>{props.text}</Tag>;
    },
    Text: ({ props }) => <p className={TEXT[props.variant ?? "body"]}>{props.text}</p>,
    Badge: shadcn.Badge,
    Alert: shadcn.Alert,
    Progress: shadcn.Progress,
    Separator: shadcn.Separator,
    Tabs: shadcn.Tabs,
    Accordion: shadcn.Accordion,
    Collapsible: shadcn.Collapsible,
    Button: shadcn.Button,

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
  },
  actions: {
    // Handlers come from <Surface>; these keep the registry complete for the type check.
    open: async () => {}, askPip: async () => {}, completeTask: async () => {}, parkThought: async () => {},
  },
});
