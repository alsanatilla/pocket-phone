// Pocket's tools inside the OpenClaw gateway. The plugin holds no data and no database credentials: every call goes
// to Pocket's web process over loopback (`/internal/pip-tools`, src/server/pip-openclaw.js) with a per-boot token and
// the session key OpenClaw gives the call. Pocket created that session for one chat of one account, so it alone
// decides whose data a call reads; a session Pocket did not register gets nothing.
//
// Writes ask first, the OpenClaw way: before_tool_call returns requireApproval, the gateway raises a plugin approval,
// Pocket's server shows it in its own approval screen and resolves it. The preview is Pocket's (what the change would
// do, checked against the record as it is now), fetched through the same endpoint.
import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';

/** One request to Pocket. Pocket answers every tool outcome as JSON; only a broken connection throws. */
async function pocket(url, body, signal) {
  const response = await fetch(url, { method: 'POST', signal,
    headers: { 'content-type': 'application/json', 'x-pocket-tools': process.env.PIP_TOOLS_TOKEN || '' }, body: JSON.stringify(body) });
  const value = await response.json().catch(() => null);
  if (!response.ok || !value || typeof value !== 'object') return { error: 'pocket_unavailable', message: String(value?.message || 'Pocket did not answer.') };
  return value;
}

/** A tool result as OpenClaw grades it: `error` marks a failed call; Pocket's own answer travels under `pocket`. */
const result = answer => ({ content: [{ type: 'text', text: JSON.stringify(answer) }],
  details: { pocket: answer, ...(answer?.error ? { error: String(answer.error) } : {}) } });

export default definePluginEntry({
  id: 'pocket',
  name: 'Pocket',
  description: 'The person\'s Pocket: notes, tasks, calendar, thoughts, chat history, web lookups, cards, saves and jobs.',
  register(api) {
    const config = api.pluginConfig || {}, url = String(config.url || ''), writes = config.writes || [], sequential = new Set(config.sequential || []);
    for (const definition of config.tools || []) {
      // A factory, so each call carries the session key the host resolved for this run (never a model argument).
      api.registerTool(context => ({
        name: definition.name, label: definition.label || definition.name, description: definition.description, parameters: definition.parameters,
        // Cards and saves change the answer or the person's data: one at a time, in the order the model asked.
        ...(sequential.has(definition.name) ? { executionMode: 'sequential' } : {}),
        async execute(toolCallId, params, signal) {
          return result(await pocket(url, { action: 'execute', sessionKey: context.sessionKey || '', tool: definition.name, input: params ?? {}, callId: toolCallId }, signal));
        },
      }), { name: definition.name, workspaceAccess: false });
    }
    api.on('before_tool_call', async (event, context) => {
      if (!writes.includes(event.toolName)) return;
      const ready = await pocket(url, { action: 'preview', sessionKey: context.sessionKey || '', tool: event.toolName, input: event.params ?? {}, callId: event.toolCallId || context.toolCallId || '' }, context.abortSignal);
      // An invalid or refused change is not put to the person: the model hears why and can correct it.
      if (ready.error) return { block: true, blockReason: String(ready.message || ready.error) };
      return { requireApproval: { title: String(ready.title || 'Save a change').slice(0, 80), description: String(ready.description || ready.title || 'Pocket asks before it saves.').slice(0, 512),
        severity: 'info', allowedDecisions: ['allow-once', 'deny'], timeoutMs: 600000 } };
    }, { matcher: writes });
  },
});
