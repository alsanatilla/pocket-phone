/**
 * The models the server's OpenClaw gateway can run, and how a chat's Pocket config maps onto one.
 *
 * In the native path the gateway owns the model call, so switching a chat's model is a per-session override on the
 * gateway (`sessions.patch`). The gateway can only select models it has configured: OpenCode Go's, on this
 * deployment, because that is the provider Pocket's gateway key belongs to. The picker lists exactly these.
 *
 * No imports: the gateway config, the API and the client bundle all read this.
 */
export const GATEWAY_PROVIDER = 'opencode-go';
export const OPENCODE_GO_BASE = 'https://opencode.ai/inference/go/openai/v1';

/** Curated with the provider's own ids; `name` is what a person sees. */
export const GATEWAY_MODELS = [
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', note: 'fastest on Pip’s prompt' },
  { id: 'glm-5.3', name: 'GLM 5.3', note: 'thoughtful, slower first word' },
  { id: 'kimi-k3.1-pro', name: 'Kimi K3.1 Pro', note: 'strongest, thinks first', thinking: true },
  { id: 'minimax-m3.1-flash', name: 'MiniMax M3.1 Flash', note: 'fast, a little less steady' },
];

/** True for any URL Pocket uses for OpenCode Go (the app and the gateway spell the path differently). */
export const isOpencodeBase = baseUrl => /^https:\/\/opencode\.ai\/(?:zen|inference)\/go\b/.test(String(baseUrl || '').replace(/\/+$/, ''));

/**
 * A chat's stored config → `<provider>/<model>` for the gateway, or '' when this deployment cannot run it
 * (another provider, a custom endpoint, or an id outside the configured list). An empty answer keeps the agent's
 * default model instead of failing the reply.
 */
export function gatewayModelFor(config) {
  const model = String(config?.model || '').trim();
  if (!model || !isOpencodeBase(config?.baseUrl)) return '';
  return GATEWAY_MODELS.some(entry => entry.id === model) ? GATEWAY_PROVIDER + '/' + model : '';
}
