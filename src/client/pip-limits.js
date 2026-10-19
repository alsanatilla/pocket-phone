export const CONTEXT_OVERFLOW = 'This chat is too long for this model. Start a new chat, or choose a model with a larger context window.';
// A hashed asset from an older deployment is gone after Pocket updates, so a lazy adapter import can fail in an open tab.
export const POCKET_UPDATED = 'Pocket was updated while this tab was open. Reload, then restart this reply.';
export const RESEARCH_LIMITS = Object.freeze({ continuations: 8, calls: 20, finalCalls: 4, webCalls: 8, toolData: 48000, result: 8000, parallel: 3, deadlineMs: 300000 });
