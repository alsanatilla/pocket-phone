import { config, contextCoverage, requestBody } from './pip-core.js';

// The browser reply loop (pip-stream.js, AI SDK ToolLoopAgent run inside the tab), kept for the classic app only:
// its guests and its offline tabs answer here. The new app (src/app) never imports this module; every reply there
// runs on Pocket's server (docs/pip-agent-runtime.md). It lives apart from pip-core.js so that pip-core's importers
// do not carry the loop in their module graph.
export async function streamReply(chat, turn, options = {}) {
  const value = config(chat.config);
  let streamChat;
  try { ({ streamChat } = await import('./pip-stream.js')); }
  catch { throw new Error('Pip could not load. Reload Pocket and try again.'); }
  return streamChat(chat, turn, { ...options, value, body: requestBody({ ...chat, config: value }, turn, options.resume), coverage: contextCoverage({ ...chat, config: value }, turn) });
}
