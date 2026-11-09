// "Sign in with OpenRouter": OAuth with PKCE, so nobody copies an API key.
// 1. connect() keeps a random verifier for this tab and sends the browser to OpenRouter with its SHA-256 hash;
// 2. OpenRouter returns to /next?code=…; captureReturn() moves the code out of the URL before anything renders;
// 3. finish() trades code + verifier for a key, which the settings screen stores like any other key.

const VERIFIER = "pocket:openrouter-verifier";
const CODE = "pocket:openrouter-code";

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export async function connect(): Promise<void> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  sessionStorage.setItem(VERIFIER, verifier);
  const callback = location.origin + location.pathname;
  const url = new URL("https://openrouter.ai/auth");
  url.searchParams.set("callback_url", callback);
  url.searchParams.set("code_challenge", await challengeFor(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  location.assign(url.toString());
}

/** On page load: if OpenRouter just sent us back, keep the code, clean the URL and open settings. */
export function captureReturn(): boolean {
  const query = new URLSearchParams(location.search);
  const code = query.get("code");
  if (!code || !sessionStorage.getItem(VERIFIER)) return false;
  sessionStorage.setItem(CODE, code);
  history.replaceState(null, "", location.pathname + "#/settings");
  return true;
}

export const pending = (): boolean => Boolean(sessionStorage.getItem(CODE) && sessionStorage.getItem(VERIFIER));

let exchange: Promise<string> | null = null;

/** Trades the returned code for a key, once: a second caller (React's dev double effect) shares the first. */
export function finish(fetcher: typeof fetch = fetch): Promise<string> {
  exchange ??= trade(fetcher).finally(() => { setTimeout(() => { exchange = null; }, 0); });
  return exchange;
}

async function trade(fetcher: typeof fetch): Promise<string> {
  const code = sessionStorage.getItem(CODE), verifier = sessionStorage.getItem(VERIFIER);
  sessionStorage.removeItem(CODE); sessionStorage.removeItem(VERIFIER);
  if (!code || !verifier) throw new Error("The OpenRouter sign-in did not come back complete. Try again.");
  const response = await fetcher("https://openrouter.ai/api/v1/auth/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }),
  });
  const body = await response.json().catch(() => null) as { key?: string } | null;
  if (!response.ok || !body?.key) throw new Error("OpenRouter did not accept the sign-in. Try again.");
  return body.key;
}
