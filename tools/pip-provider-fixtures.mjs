// Protocol-valid fixtures exercise the installed SDK provider adapters, without
// provider credentials or paid model calls. Broken streams are explicit options.
export const event = value => 'data: ' + JSON.stringify(value) + '\r\n\r\n';
export const response = (wire, chunkSize = 7) => {
  const bytes = new TextEncoder().encode(wire);
  return new Response(new ReadableStream({ start(controller) {
    for (let at = 0; at < bytes.length; at += chunkSize) controller.enqueue(bytes.slice(at, at + chunkSize));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
};
export function anthropicMessage({ text = '', reasoning = '', signature = 'fixture-signature', calls = [], finish = calls.length ? 'tool_use' : 'end_turn', usage = { input_tokens: 0 }, output = 8, model = 'fixture-model', complete = true } = {}) {
  const frames = [{ type: 'message_start', message: { id: 'msg_fixture', role: 'assistant', model, content: [], usage } }];
  let index = 0;
  if (reasoning) {
    frames.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: reasoning } },
      { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature } },
      { type: 'content_block_stop', index }); index++;
  }
  if (text) {
    frames.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index, delta: { type: 'text_delta', text } },
      { type: 'content_block_stop', index }); index++;
  }
  for (const { name, input, id = 'toolu_fixture', raw } of calls) {
    frames.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {} } },
      { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: raw ?? JSON.stringify(input) } },
      { type: 'content_block_stop', index }); index++;
  }
  if (complete) frames.push({ type: 'message_delta', delta: { stop_reason: finish }, usage: { output_tokens: output } }, { type: 'message_stop' });
  return frames.map(event).join('');
}
export const systemText = request => Array.isArray(request.system) ? request.system.map(block => block.text || '').join('\n') : request.system || request.messages?.find(message => message.role === 'system')?.content || '';
export const messageText = message => typeof message.content === 'string' ? message.content : (message.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
export function compatibleMessage({ text = '', calls = [], finish = calls.length ? 'tool_calls' : 'stop', usage = { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 }, model = 'fixture-model', delta = {} } = {}) {
  return event({ id: 'chatcmpl_fixture', object: 'chat.completion.chunk', created: 1791500000, model,
    choices: [{ index: 0, delta: { role: 'assistant', ...(text ? { content: text } : {}), ...(calls.length ? { tool_calls: calls.map(({ name, input, id = 'call_fixture' }, index) => ({ index, id, type: 'function', function: { name, arguments: JSON.stringify(input) } })) } : {}), ...delta }, finish_reason: finish }], ...(usage ? { usage } : {}) }) + 'data: [DONE]\r\n\r\n';
}
