// Public catalog only: no account keys or conversation content are sent to this endpoint.
export interface FreeModel {
  id: string; name: string; context: number | null; maxOutput: number | null;
  tools: boolean; reasoning: boolean; vision: boolean; description: string;
}
export const FREE_ROUTER: FreeModel = { id: "openrouter/free", name: "Auto · free models", context: null, maxOutput: null, tools: true, reasoning: false, vision: false, description: "OpenRouter chooses an available free model that supports your request." };
const positive = (n: unknown): number | null => typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
export function freeModels(payload: unknown): FreeModel[] {
  const rows = (payload as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(rows)) throw new Error("OpenRouter returned an invalid model list.");
  const models = new Map<string, FreeModel>();
  for (const raw of rows) {
    const row = raw as Record<string, any> | null;
    if (!row || typeof row.id !== "string" || !row.id.endsWith(":free")) continue;
    const price = row.pricing;
    if (!price || ![price.prompt, price.completion].every(p => (typeof p === "string" && p.trim() !== "" || typeof p === "number") && Number(p) === 0)) continue;
    if (price.request != null && Number(price.request) !== 0) continue;
    const parameters = Array.isArray(row.supported_parameters) ? row.supported_parameters : [];
    models.set(row.id, { id: row.id, name: typeof row.name === "string" ? row.name.replace(/\s*\(free\)$/i, "") : row.id,
      context: positive(row.context_length), maxOutput: positive(row.top_provider?.max_completion_tokens),
      tools: parameters.includes("tools"), reasoning: parameters.includes("reasoning") || parameters.includes("reasoning_effort"),
      vision: Array.isArray(row.architecture?.input_modalities) && row.architecture.input_modalities.includes("image"),
      description: typeof row.description === "string" ? row.description.slice(0, 600) : "",
    });
  }
  return [FREE_ROUTER, ...[...models.values()].sort((a, b) => Number(b.tools) - Number(a.tools) || a.name.localeCompare(b.name))];
}
let cached: { at: number; models: FreeModel[] } | null = null;
let pending: Promise<FreeModel[]> | null = null;
export function loadFreeModels(): Promise<FreeModel[]> {
  if (cached && Date.now() - cached.at < 5 * 60_000) return Promise.resolve(cached.models);
  pending ??= fetch("https://openrouter.ai/api/v1/models", { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(12000) })
    .then(async response => { if (!response.ok) throw new Error("Could not load OpenRouter’s models. Try again."); return freeModels(await response.json()); })
    .then(models => { cached = { at: Date.now(), models }; return models; })
    .finally(() => { pending = null; });
  return pending;
}
export const tokenSize = (n: number) => n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n);
