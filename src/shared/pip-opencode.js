// OpenCode Go speaks the OpenAI chat-completions protocol, but two things stop a browser from using it directly:
// it answers no CORS preflight, and it routes a request by an `x-opencode-session` header. Pocket therefore proxies
// it from its own origin (forwarding the caller's own key), and a direct caller — the phone, or a run on the server —
// sends the same opaque session id here. It is derived from the key with a salted hash: stable across requests, and
// it never carries the key itself.
export const OPENCODE_GO = 'https://opencode.ai/inference/go/openai/v1';

/** Their docs ask a client to identify itself by name and version, not as a generic HTTP library. */
export const OPENCODE_UA = 'pocket-pip/1.0 (+https://pocket-phone.vercel.app)';

/** The upstream URL for a proxied path, or '' when the path is not the one chat endpoint Pip uses. */
export function opencodeTarget(path) {
  const clean = String(path || '').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  return ['chat/completions', 'v1/chat/completions'].includes(clean) ? OPENCODE_GO + '/chat/completions' : '';
}

/** An opaque routing id for this key: stable across requests, useless to anyone who reads it. */
export function opencodeSession(key) {
  const text = 'pocket-opencode-go:' + String(key || '');
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b + code, 0x85ebca6b) >>> 0; b = (b ^ (b >>> 13)) >>> 0;
  }
  const hex = n => (n >>> 0).toString(16).padStart(8, '0');
  return 'pocket-' + hex(a) + hex(b) + hex(Math.imul(a ^ b, 0x27d4eb2f)) + hex((a + b) >>> 0) + hex(Math.imul(a + 0x9e3779b9, 0x165667b1));
}
