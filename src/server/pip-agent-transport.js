// Model transport only. OpenClaw owns continuation and tool execution; this makes one AI SDK request per call
// and translates between OpenClaw's messages/events and the AI SDK's.
import { streamText, tool, jsonSchema } from 'ai';
import { createAssistantMessageEventStream } from 'openclaw/plugin-sdk/llm';
import { providerModel, providerOptions, providerError } from '../client/pip-provider.js';

export const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
// Fixed text that providerError passes through unchanged.
const publicError = message => Object.assign(new Error(message), { name: 'PocketProviderError' });
const parsed = input => { if (input && typeof input === 'object') return input; try { const value = JSON.parse(input); return value && typeof value === 'object' ? value : {}; } catch { return {}; } };
// AI SDK provider metadata arrives in pieces (an Anthropic signature after its thinking, OpenRouter's growing
// reasoning_details); later pieces of one provider's record win.
const merge = (a, b) => { if (!b) return a; const out = { ...a }; for (const [k, v] of Object.entries(b)) out[k] = { ...out[k], ...v }; return out; };
const hasKeys = value => Boolean(value && Object.keys(value).length);

// What the model must get back from its own thinking: Anthropic's signed (or redacted) block, OpenRouter's
// reasoning_details, a compatible provider's reasoning_content. `providerOptions` on a thinking or toolCall block is
// the AI SDK's providerMetadata kept verbatim; thinkingSignature/redacted mirror Anthropic's for OpenClaw readers.
const reasoningOptions = p => p.providerOptions || (p.thinkingSignature ? { anthropic: p.redacted ? { redactedData: p.thinkingSignature } : { signature: p.thinkingSignature } } : undefined);
const thinkingBlock = (text, options) => {
  const anthropic = options?.anthropic, block = { type: 'thinking', thinking: text };
  if (anthropic?.signature) block.thinkingSignature = anthropic.signature;
  else if (anthropic?.redactedData) Object.assign(block, { thinkingSignature: anthropic.redactedData, redacted: true });
  if (hasKeys(options)) block.providerOptions = options;
  return block;
};
const opaque = p => Boolean(p.thinkingSignature || hasKeys(p.providerOptions));

/** Pocket's stored AI SDK history → OpenClaw messages. Earlier replies carry no thinking, and need none. */
export function toCore(messages, model) {
  return messages.flatMap(message => {
    if (message.role === 'user') {
      const content = typeof message.content === 'string' ? message.content : message.content.filter(p => p.type === 'text' && p.text).map(p => ({ type: 'text', text: p.text }));
      return content.length ? [{ role: 'user', content, timestamp: Date.now() }] : [];
    }
    if (message.role === 'tool') return message.content.filter(p => p.type === 'tool-result').map(p => {
      const output = p.output || {}, value = output.type === 'content' ? (output.value || []).filter(v => v.type === 'text').map(v => v.text).join('\n') : output.type === 'execution-denied' ? output.reason || 'The user declined this tool call.' : output.value;
      return { role: 'toolResult', toolCallId: p.toolCallId, toolName: p.toolName, content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value ?? null) }], isError: ['error-text', 'error-json', 'execution-denied'].includes(output.type), timestamp: Date.now() };
    });
    if (message.role !== 'assistant') return [];
    const parts = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
    const content = parts.flatMap(p => p.type === 'tool-call' ? [{ type: 'toolCall', id: p.toolCallId, name: p.toolName, arguments: parsed(p.input), ...(hasKeys(p.providerOptions) ? { providerOptions: p.providerOptions } : {}) }]
      : p.type === 'text' && p.text ? [{ type: 'text', text: p.text }]
      : p.type === 'reasoning' && (p.text || hasKeys(p.providerOptions)) ? [thinkingBlock(p.text || '', p.providerOptions)] : []);
    // An empty assistant message is refused by several providers; it says nothing, so it is left out.
    if (!content.length) return [];
    return [{ role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, usage: emptyUsage(), stopReason: content.some(p => p.type === 'toolCall') ? 'toolUse' : 'stop', timestamp: Date.now() }];
  });
}

