import { APICallError } from 'ai';
import { CONTEXT_OVERFLOW } from './pip-limits.js';
const httpError = code => code === 401 || code === 403 ? 'The provider rejected your key or access. Check API settings.'
  : code === 429 ? 'The provider is busy or your quota is exhausted. Retry when you’re ready.'
  : code >= 500 ? 'The provider is temporarily unavailable. Retry when you’re ready.'
  : 'The provider could not accept this request (' + code + '). Check its model, tools and search settings.';
const OVERFLOW_CODE = /\b(?:request_too_large|context_length_exceeded|prompt_too_long)\b/i;
const LONG_INPUT = /\b(?:prompt|input|messages?|conversation)\s+(?:(?:is|are)\s+)?too\s+long\b|\b(?:input|prompt)\s+(?:tokens?|token\s+count)\b.{0,80}\b(?:exceeds?|greater\s+than|maximum)\b/i;
const CONTEXT_LIMIT = /\b(?:maximum|max)\s+(?:context|prompt)\s+(?:length|window|size)\b|\bcontext[ _-](?:length|window|size|limit)\b.{0,80}\b(?:exceeded|exceeds?|too\s+many|too\s+long)\b|\btoo\s+many\s+(?:input|prompt)\s+tokens\b/i;
const OUTPUT_LIMIT = /\b(?:max_tokens|max_completion_tokens|max_output_tokens|maximum(?:\s+supported)?\s+output|output\s+tokens?)\b/i;
function errorFields(value, depth = 0) {
  if (depth > 8) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.slice(0, 3).flatMap(item => errorFields(item, depth + 1));
  if (!value || typeof value !== 'object') return [];
  return ['code', 'type', 'message', 'error', 'metadata', 'raw'].flatMap(key => {
    let field = value[key];
    if (key === 'raw' && typeof field === 'string') { try { field = JSON.parse(field); } catch {} }
    return errorFields(field, depth + 1);
  });
}
const contextOverflow = value => errorFields(value).some(text => OVERFLOW_CODE.test(text) || LONG_INPUT.test(text) || !OUTPUT_LIMIT.test(text) && CONTEXT_LIMIT.test(text));

// Fixed public messages only. Provider exceptions can include bodies and credentials.
export function providerError(error) {
  if (error?.name === 'AbortError' || error?.name === 'PocketProviderError') return error;
  if (error?.lastError) return providerError(error.lastError);
  if (contextOverflow(error?.data || error) || error?.message === CONTEXT_OVERFLOW) return new Error(CONTEXT_OVERFLOW);
  if (APICallError.isInstance(error) && error.statusCode) return new Error(httpError(error.statusCode));
  if (error?.cause) return providerError(error.cause);
  if (error instanceof TypeError) return new Error('The provider could not be reached. Check your connection and browser support (CORS).');
  return new Error('The provider interrupted this reply. Check its settings or retry.');
}
const publicError = message => Object.assign(new Error(message), { name: 'PocketProviderError' });

const FREE_CHAIN = ['nvidia/nemotron-3-super-120b-a12b:free', 'inclusionai/ling-3.0-flash-sante:free', 'openrouter/free'];
export function freeFallbacks(value) {
  const host = new URL(value.baseUrl).hostname;
  if (value.provider !== 'compatible' || host !== 'openrouter.ai' || !(value.model.endsWith(':free') || value.model === 'openrouter/free')) return null;
  return (value.model === 'openrouter/free' ? FREE_CHAIN : [value.model, ...FREE_CHAIN.filter(model => model !== value.model)]).slice(0, 3);
}

async function errorText(response, signal) {
  const reader = response.body?.getReader(), decoder = new TextDecoder(); let text = '';
  if (!reader) return text;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  try {
    while (text.length < 4096 && !signal.aborted) { const { done, value } = await reader.read(); if (done) break; text += decoder.decode(value, { stream: true }); }
  } catch { /* The status decides; a stalled body still obeys Stop and the deadline. */ }
  finally { signal.removeEventListener('abort', abort); abort(); reader.releaseLock(); }
  return text.slice(0, 4096);
}

// AI SDK owns framing/parsing. This boundary enforces browser privacy and bounds.
function guardedFetch(value, fetcher, signal, clock, onRetry) {
  const endpoint = value.baseUrl + (value.provider === 'anthropic' ? '/messages' : '/chat/completions');
  return async (url, options) => {
    if (String(url) !== endpoint) throw publicError('The provider requested an unexpected endpoint. Check API settings.');
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    clock();
    const response = await fetcher(url, { ...options, signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (signal.aborted) { void response.body?.cancel().catch(() => {}); throw new DOMException('Stopped', 'AbortError'); }
    if (!response.ok) {
      const raw = await errorText(response, signal); if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
      let data; try { data = JSON.parse(raw); } catch { data = raw; }
      const overflow = response.status === 413 || [400, 422].includes(response.status) && contextOverflow(data);
      const retry = !overflow && [429, 502, 503].includes(response.status);
      if (retry) onRetry();
      const responseHeaders = Object.fromEntries(['retry-after', 'retry-after-ms'].flatMap(name => response.headers.has(name) ? [[name, response.headers.get(name)]] : []));
      throw new APICallError({ message: overflow ? CONTEXT_OVERFLOW : httpError(response.status), url: endpoint, requestBodyValues: {}, statusCode: response.status, responseHeaders, isRetryable: retry });
    }
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
      void response.body?.cancel().catch(() => {});
      throw publicError('This endpoint did not return a chat stream. Check its browser and streaming support.');
    }
    const reader = response.body.getReader(); let bytes = 0, released = false;
    const release = () => { if (!released) { released = true; signal.removeEventListener('abort', abort); reader.releaseLock(); } };
    const abort = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
          if (chunk.done) { release(); controller.close(); return; }
          bytes += chunk.value.byteLength;
          if (bytes > 4000000) throw publicError('The provider’s stream is too large. Stop and try a shorter request.');
          clock(); controller.enqueue(chunk.value);
        } catch (error) { await reader.cancel().catch(() => {}); release(); controller.error(error); }
      },
      async cancel() { await reader.cancel().catch(() => {}); release(); }
    });
    return new Response(body, { status: response.status, headers: response.headers });
  };
}

export async function providerModel(value, key, { fetcher, signal, clock, onRetry }) {
  const options = { apiKey: key, baseURL: value.baseUrl, fetch: guardedFetch(value, fetcher, signal, clock, onRetry) };
  if (value.provider === 'anthropic') {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    return createAnthropic({ ...options, headers: { 'anthropic-dangerous-direct-browser-access': 'true' } })(value.model);
  }
  const host = new URL(value.baseUrl).hostname;
  if (host === 'openrouter.ai') {
    const { createOpenRouter } = await import('@openrouter/ai-sdk-provider');
    return createOpenRouter(options).chat(freeFallbacks(value)?.[0] || value.model);
  }
  if (host === 'api.openai.com') {
    const { createOpenAI } = await import('@ai-sdk/openai');
    return createOpenAI(options).chat(value.model);
  }
  const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible');
  return createOpenAICompatible({ ...options, name: 'pocket-compatible' }).chatModel(value.model);
}

export function providerOptions(value) {
  if (value.provider === 'anthropic') return value.thinking ? { anthropic: { thinking: { type: 'adaptive', display: 'summarized' } } } : {};
  if (new URL(value.baseUrl).hostname === 'openrouter.ai') {
    const models = freeFallbacks(value);
    return { openrouter: { ...(models ? { models } : {}), ...(value.thinking ? { reasoning: { effort: 'medium' } } : {}) } };
  }
  return {};
}
