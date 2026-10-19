// A conversation names itself once, from what it was about. This is one small reply of its own — no tools, a few
// dozen tokens, right after the first answer — so a chat never keeps a name like "New chat" or a whole pasted
// question as its title. A failure here is not part of the reply: an unnamed chat simply keeps the name it had.

const PROMPT = 'Name this conversation for a sidebar: at most five words, a concrete topic, no quotes, no trailing '
  + 'period, in the language of the request. Answer with the name only.';

const hostOf = value => { try { return new URL(value.baseUrl).hostname; } catch { return ''; } };

/**
 * The budgets to try, cheapest first. A reasoning model can spend a small budget on thinking and never write the
 * name, so it gets one roomier second chance — except for Anthropic, which only thinks when the chat asks it to.
 */
function attempts(value) {
  const quiet = value.provider === 'compatible' && hostOf(value) !== 'openrouter.ai';
  const quick = quiet ? { budget: 64, options: { openaiCompatible: { reasoningEffort: 'none' } } } : { budget: 64 };
  return value.provider === 'anthropic' ? [quick] : [quick, { budget: 1200 }];
}

/** The model's suggested chat name, or '' when it cannot be named. */
export async function suggestTitle(value, credential, request, answer, { fetcher = fetch, signal = AbortSignal.timeout(20_000) } = {}) {
  const asked = String(request || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const replied = String(answer || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!asked) return '';
  try {
    const { streamText } = await import('ai');
    // Loaded here, not at the top: naming a chat must not pull the SDK into Pocket's first load.
    const { providerModel } = await import('./pip-provider.js');
    const model = await providerModel(value, credential, { fetcher, signal, clock: () => {}, onRetry: () => {} });
    const prompt = PROMPT + '\n\nRequest: ' + asked + (replied ? '\n\nAnswer: ' + replied : '');
    for (const attempt of attempts(value)) {
      try {
        const stream = streamText({ model, maxOutputTokens: attempt.budget, prompt, ...(attempt.options ? { providerOptions: attempt.options } : {}) });
        let text = '';
        for await (const part of stream.textStream) { text += part; if (text.length > 240) break; }
        const name = title(text);
        if (name) return name;
      } catch { /* another budget may still name it */ }
    }
  } catch { /* no name is not a failed reply */ }
  return '';
}

/** The first line of what the model said, as a chat title: no label, quotes or trailing stop, bounded. */
export function title(text) {
  const line = String(text || '').split('\n').map(part => part.trim()).find(Boolean) || '';
  return line.replace(/^[\s"'“”„«»(]+/, '')
    .replace(/^(?:chat\s+)?(?:title|name|titel|name)\s*[:–—]\s*/i, '')
    .replace(/[\s"'“”„«»).,!?;:]+$/, '')
    .replace(/\s+/g, ' ').slice(0, 64).trim();
}
