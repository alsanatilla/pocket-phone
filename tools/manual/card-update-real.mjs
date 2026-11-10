// Real models, real pipeline: turn 1 draws a card, turn 2 asks for a change. Does the model call update_card on the
// earlier card (and not draw a second one)? Never prints a key.
import fs from 'node:fs';
const ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
for (const line of fs.readFileSync(ROOT + '/.env', 'utf8').split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const { readKey } = await import(ROOT + '/src/server/pip-keys.js');
const { ChatStore, DEFAULT_CONFIG, config, streamReply } = await import(ROOT + '/src/client/pip-core.js');
const { cardIds } = await import(ROOT + '/src/shared/pocket-card-tool.js');
const { OPENCODE_GO } = await import(ROOT + '/src/shared/pip-opencode.js');
class Memory { values = new Map(); get length() { return this.values.size; } key(i) { return [...this.values.keys()][i] ?? null; } getItem(k) { return this.values.get(k) ?? null; } setItem(k, v) { this.values.set(k, String(v)); } removeItem(k) { this.values.delete(k); } }
const key = await readKey('c50398a7-80e6-4949-b62b-27d8b288f70f', { provider: 'compatible', baseUrl: OPENCODE_GO });
const cards = text => (String(text).match(/```pocket[\s\S]*?```/g) || []).join('\n');
const CASES = [
  ['Mein Schlaf letzte Nacht: 7 h 12 min, HRV 62 ms, Ruhepuls 48. Zeig das als Kacheln.', 'Korrektur: HRV war 58 ms, nicht 62. Ändere die Karte.', /58/, /62/],
  ['My weekly running km: W1 22, W2 26, W3 31. Show it as a chart.', 'Week 4 was 35 km. Add it to the chart.', /35/, null],
];
for (const model of (process.argv[2] || 'glm-5.3,deepseek-v4.1-flash,kimi-k3.1-pro').split(',')) for (const [first, second, want, gone] of CASES) {
  globalThis.localStorage = new Memory();
  const chat = new ChatStore(globalThis.localStorage).create(config({ ...DEFAULT_CONFIG, provider: 'compatible', model, baseUrl: OPENCODE_GO, maxTokens: 4096 }));
  const started = Date.now();
  try {
    const one = { uid: 't1', text: first, context: [], created: Date.now() };
    Object.assign(one, await streamReply(chat, one, { key }), { status: 'done', updated: Date.now() }); chat.turns = [one];
    const ids = cardIds(one.answer);
    let saved = 0; const two = { uid: 't2', text: second, context: [], created: Date.now() };
    const reply = await streamReply(chat, two, { key, saveTurn: () => { saved++; } });
    const names = reply.activity.map(a => a.name + ':' + a.state).join(',');
    const ok = ids.length === 1 && saved >= 1 && cardIds(one.answer).join() === ids.join() && want.test(cards(one.answer)) && (!gone || !gone.test(cards(one.answer))) && !/drawn here with show_card/.test(reply.answer) && cardIds(reply.answer).length === 0;
    console.log(ok ? 'OK  ' : 'FAIL', model.padEnd(20), ((Date.now() - started) / 1000).toFixed(1) + 's', 'cards1=' + ids.length, 'saved=' + saved, 'newCards=' + cardIds(reply.answer).length, '[' + names + ']', JSON.stringify(reply.answer.replace(/```pocket[\s\S]*?```/g, '<card>').slice(0, 90)));
  } catch (error) { console.log('ERR ', model, String(error?.message).slice(0, 160)); }
}
