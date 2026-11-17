// ChatGPT memory → Pip's workspace.
//
//   node tools/chatgpt-memory.mjs --from memories.txt --workspace /data/openclaw/agents/pocket-xxxx
//   node tools/chatgpt-memory.mjs --from export.zip    --workspace … --dry-run
//
// Takes what ChatGPT's memory actually is — one short statement per line (the list under Settings →
// Personalization → Memory), a JSON array of the same, or the ZIP from Settings → Data controls → Export data.
// Preferences go to USER.md as directives, everything else to MEMORY.md, both deduplicated against what is there.
//
// Nothing is written without --workspace, and --dry-run only reports.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = name => { const at = args.indexOf('--' + name); return at < 0 ? '' : (args[at + 1] || ''); };
const has = name => args.includes('--' + name);
const from = flag('from'), workspace = flag('workspace'), dry = has('dry-run');

if (!from) { console.error('usage: node tools/chatgpt-memory.mjs --from <file> [--workspace <dir>] [--dry-run]'); process.exit(1); }

/** Every memory statement in the input, in order, without duplicates. */
async function statements(path) {
  const text = (await readFile(path, 'utf8').catch(async error => {
    if (!/\.zip$/i.test(path)) throw error;
    return ''; // a zip is unpacked below
  })) || '';
  if (text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const value = JSON.parse(trimmed);
      const list = Array.isArray(value) ? value : value.memories || value.memory || value.items || [];
      return list.map(item => typeof item === 'string' ? item : item?.memory || item?.content || item?.text || '').filter(Boolean);
    }
    return trimmed.split('\n').map(line => line.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
  }
  // A ChatGPT export: memories live in user.json/memory.json when the export carries them; conversations are not
  // memory and are not imported.
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, readdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'chatgpt-'));
  execFileSync('unzip', ['-qq', path, '-d', dir]);
  const found = [];
  for (const name of readdirSync(dir)) {
    if (!/^(user|memory|memories)\.json$/i.test(name)) continue;
    const value = JSON.parse(await readFile(join(dir, name), 'utf8'));
    const list = Array.isArray(value) ? value : value.memories || value.memory || [];
    for (const item of list) found.push(typeof item === 'string' ? item : item?.memory || item?.content || item?.text || '');
    if (Array.isArray(value?.memories)) for (const item of value.memories) found.push(typeof item === 'string' ? item : item?.memory || '');
  }
  return found.filter(Boolean);
}

const tidy = text => String(text).replace(/\s+/g, ' ').trim().replace(/\.$/, '');
const same = (a, b) => a.toLowerCase().replace(/[^a-z0-9äöüß ]/g, '').trim() === b.toLowerCase().replace(/[^a-z0-9äöüß ]/g, '').trim();
/** A preference describes the person, not the world: it belongs in USER.md. */
const isPreference = text => /^(prefers?|likes?|loves?|dislikes?|hates?|wants?|avoid|always|never|uses?|works?|lives?|is|speaks?|answers?|writes?|communicates?)/i.test(text);

const lines = [...new Set((await statements(from)).map(tidy).filter(text => text.length > 1 && text.length <= 300))];

let user = '', memory = '';
if (workspace) {
  await mkdir(workspace, { recursive: true });
  user = existsSync(join(workspace, 'USER.md')) ? await readFile(join(workspace, 'USER.md'), 'utf8') : '';
  memory = existsSync(join(workspace, 'MEMORY.md')) ? await readFile(join(workspace, 'MEMORY.md'), 'utf8') : '';
}

const existing = (user + '\n' + memory).split('\n').map(line => line.replace(/^[-*]\s*/, ''));
const fresh = lines.filter(line => !existing.some(known => same(known, line)));
const preferences = fresh.filter(isPreference), facts = fresh.filter(line => !isPreference(line));

const today = new Date().toISOString().slice(0, 10);
if (!dry && workspace && fresh.length) {
  if (preferences.length) {
    const block = '\n<!-- observed: ' + today + ' | status: active | source: chatgpt -->\n' + preferences.map(line => '- ' + line).join('\n') + '\n';
    await writeFile(join(workspace, 'USER.md'), user.replace(/\s*$/, '') + '\n' + block, 'utf8');
  }
  if (facts.length) {
    const block = (memory ? memory.replace(/\s*$/, '') + '\n' : '# Memory\n\n') + facts.map(line => '- ' + line).join('\n') + '\n';
    await writeFile(join(workspace, 'MEMORY.md'), block, 'utf8');
  }
}

console.log(JSON.stringify({ read: lines.length, fresh: fresh.length, duplicates: lines.length - fresh.length,
  preferences: preferences.length, facts: facts.length, wrote: dry ? 'dry-run' : Boolean(workspace) }, null, 2));
if (dry || !workspace) for (const line of fresh.slice(0, 40)) console.log((isPreference(line) ? 'USER   ' : 'MEMORY ') + line);
