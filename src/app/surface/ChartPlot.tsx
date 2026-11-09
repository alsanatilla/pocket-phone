import { memo, useId } from "react";
import { Area, AreaChart, Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

// The drawing area of a Chart, in its own chunk: recharts loads the first time a chart appears, not with the
// first screen. Memoised on its inputs (rows, colours, names), so a chart draws and animates once, not again on
// every update of the screen around it.

export interface PlotProps {
  kind: "area" | "bar" | "line";
  rows: Record<string, string | number>[];
  colors: string[];
  names: string[];
  unit?: string | null;
  format: (value: number) => string;
}

const margin = { top: 12, right: 4, bottom: 0, left: 4 };
const motion = { animationDuration: 700, animationEasing: "ease-out" as const };

const ChartPlot = memo(function ChartPlot({ kind, rows, colors, names, unit, format }: PlotProps) {
  const id = useId().replace(/:/g, "");
  const axis = <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} interval="preserveStartEnd" minTickGap={24} />;
  const tooltip = <Tooltip cursor={{ fill: "var(--accent)" }} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 4, fontSize: 12 }}
    formatter={(value: unknown, key: unknown) => [format(Number(value)) + (unit ? " " + unit : ""), names[Number(String(key).slice(1))] ?? ""]} />;
  return (
    <ResponsiveContainer width="100%" height="100%">
      {kind === "bar" ? (
        <BarChart data={rows} margin={margin}>{axis}{tooltip}{colors.map((color, index) => <Bar key={index} dataKey={"s" + index} fill={color} radius={[2, 2, 0, 0]} {...motion} />)}</BarChart>
      ) : kind === "line" ? (
        <LineChart data={rows} margin={margin}>{axis}{tooltip}{colors.map((color, index) => <Line key={index} dataKey={"s" + index} stroke={color} strokeWidth={2} dot={false} connectNulls {...motion} />)}</LineChart>
      ) : (
        <AreaChart data={rows} margin={margin}>
          <defs>{colors.map((color, index) => (
            <linearGradient key={index} id={id + index} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={colors.length > 1 ? 0.25 : 0.45} /><stop offset="100%" stopColor={color} stopOpacity={0} /></linearGradient>
          ))}</defs>
          {axis}{tooltip}{colors.map((color, index) => <Area key={index} dataKey={"s" + index} stroke={color} strokeWidth={2} fill={`url(#${id}${index})`} connectNulls {...motion} />)}
        </AreaChart>
      )}
    </ResponsiveContainer>
  );
});

export default ChartPlot;
