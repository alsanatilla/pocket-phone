# Pocket 0.14.0

Open the [web workspace](https://pocket-phone.vercel.app/) or the Pocket app and go to **pip**.

**OpenRouter.** Choose the OpenAI-compatible provider and use base URL `https://openrouter.ai/api/v1` with your OpenRouter key. The model can be `openrouter/free` or any `:free` model. Pip then lets OpenRouter fall back to NVIDIA Nemotron 3 Super, Ling 3.0 Flash and the free router, so a rate-limited model no longer ends the chat. OpenRouter caps free models per day; the cap is higher once the account has bought credits.

**Web search.** Tap **△ web** under the composer to turn it on. With Anthropic it is Anthropic's own search. With any other provider pip searches and reads pages through Firecrawl, and every search and page shows up in the activity list with its link. Firecrawl allows a few searches without a key. For more, create a free key at [firecrawl.dev](https://firecrawl.dev) and paste it as the **Firecrawl key**: in the browser under API settings, on the phone under Provider & model. The model must support function tools.

The release has six artifact types:

- **pocket-phone-0.14.0-unsigned.apk** — Android app, version code 40.
- Astro web source archive — browser app and server source.
- Full source archive — Android and web project.
- **BUILD-STATUS.json** — compilation and verification results.
- **USE-POCKET-0.14.0.md** — this guide.
- **SHA256SUMS.txt** — artifact checksums.

Another agent handles APK signing. Installing over an existing Pocket app while retaining its local data requires the existing signing certificate.

The test suite is skipped as requested. Astro production and Android APK builds passed. A live browser run with OpenRouter's free router and web search on returned a cited answer. The phone side is compiled, not run on a handset; [BUILD-STATUS.json](BUILD-STATUS.json) records actual results.
