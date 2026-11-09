import { defaultConfig } from "../data/models.ts";
import { resolve } from "../../client/pip-credentials.js";
import { activeAccount } from "../../client/workspace-storage.js";
import { generateSurface, type StreamOptions } from "./engine.ts";
import { remoteSurface } from "./remote.ts";
import { momentKey, type Moment } from "./context.ts";
export { systemPrompt, userPrompt } from "./engine.ts";
export class NoModel extends Error {
  constructor() { super("Connect a model in settings."); this.name = "NoModel"; }
}
export async function streamSurface(moment: Moment, options: StreamOptions, force = false) {
  const value = defaultConfig();
  const credential = await resolve(value);
  if (!credential) throw new NoModel();
  if (activeAccount() && "relay" in credential) {
    const spec = await remoteSurface(momentKey(moment), options, { moment, config: value, force });
    if (!spec) throw new Error("Today could not be arranged.");
    return spec;
  }
  return generateSurface(moment, value, credential, options);
}
