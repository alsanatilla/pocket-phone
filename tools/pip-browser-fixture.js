// Import /tools/pip-browser-fixture.js in the isolated Astro dev preview.
// Modes: answer, prepare, hold, truncated, overflow. No paid provider calls.
await (async () => {
  if (!['http://localhost:8881', 'http://localhost:8882', 'http://127.0.0.1:8882'].includes(location.origin)) throw new Error('Use the isolated preview origin.');
  const cloud = await import('/src/client/cloud.js');
  const storage = await import('/src/client/workspace-storage.js');
  if (cloud.connected() || storage.activeAccount()) throw new Error('Use a guest preview before installing fixtures.');
  const { anthropicMessage, compatibleMessage } = await import('/tools/pip-provider-fixtures.mjs');
  const { ChatStore, setKey } = await import('/src/client/pip-core.js');
  const store = new ChatStore(), uid = location.hash.split('/').at(-1), chat = store.get(uid);
  if (!chat) throw new Error('Open a Pip chat first.');
  setKey(chat.config, 'sk-ant-fixture-only-00000000000000000000');
  const fixture = globalThis.pipFixture = { requests: [], mode: 'answer', fetch: (globalThis.pipFixture?.fetch || globalThis.fetch).bind(globalThis) };
  const endpoint = chat.config.baseUrl + (chat.config.provider === 'anthropic' ? '/messages' : '/chat/completions');
  globalThis.fetch = async (url, options) => {
    if (String(url) !== endpoint) return fixture.fetch(url, options);
    if (cloud.connected() || storage.activeAccount()) throw new Error('Fixtures cannot access a signed-in workspace.');
    const request = JSON.parse(options.body); pipFixture.requests.push(request);
    if (pipFixture.mode === 'overflow') return new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'prompt is too long: fixture' } }), { status: 400 });
    const native = String(url).endsWith('/messages');
    const hasResults = request.messages.some(message => message.role === 'tool' || Array.isArray(message.content) && message.content.some(part => part.type === 'tool_result'));
    const question = request.messages.filter(message => message.role === 'user').flatMap(message => typeof message.content === 'string' ? [message.content] : (message.content || []).filter(part => part.type === 'text').map(part => part.text)).at(-1) || '';
    const calls = pipFixture.mode === 'prepare' && !hasResults ? [
      { name: 'update_plan', input: { steps: [{ text: 'Prepare the requested note', status: 'done' }] }, id: 'plan_fixture' },
      { name: 'propose_action', input: { kind: 'note', title: 'Pip test', text: 'Blue car' }, id: 'proposal_fixture' }
    ] : [];
    const text = calls.length ? 'Preparing the requested note.' : pipFixture.mode === 'prepare' ? 'The note “Pip test” is prepared for review.' : /which stock/i.test(question) ? 'What is your investment horizon?' : 'AI SDK streamed this answer. Grüße 🌱';
    const wire = native ? anthropicMessage({ text, calls, usage: { input_tokens: 120 }, output: 74, complete: !['hold', 'truncated'].includes(pipFixture.mode) }) : compatibleMessage({ text, calls });
    const frames = wire.split(/\r?\n\r?\n/).filter(Boolean); let timer, cursor = 0;
    return new Response(new ReadableStream({
      start(controller) {
        timer = setInterval(() => {
          if (options.signal.aborted) { clearInterval(timer); controller.close(); return; }
          if (cursor === frames.length) { if (pipFixture.mode === 'hold') return; clearInterval(timer); controller.close(); return; }
          controller.enqueue(new TextEncoder().encode(frames[cursor++] + '\r\n\r\n'));
        }, 40);
      },
      cancel() { clearInterval(timer); }
    }), { headers: { 'content-type': 'text/event-stream' } });
  };
  return { fixture: true, account: 'guest', modes: ['answer', 'prepare', 'hold', 'truncated', 'overflow'] };
})();
