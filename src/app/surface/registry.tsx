import { defineRegistry, useActions } from "@json-render/react";
import { shadcnComponents as shadcn } from "@json-render/shadcn";
import { catalog } from "./catalog.ts";
import { Capture, Chart, Gauge, Hero, Metric, TaskList, ThoughtList, Timeline } from "./components.tsx";

// Catalog entries → components. Actions are not here: Surface passes handlers that know the router and stores.

export const { registry } = defineRegistry(catalog, {
  components: {
    // Pocket's default: a vertical stack fills the width (shadcn's starts at the left); horizontal keeps "start".
    Stack: ({ props, ...rest }) => shadcn.Stack({ ...rest, props: { ...props, align: props.align ?? (props.direction === "horizontal" ? "start" : "stretch") } }),
    Grid: shadcn.Grid,
    Card: shadcn.Card,
    Heading: shadcn.Heading,
    Text: shadcn.Text,
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