/** OpenClaw messages → AI SDK messages for one request. */
export function toSdk(messages) {
  return messages.flatMap(m => {
    if (m.role === 'toolResult') {
      const value = m.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
      return [{ role: 'tool', content: [{ type: 'tool-result', toolCallId: m.toolCallId, toolName: m.toolName, output: { type: m.isError ? 'error-text' : 'text', value } }] }];
    }
    if (m.role === 'user') {
      const content = typeof m.content === 'string' ? m.content : m.content.flatMap(p => p.type === 'text' ? [{ type: 'text', text: p.text }] : p.type === 'image' ? [{ type: 'image', image: p.data, mediaType: p.mimeType }] : []);
      return content.length ? [{ role: 'user', content }] : [];
    }
    if (m.role !== 'assistant') return [];
    // Thinking goes back as reasoning: DeepSeek's thinking mode answers 400 within a tool loop without its
    // reasoning_content, and Anthropic with thinking on without the signed block before the tool call.
    const content = (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content).flatMap(p =>
      p.type === 'text' ? (p.text ? [{ type: 'text', text: p.text }] : [])
      : p.type === 'thinking' ? (p.thinking || opaque(p) ? [{ type: 'reasoning', text: p.thinking || '', ...(reasoningOptions(p) ? { providerOptions: reasoningOptions(p) } : {}) }] : [])
      : p.type === 'toolCall' ? [{ type: 'tool-call', toolCallId: p.id, toolName: p.name, input: p.arguments || {}, ...(hasKeys(p.providerOptions) ? { providerOptions: p.providerOptions } : {}) }] : []);
    // Thinking alone is no message to a provider (a cut-off reply, say); an empty one is refused outright.
    return content.some(p => p.type !== 'reasoning') ? [{ role: 'assistant', content }] : [];
  });
}

/**
 * The OpenClaw streamFn. `onRetry` runs when the provider is busy (429/502/503) before the SDK retries it (twice);
 * `clock` runs on every received chunk (an idle timer); `maxOutputTokens` is a number or a function read at each
 * request (what is left of the reply's budget); `onSource` receives AI SDK source parts.
 *
 * Events (OpenClaw's AssistantMessageEvent, `partial` is the live message): text_start/_delta/_end,
 * thinking_start/_delta/_end, toolcall_start → toolcall_delta (`delta` is the next piece of the argument JSON;
 * `partial.content[contentIndex].partialJson` the text so far, while streaming) → toolcall_end once per call with
 * `toolCall.arguments` parsed. A call made in text (textToolCalls) comes as start, one whole delta, end.
 * Usage follows OpenClaw: `input` excludes cache reads/writes, `totalTokens` sums all four. `usage.pocket` adds
 * `inputTokens` (the whole prompt, cache included) and `reasoningTokens` (part of `output`) when reported.
 */
