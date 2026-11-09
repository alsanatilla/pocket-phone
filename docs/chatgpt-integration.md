# ChatGPT subscription connection

Status: not implemented or enabled. Hosted-app registration and ChatGPT plan-usage approval are required.

## Registration brief

- Application: Pocket
- Website: https://pocket-phone.vercel.app
- Source: https://github.com/alsanatilla/pocket-phone (MIT)
- Requested capability: each signed-in Pocket user connects their own ChatGPT account and explicitly authorizes use of their plan for Pip requests.
- Use case: a personal assistant with streamed conversation, research, charts and follow-up buttons. Existing Pocket read permissions and write approvals must continue to apply.
- Proposed production callback: `https://pocket-phone.vercel.app/api/pip/chatgpt/callback` (not implemented yet; register the exact agreed URL).
- Request hosted, multi-user ChatGPT plan usage, not only OpenID Connect identity sign-in.

OpenAI must supply the registered client ID, callback configuration, token-endpoint authentication method, permitted inference scopes and hosted inference contract. A confidential client additionally needs a server-side client secret; never include that secret in this repository or chat.

## Intended integration

Connect from Pip settings while already signed in to Pocket. Use Authorization Code with PKCE, nonce and short-lived, atomically consumed OAuth state bound to the initiating Pocket session. Validate issuer, audience, signature and nonce before linking an account; never link accounts solely by email.

Keep each user's granted scopes and credentials separate, encrypted on the server. Implement refresh, disconnect and revoked-access handling. Enable Pip inference only after verifying the plan-usage grant; successful identity sign-in alone is insufficient. Keep the existing chart renderer and follow-up actions.

Do not use Codex's built-in device login or the local/open-source dynamic-registration flow as a substitute for a hosted-app registration. Do not show a working connection button until the approved flow is configured and tested.

## Official references

- Hosted sign-in and required registration: https://developers.openai.com/siwc/website
- Client registration: https://developers.openai.com/siwc/request-client-id
- Plan usage and hosted-app availability: https://developers.openai.com/siwc/token-sharing-open-source
- Codex app-server authentication boundaries: https://learn.chatgpt.com/docs/app-server
