import { streamText } from "ai";
import { autoFixSpec, buildUserPrompt, createSpecStreamCompiler, validateSpec, type Spec } from "@json-render/core";
import { settings } from "../../client/pip-core.js";
import { resolve } from "../../client/pip-credentials.js";
import { providerError, providerModel } from "../../client/pip-provider.js";
import { catalog } from "./catalog.ts";
import type { Moment } from "./context.ts";

// Arranges a surface for the moment with the person's own model, through the same provider layer and keys Pip
// uses (a browser key, or the server relay when the key is stored on the account). The model streams JSON Patch
// lines; the compiler turns them into a spec as they arrive, so the screen builds up while it writes.

export class NoModel extends Error {
  constructor() { super("Connect a model in Pip's settings to let Pocket arrange this screen."); this.name = "NoModel"; }
}

const SYSTEM = [
  "You arrange the home screen of Pocket, a personal organiser, for one person at one moment.",
  "Build a calm, generous, glanceable screen: one Hero at the top, then the few things that matter now.",
  "Prefer big readings (Hero, Metric, Gauge) and charts over text. Use at most 7 top-level blocks.",
  "Bind every number, list and series to state with {\"$state\": \"/path\"} or {\"$template\": \"…${/path}…\"}; never copy values into props.",
  "Use TaskList and ThoughtList for the person's tasks and thoughts; never invent or retype items.",
  "Write short, plain, kind text. No emoji. Do not give medical advice.",
  "Leave out what is empty: no chart without data, no timeline without events.",
].join("\n");

export const systemPrompt = (): string => catalog.prompt({ system: SYSTEM, mode: "standalone" });

/** The request: the moment as state (paths the spec binds to) plus what to emphasise. */
export function userPrompt(moment: Moment): string {
  const focus = moment.agenda.next && moment.agenda.next.inMinutes >= 0 && moment.agenda.next.inMinutes <= 45
    ? "An event starts soon; lead with it."
    : moment.now.phase === "morning" ? "It is morning: help plan the day."
    : moment.now.phase === "evening" || moment.now.phase === "night" ? "It is evening: review the day and settle what is left."
    : "It is the middle of the day: what to do next.";
  return buildUserPrompt({ prompt: `Arrange the home screen for now. ${focus}`, state: moment as unknown as Record<string, unknown> });
}

export interface StreamOptions { signal: AbortSignal; onSpec: (spec: Spec) => void }

/** Streams a surface for `moment`. Resolves with the final, validated spec; rejects with NoModel or a safe error. */
export async function streamSurface(moment: Moment, { signal, onSpec }: StreamOptions): Promise<Spec> {
  const value = settings();
  const credential = await resolve(value);
  if (!credential) throw new NoModel();
  const compiler = createSpecStreamCompiler<Spec>();
  try {
    const model = await providerModel(value, credential, { fetcher: (...args) => fetch(...args), signal, clock: () => {} });
    const result = streamText({ model, system: systemPrompt(), prompt: userPrompt(moment), abortSignal: signal, maxOutputTokens: 4000 });
    for await (const chunk of result.textStream) {
      const { result: spec, newPatches } = compiler.push(chunk);
      if (newPatches.length && spec?.root) onSpec(spec);
    }
  } catch (error) {
    throw providerError(error);
  }
  const { spec } = autoFixSpec(compiler.getResult());
  const unknown = Object.values(spec.elements ?? {}).some(element => !catalog.componentNames.includes(element.type));
  const issues = validateSpec(spec).issues.filter(issue => issue.severity === "error");
  if (!spec.root || unknown || issues.length) throw new Error("The model's screen did not fit Pocket's components; showing the standard one.");
  return spec;
}
