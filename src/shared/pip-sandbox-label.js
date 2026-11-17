/**
 * A readable title for one of the sandbox's coding tools (exec, read, write, edit, apply_patch, ls).
 *
 * Pocket's other tools each say what they do ("search notes · “…”, “draw a card”); the sandbox tools were the only
 * rows in a reply that said nothing but their own name. A command is described by what it does when that is clear,
 * and by a short excerpt when it is not, so a person can see "open example.com" instead of "exec · done".
 *
 * No imports: the client bundle and the server both read this.
 */
const baseName = path => String(path || '').split('/').filter(Boolean).pop() || 'a file';
const hostOf = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
const firstUrl = text => (text.match(/https?:\/\/[^\s'"`)]+/) || [''])[0];
const clip = (text, length) => text.length > length ? text.slice(0, length - 1) + '…' : text;

/** What an exec command is for, in as few words as the command allows. */
export function commandLabel(command) {
  const text = String(command || '').trim().replace(/\s+/g, ' ').slice(0, 400);
  if (!text) return 'run a command';
  // A chain runs its steps in order; the last one is what the person sees happen.
  const last = text.split(/\s*(?:&&|\|\||;)\s*/).filter(Boolean).pop() || text;
  const words = last.split(' '), program = words[0].replace(/^.*\//, ''), url = firstUrl(last), host = hostOf(url);
  if (program === 'browse') {
    const action = words[1] || '';
    if (action === 'navigate') return host ? 'open ' + host : 'open a page';
    if (action === 'snapshot') return 'read the page';
    if (action === 'screenshot' || action === 'screenshot_diff') return 'take a screenshot';
    if (action === 'tabs') return 'check the browser tabs';
    if (action === 'status') return 'check the browser';
    if (['click', 'fill', 'type', 'press', 'select', 'hover', 'scroll', 'drag', 'upload', 'wait_for', 'eval'].includes(action)) return 'use the browser';
    return 'use the browser';
  }
  if (/^python3?(\.\d+)?$/.test(program)) return 'run Python';
  if (/^pip3?$/.test(program)) return text.includes('install') ? 'install a Python package' : 'use pip';
  if (['npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx'].includes(program)) return text.includes(' install') ? 'install a package' : 'run ' + program;
  if (program === 'node') return 'run Node';
  if (program === 'git') return 'run git' + (words[1] ? ' ' + words[1] : '');
  if (program === 'curl' || program === 'wget') return host ? 'fetch ' + host : 'fetch a URL';
  if (program === 'ls' || program === 'find' || program === 'tree' || program === 'du') return 'list files';
  if (program === 'cat' || program === 'head' || program === 'tail' || program === 'less' || program === 'wc') return 'read ' + baseName(words.slice(1).find(word => !word.startsWith('-')) || 'a file');
  if (program === 'grep' || program === 'rg' || program === 'ag') return 'search files';
  if (program === 'sqlite3') return 'query a database';
  if (program === 'jq') return 'process JSON';
  if (program === 'unzip' || program === 'tar' || program === 'zip') return 'unpack an archive';
  if (program === 'apt-get' || program === 'apt') return 'install system packages';
  if (program === 'mkdir' || program === 'cp' || program === 'mv' || program === 'rm' || program === 'chmod') return 'change files';
  if (program === 'which' || program === 'command' || program === '--version') return 'check a program';
  return 'run “' + clip(text, 72) + '”';
}

/** The sandbox tools' title, or an empty string for any other tool (whose label Pocket already knows). */
export function sandboxLabel(name, input = {}) {
  if (name === 'exec') return commandLabel(input?.command);
  if (name === 'read') return 'read ' + baseName(input?.path);
  if (name === 'write') return 'write ' + baseName(input?.path);
  if (name === 'edit') return 'edit ' + baseName(input?.path);
  if (name === 'apply_patch') return 'edit files';
  if (name === 'ls') return 'list files';
  return '';
}
