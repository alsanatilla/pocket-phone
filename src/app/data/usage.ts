import { listChats } from "./chats.ts";
import { priceOf } from "./ai.ts";

// How much Pip used this month, from the token counts each reply records (turn.usage). Costs are estimates
// from public list prices; replies through an unknown model count tokens only.

export interface Usage { replies: number; inputTokens: number; outputTokens: number; dollars: number; unpriced: number }

interface TurnUsage { request_identity?: string; input_tokens?: number; output_tokens?: number }

export function monthUsage(now: number = Date.now()): Usage {
  const date = new Date(now), start = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
  const total: Usage = { replies: 0, inputTokens: 0, outputTokens: 0, dollars: 0, unpriced: 0 };
  for (const chat of listChats()) {
    for (const turn of chat.turns as (typeof chat.turns[number] & { usage?: TurnUsage })[]) {
      if (turn.created < start || !turn.usage) continue;
      const input = Number(turn.usage.input_tokens) || 0, output = Number(turn.usage.output_tokens) || 0;
      if (!input && !output) continue;
      total.replies++; total.inputTokens += input; total.outputTokens += output;
      const model = String(turn.usage.request_identity || "").split("|")[2] || "";
      const price = priceOf(model);
      if (price) total.dollars += (input * price[0] + output * price[1]) / 1_000_000;
      else total.unpriced++;
    }
  }
  return total;
}