export async function createTransport(value, key, { fetcher = fetch, signal = new AbortController().signal, onSource = () => {}, onRetry = () => {}, clock = () => {}, maxOutputTokens = value.maxTokens } = {}) {
  const model = await providerModel(value, key, { fetcher, signal, clock, onRetry });
  return (coreModel, context, options) => {
    const events = createAssistantMessageEventStream();
    const message = { role: 'assistant', content: [], api: coreModel.api, provider: coreModel.provider, model: coreModel.id, usage: emptyUsage(), stopReason: 'stop', timestamp: Date.now() };
    const signals = [options?.signal, signal].filter(Boolean), aborted = () => signals.some(s => s.aborted);
    void (async () => {
      const blocks = new Map(), ended = new Set();
      const open = (key, block, type) => { const index = message.content.push(block) - 1; blocks.set(key, index); events.push({ type, contentIndex: index, partial: message }); return index; };
      // A call cut off mid-arguments (length, error, Stop) never runs: it leaves the final message.
      const settle = () => { message.content = message.content.filter(p => p.type !== 'toolCall' || !('partialJson' in p)); };
      const callIndex = (id, name, metadata) => blocks.get('c:' + id) ?? open('c:' + id, { type: 'toolCall', id, name, arguments: {}, partialJson: '', ...(hasKeys(metadata) ? { providerOptions: metadata } : {}) }, 'toolcall_start');
      try {
        const limit = Math.floor(Number(typeof maxOutputTokens === 'function' ? maxOutputTokens() : maxOutputTokens));
        const stream = streamText({ model, system: context.systemPrompt, messages: toSdk(context.messages),
          tools: Object.fromEntries((context.tools || []).map(t => [t.name, tool({ description: t.description, inputSchema: jsonSchema(t.parameters) })])),
          // A spent budget still asks for one token rather than the provider's default; the loop decides to stop.
          maxOutputTokens: Number.isFinite(limit) ? Math.max(1, limit) : value.maxTokens,
          providerOptions: providerOptions(value), abortSignal: signals.length > 1 ? AbortSignal.any(signals) : signals[0], maxRetries: 2, onError: () => {} });
        events.push({ type: 'start', partial: message });
        let finish;
        for await (const part of stream.fullStream) {
          if (part.type === 'error') throw part.error;
          if (part.type === 'abort') throw new DOMException('Stopped', 'AbortError');
          if (part.type === 'text-start' || part.type === 'text-delta') {
            let index = blocks.get('t:' + part.id);
            if (index === undefined) index = open('t:' + part.id, { type: 'text', text: '' }, 'text_start');
            if (part.text) { message.content[index].text += part.text; events.push({ type: 'text_delta', contentIndex: index, delta: part.text, partial: message }); }
          } else if (part.type === 'text-end') {
            const index = blocks.get('t:' + part.id);
            if (index !== undefined) events.push({ type: 'text_end', contentIndex: index, content: message.content[index].text, partial: message });
          } else if (part.type === 'reasoning-start' || part.type === 'reasoning-delta' || part.type === 'reasoning-end') {
            let index = blocks.get('r:' + part.id);
            if (index === undefined) index = open('r:' + part.id, { type: 'thinking', thinking: '' }, 'thinking_start');
            const block = message.content[index];
            if (part.providerMetadata) Object.assign(block, thinkingBlock(block.thinking, merge(block.providerOptions, part.providerMetadata)));
            if (part.type === 'reasoning-delta' && part.text) { block.thinking += part.text; events.push({ type: 'thinking_delta', contentIndex: index, delta: part.text, partial: message }); }
            if (part.type === 'reasoning-end') events.push({ type: 'thinking_end', contentIndex: index, content: block.thinking, partial: message });
          } else if (part.type === 'tool-input-start') callIndex(part.id, part.toolName, part.providerMetadata);
          else if (part.type === 'tool-input-delta') {
            const index = callIndex(part.id, '', undefined), block = message.content[index];
            if (part.delta && !ended.has(part.id)) { block.partialJson += part.delta; events.push({ type: 'toolcall_delta', contentIndex: index, delta: part.delta, partial: message }); }
          } else if (part.type === 'tool-call') {
            if (ended.has(part.toolCallId)) continue;
            const streamed = blocks.has('c:' + part.toolCallId), index = callIndex(part.toolCallId, part.toolName, part.providerMetadata), block = message.content[index];
            const args = parsed(part.input);
            // The textToolCalls middleware (and some providers) give the whole call at once: it still streams once.
            if (!streamed) events.push({ type: 'toolcall_delta', contentIndex: index, delta: JSON.stringify(args), partial: message });
            Object.assign(block, { name: part.toolName, arguments: args }, part.providerMetadata ? { providerOptions: merge(block.providerOptions, part.providerMetadata) } : {});
            delete block.partialJson; ended.add(part.toolCallId);
            events.push({ type: 'toolcall_end', contentIndex: index, toolCall: block, partial: message });
          } else if (part.type === 'source') onSource(part);
          else if (part.type === 'finish') finish = part;
        }
        if (!finish) throw publicError('The connection ended before the reply was complete. Retry when you’re ready.');
        const usage = finish.totalUsage || {}, details = usage.inputTokenDetails || {}, count = n => typeof n === 'number' && Number.isFinite(n) ? n : 0;
        const cacheRead = count(details.cacheReadTokens), cacheWrite = count(details.cacheWriteTokens), output = count(usage.outputTokens);
        const input = typeof details.noCacheTokens === 'number' ? details.noCacheTokens : Math.max(0, count(usage.inputTokens) - cacheRead - cacheWrite);
        message.usage = { ...emptyUsage(), input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite,
          ...(typeof details.cacheReadTokens === 'number' || typeof details.cacheWriteTokens === 'number' ? { cacheTelemetry: { state: 'available' } } : {}),
          pocket: { inputTokens: count(usage.inputTokens), ...(typeof usage.outputTokenDetails?.reasoningTokens === 'number' ? { reasoningTokens: usage.outputTokenDetails.reasoningTokens } : {}) } };
        const reason = finish.finishReason;
        if (reason === 'content-filter' || reason === 'refusal') throw publicError('The provider declined this reply.');
        message.stopReason = reason === 'tool-calls' ? 'toolUse' : reason === 'length' ? 'length' : reason === 'stop' ? 'stop' : 'error';
        if (message.stopReason === 'error') throw publicError('The provider did not finish the reply. Retry when you’re ready.');
        settle(); events.push({ type: 'done', reason: message.stopReason, message }); events.end(message);
      } catch (error) {
        message.stopReason = aborted() ? 'aborted' : 'error'; message.errorMessage = providerError(error).message;
        settle(); events.push({ type: 'error', reason: message.stopReason, error: message }); events.end(message);
      }
    })();
    return events;
  };
}
