// A scheduled reply through the OpenClaw gateway. Routines are the first path that can switch: they are read-only
// (no approval, no durable pause) and they are exactly what should read the person's memory, which the gateway owns.
import { cardsIn } from '../shared/pocket-card-edit.js';
import { cardFence, replaceCard } from '../shared/pocket-card-tool.js';
import { gatewayReply, gatewayTools } from './pip-gateway.js';

/** The chat's turns as Responses input: one message each, the assistant's answer after the person's request. */
export function gatewayInput(turns) {
  return (turns || []).flatMap(item => {
    const items = [{ type: 'message', role: 'user', content: String(item.text || '') }];
    if (item.answer) items.push({ type: 'message', role: 'assistant', content: String(item.answer) });
    return items;
  }).filter(item => item.content.trim());
}

/** The marks a changed card keeps: its pin and its threshold, with a new time. */
const keptMarks = (id, old) => ({ id, updated: Date.now(), ...(old?.pinned ? { pinned: old.pinned } : {}), ...(old?.alert ? { alert: old.alert } : {}) });

/**
 * Runs one unattended reply on the gateway and returns it in the shape `streamChat` returns, so the routine code
 * around it does not change. `execute(name, args, signal)` is Pocket's tool runner; cards are placed by Pocket;
 * memory and the agent are the gateway's.
 */
export async function gatewayRoutine({ chat, turn, value, body, execute, onUpdate = () => {}, signal }) {
  // The gateway's own memory tools replace Pocket's: no list is injected and nothing is written to Pocket's table.
  const offered = (body.tools || []).filter(name => !name.startsWith('memory_') && name !== 'remember' && name !== 'forget');
  const answer = { text: '' }, activity = [];
  let revised = false;
  const result = await gatewayReply({
    input: gatewayInput(chat.turns) || [],
    instructions: body.instructions,
    tools: gatewayTools(value, offered),
    signal,
    onText: delta => { answer.text += delta; onUpdate({ answer: answer.text, phase: 'writing' }); },
    onCall: name => activity.push({ id: String(activity.length + 1), kind: 'tool', name, title: name, state: 'done' }),
    execute: async (_callId, name, args) => {
      const out = await execute(name, args, signal);
      // show_card's fence goes into the answer where the model drew it; update_card changes it in place.
      if (name === 'show_card' && out?.card) {
        answer.text = answer.text.replace(/\s+$/, '') + (answer.text.trim() ? '\n\n' : '') + out.card + '\n\n';
        onUpdate({ answer: answer.text });
      } else if (name === 'update_card' && out?.revise && out.id) {
        const fence = cardFence(out.spec, keptMarks(out.id, cardsIn(answer.text).find(card => card.id === out.id)));
        const here = replaceCard(answer.text, out.id, fence);
        if (here !== null) { answer.text = here; onUpdate({ answer: answer.text }); }
        else for (const item of chat.turns) {
          if (item.uid === turn.uid || typeof item.answer !== 'string') continue;
          const old = cardsIn(item.answer).find(card => card.id === out.id);
          if (!old) continue;
          const changed = replaceCard(item.answer, out.id, cardFence(out.spec, keptMarks(out.id, old)));
          if (changed !== null) { item.answer = changed; item.updated = Math.max(Date.now(), (item.updated || 0) + 1); revised = true; }
          break;
        }
      }
      return out;
    },
  });
  return { ...result, answer: answer.text, activity, revised };
}

/** The marks a changed card keeps: its pin and its threshold, with a new time. */
const marksFor = (id, old) => ({ id, updated: Date.now(), ...(old?.pinned ? { pinned: old.pinned } : {}), ...(old?.alert ? { alert: old.alert } : {}) });

/**
 * One chat reply on the gateway. Pocket's tools run here, a write pauses the run for the person through `durable`,
 * and a drawn card is placed where the model drew it — in this reply, or in an earlier one through `saveTurn`.
 */
export async function gatewayChat({ chat, turn, value, body, execute, preview, durable, saveTurn, onUpdate = () => {}, signal, writes = [] }) {
  let text = durable?.checkpoint?.runtime === 'gateway' ? String(durable.checkpoint.answer || '') : '';
  let revised = false;
  const activity = [];
  // The person's current message is part of the input; its answer is not (a resume continues the stored response).
  const history = (chat.turns || []).map(item => item.uid === turn.uid ? { ...item, answer: '' } : item);
  const result = await gatewayReply({
    input: gatewayInput(history),
    instructions: body.instructions,
    tools: gatewayTools(value, (body.tools || []).filter(name => name !== 'remember' && name !== 'forget')),
    writes, preview, durable, signal,
    onText: delta => { text += delta; onUpdate({ answer: text, phase: 'writing' }); },
    onCall: name => activity.push({ id: String(activity.length + 1), kind: 'tool', name, title: name, state: 'done' }),
    execute: async (callId, name, args, callSignal) => {
      const out = await execute(name, args, callSignal, callId);
      if (name === 'show_card' && out?.card) {
        text = text.replace(/\s+$/, '') + (text.trim() ? '\n\n' : '') + out.card + '\n\n';
        onUpdate({ answer: text });
      } else if (name === 'update_card' && out?.revise && out.id) {
        const here = replaceCard(text, out.id, cardFence(out.spec, marksFor(out.id, cardsIn(text).find(card => card.id === out.id))));
        if (here !== null) { text = here; onUpdate({ answer: text }); }
        else for (const item of history) {
          if (typeof item.answer !== 'string') continue;
          const old = cardsIn(item.answer).find(card => card.id === out.id);
          if (!old) continue;
          const changed = replaceCard(item.answer, out.id, cardFence(out.spec, marksFor(out.id, old)));
          if (changed !== null) { item.answer = changed; item.updated = Math.max(Date.now(), (item.updated || 0) + 1); revised = true; if (saveTurn) await saveTurn(item); }
          break;
        }
      }
      return out;
    },
  });
  return { ...result, answer: text, activity, revised };
}
