import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// A fake OpenClaw Responses endpoint: a tool call in the first stream, then the answer in the second, so the client's
// whole contract (SSE, function_call, function_call_output, previous_response_id) is exercised without a gateway.
const requests = [];
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    const body = JSON.parse(raw); requests.push({ url: req.url, auth: req.headers.authorization, body });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (event, data) => res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
    if (requests.length === 1) {
      send('response.created', { type: 'response.created', response: { id: 'resp_1' } });
      send('response.output_item.done', { type: 'response.output_item.done', item: { type: 'function_call', name: 'echo', call_id: 'call_1', arguments: '{"text":"hi"}' } });
      send('response.completed', { type: 'response.completed', response: { id: 'resp_1', status: 'completed', usage: { input_tokens: 10, output_tokens: 2 } } });
    } else {
      send('response.output_text.delta', { type: 'response.output_text.delta', delta: 'The tool said ' });
      send('response.output_text.delta', { type: 'response.output_text.delta', delta: 'hi.' });
      send('response.completed', { type: 'response.completed', response: { id: 'resp_2', status: 'completed', usage: { input_tokens: 12, output_tokens: 8 } } });
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.env.PIP_GATEWAY_URL = 'http://127.0.0.1:' + server.address().port;
process.env.PIP_GATEWAY_TOKEN = 'test-token';
test.after(() => server.close());
const { gatewayConfigured, gatewayReply, gatewayTools } = await import('../src/server/pip-gateway.js');

test('a reply streams text, runs the tool Pocket owns, and continues with its output', async () => {
  assert.equal(gatewayConfigured(), true);
  const deltas = [], calls = [], ran = [];
  const result = await gatewayReply({
    input: [{ role: 'user', content: 'Use echo.' }], instructions: 'You are Pip.', tools: [{ type: 'function', name: 'echo', parameters: { type: 'object' } }],
    execute: async (callId, name, input) => { ran.push({ callId, name, input }); return { ok: true, said: input.text }; },
    onText: delta => deltas.push(delta), onCall: (name) => calls.push(name),
  });
  assert.equal(result.answer, 'The tool said hi.');
  assert.equal(result.id, 'resp_2');
  assert.deepEqual(ran, [{ callId: 'call_1', name: 'echo', input: { text: 'hi' } }]);
  assert.deepEqual(calls, ['echo']);
  assert.deepEqual(deltas, ['The tool said ', 'hi.']);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].auth, 'Bearer test-token');
  assert.equal(requests[1].body.previous_response_id, 'resp_1');
  assert.deepEqual(requests[1].body.input, [{ type: 'function_call_output', call_id: 'call_1', output: '{"ok":true,"said":"hi"}' }]);
  assert.equal(result.usage.total_tokens, undefined);
  assert.equal(result.usage.output_tokens, 8);
});

test('Pocket tools become gateway client tools with their own schemas', async () => {
  const tools = gatewayTools({ notes: true, grants: ['notes'] }, ['search_notes', 'show_card']);
  assert.deepEqual(tools.map(tool => tool.name), ['search_notes', 'show_card']);
  assert.equal(tools[0].type, 'function');
  assert.match(tools[0].description, /note/i);
  assert.equal(tools[0].parameters.type, 'object');
});
