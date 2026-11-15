// Pocket as a client of the OpenClaw gateway: one reply is a Responses stream, and every tool the model calls is
// executed here with Pocket's own tools, then handed back as a function_call_output. The agent, the workspace and
// the memory are the gateway's; Pocket supplies the person's data and draws what the reply asks for.
import { z } from 'zod';
import { SCHEMAS, sdkTools } from '../client/pip-sdk-tools.js';

const base = () => process.env.PIP_GATEWAY_URL || 'http://127.0.0.1:' + (process.env.PIP_GATEWAY_PORT || '18789');
const model = () => 'openclaw/' + (process.env.PIP_GATEWAY_AGENT || 'pocket');
/** Whether this deployment has a gateway to talk to. No gateway means the tab's own loop stays in charge. */
export const gatewayConfigured = () => Boolean(process.env.PIP_GATEWAY_TOKEN);

/** Pocket's offered tools as the gateway's client tools: the same names, descriptions and JSON schemas. */
export function gatewayTools(value, offered) {
  const definitions = sdkTools(offered, () => {});
  return offered.map(name => ({ type: 'function', name,
    description: definitions[name]?.description || name,
    parameters: z.toJSONSchema(SCHEMAS[name], { unrepresentable: 'any' }) }));
}

/** One request's Server-Sent Events: text as it arrives, the finished function calls, the terminal response. */
async function stream(body, { signal, onText }) {
  const response = await fetch(base() + '/v1/responses', { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.PIP_GATEWAY_TOKEN },
    body: JSON.stringify(body) });
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    throw Object.assign(new Error('The gateway answered ' + response.status + (detail ? ': ' + detail.slice(0, 300) : '')), { status: 502, code: 'gateway_failed' });
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', event = '', calls = [], final = null;
  const handle = data => {
    let value; try { value = JSON.parse(data); } catch { return; }
    if (event === 'response.output_text.delta' && typeof value.delta === 'string') onText(value.delta);
    else if (event === 'response.output_item.done' && value.item?.type === 'function_call') calls.push(value.item);
    else if (event === 'response.completed' || event === 'response.incomplete') final = value.response || value;
    else if (event === 'response.failed') {
      const message = value.response?.error?.message || value.error?.message || 'The reply failed.';
      throw Object.assign(new Error(message), { status: 502, code: 'gateway_failed' });
    }
  };
  // SSE frames are separated by a blank line; `data:` may span several lines, which are joined with newlines.
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let at; (at = buffer.indexOf('\n\n')) >= 0;) {
      const frame = buffer.slice(0, at); buffer = buffer.slice(at + 2);
      let data = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length) handle(data.join('\n'));
    }
  }
  return { calls, final };
}

/**
 * One reply through the gateway: stream it, run the tools it asks for in Pocket, continue with their results, until
 * the model writes its answer. `execute(callId, name, input, signal)` is Pocket's tool runner; `onUpdate` receives
 * the text and the calls as they happen. Never runs more than `maxSteps` requests (the same guard as the old loop).
 */
const paused = () => Object.assign(new Error('Waiting for a decision'), { name: 'RunPaused' });

export async function gatewayReply({ input, instructions, tools, execute, preview, approve, writes = [], durable, settled, onText = () => {}, onCall = () => {}, signal, maxSteps = 12 }) {
  let items = input, previous = '', answer = '', usage = {}, id = '';
  const saved = durable?.checkpoint?.runtime === 'gateway' ? durable.checkpoint : null;
  const decisions = settled || durable?.settled || null;
  if (saved) {
    // A paused reply continues from the calls it stored: what the person decided, then the rest of the batch.
    answer = saved.answer || ''; previous = saved.responseId || ''; id = previous; usage = saved.usage || {};
    items = [];
    for (const call of saved.calls || []) {
      const write = (saved.pending || []).some(item => item.toolCallId === call.call_id);
      const args = write ? (decisions?.get(call.call_id)?.input || (() => { try { return JSON.parse(call.arguments || '{}'); } catch { return {}; } })()) : (() => { try { return JSON.parse(call.arguments || '{}'); } catch { return {}; } })();
      let result;
      if (write && !decisions?.get(call.call_id)?.approved) result = { message: 'The user declined this change.', kind: 'action', action: { ...(saved.previews?.[call.call_id]?.action || {}), status: 'declined' } };
      else {
        try { result = await execute(call.call_id, call.name, args, signal); }
        catch (error) { result = { error: 'tool_failed', message: String(error?.message || error).slice(0, 500) }; }
      }
      items.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result ?? {}) });
    }
  }
  for (let step = 0; step < maxSteps; step++) {
    const { calls, final } = await stream({
      model: model(), input: items, instructions, tools, stream: true,
      ...(previous ? { previous_response_id: previous } : {}),
    }, { signal, onText: delta => { answer += delta; onText(delta); } });
    if (!final) throw Object.assign(new Error('The gateway stopped before the reply finished.'), { status: 502, code: 'gateway_failed' });
    id = final.id || id;
    usage = final.usage || usage;
    if (!calls.length) return { answer, usage, id, status: final.status || 'completed' };
    // A write the person has to approve pauses the run, as it does in the in-process loop: the calls and their
    // previews are stored, and the reply continues from them when the decision arrives.
    const writing = calls.filter(call => writes.includes(call.name));
    if (writing.length && durable && preview) {
      const pending = [], previews = {};
      for (const call of writing) {
        let args; try { args = JSON.parse(call.arguments || '{}'); } catch { args = {}; }
        const ready = await preview(call.name, args, signal);
        if (ready?.error) continue; // an invalid write is executed on resume and answers with its error
        pending.push({ approvalId: 'gw-' + call.call_id, toolCallId: call.call_id, toolName: call.name, input: args, rowId: call.call_id });
        previews[call.call_id] = ready;
      }
      if (pending.length) {
        await durable.pause({ runtime: 'gateway', responseId: id, answer, activity: calls.map(call => ({ id: call.call_id, kind: 'tool', name: call.name, title: call.name, state: 'done' })), usage,
          calls: calls.map(call => ({ call_id: call.call_id, name: call.name, arguments: call.arguments })), pending, previews });
        throw paused();
      }
    }
    items = [];
    for (const call of calls) {
      let args = (() => { try { return JSON.parse(call.arguments || '{}'); } catch { return {}; } })();
      onCall(call.name, args);
      let result;
      try {
        // A write waits for the person, as it does in the in-process loop: preview, ask, then run what was approved.
        if (writes.includes(call.name) && preview && approve) {
          const ready = await preview(call.name, args, signal);
          if (ready?.error) result = ready;
          else {
            const decision = (await approve([{ approvalId: 'gw-' + call.call_id, toolCallId: call.call_id, toolName: call.name, input: args, rowId: call.call_id }], signal))?.get(call.call_id);
            if (!decision?.approved) result = { message: 'The user declined this change.', kind: 'action', action: { ...ready.action, status: 'declined' } };
            else { if (decision.input) args = decision.input; result = await execute(call.call_id, call.name, args, signal); }
          }
        } else result = await execute(call.call_id, call.name, args, signal);
      }
      catch (error) { result = { error: 'tool_failed', message: String(error?.message || error).slice(0, 500) }; }
      items.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result ?? {}) });
    }
    previous = id;
  }
  throw Object.assign(new Error('The reply kept calling tools.'), { status: 502, code: 'gateway_loop' });
}
