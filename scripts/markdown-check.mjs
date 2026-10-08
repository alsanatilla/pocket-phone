// Focused checks for the native Markdown boundary. Run with Node 24: node scripts/markdown-check.mjs
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { htmlToHast } from 'satteri';
import { noteProseLines } from '../src/shared/note-lines.js';

const markdownURL = new URL('../src/server/markdown.ts', import.meta.url);
const { renderMarkdown, markdownInput } = await import(markdownURL);
const taskDir = await mkdtemp(join(tmpdir(), 'pocket-markdown-check-'));
try {
const routePath = join(taskDir, 'endpoint.ts');
const routeSource = await readFile(new URL('../src/pages/api/markdown.ts', import.meta.url), 'utf8');
await writeFile(routePath, routeSource.replace("'../../server/markdown.js'", JSON.stringify(markdownURL.href)));
const { POST } = await import(pathToFileURL(routePath));
let checks = 0;
const test = async (name, run) => { await run(); checks++; console.log('PASS ' + name); };
const html = (source, options = {}) => renderMarkdown({ source, ...options });
const api = async (source, headers = {}, options = {}) => {
  const response = await POST({ request: new Request('https://pocket.test/api/markdown', { method: 'POST', headers: { origin: 'https://pocket.test', 'content-type': 'application/json', ...headers }, body: typeof source === 'string' ? source : JSON.stringify(source), ...options }) });
  return { status: response.status, headers: response.headers, body: await response.json() };
};
function elements(root) {
  return [root, ...(root.children ?? []).flatMap(elements)].filter(node => node.type === 'element');
}

await test('native CommonMark headings/quotes/nested lists/reference links', () => {
  const result = html('# Main\n\nSetext\n------\n\n> **bold** and *italic*\n> soft continuation\n\n3. outer\n   - nested\n\n[reference][site]\n\n[site]: https://example.com "Title"');
  assert.match(result, /<h2>Main<\/h2>/); assert.match(result, /<h3>Setext<\/h3>/);
  assert.match(result, /<blockquote>/); assert.match(result, /<strong>bold<\/strong>/); assert.match(result, /<br>soft continuation/);
  assert.match(result, /<ol start="3">[\s\S]*<ul>[\s\S]*nested/);
  assert.match(result, /href="https:\/\/example.com\/" target="_blank" rel="noopener noreferrer" title="Title"/);
});
await test('GFM tasks/tables/alignment/strikethrough/autolinks', () => {
  const result = html('- [ ] Open\n- [x] Done\n\n| left | right | centre |\n| :- | -: | :-: |\n| ~~old~~ | https://example.com | `x` |');
  assert.match(result, /<ul class="tasks">/); assert.match(result, /\[ \] Open/); assert.match(result, /\[x\] Done/); assert.doesNotMatch(result, /<input/);
  assert.match(result, /<div class="md-table"><table>/); for (const align of ['left','right','center']) assert.match(result, new RegExp('data-align="'+align+'"'));
  assert.match(result, /<del>old<\/del>/); assert.match(result, /<code>x<\/code>/); assert.match(result, /<a href="https:\/\/example.com\/"/);
});
await test('native footnotes link to unique safe namespaced ids, including non-ASCII definitions', () => {
  const result = html('See[^ä] and again[^ä].\n\n[^ä]: The *definition*.');
  const parsed = elements(htmlToHast(result, { fragment: true }));
  const ids = new Set(parsed.map(node => node.properties.id).filter(Boolean));
  assert.equal(ids.size, 4);
  for (const id of ids) assert.match(id, /^md-[a-f0-9]{32}-[A-Za-z0-9._~%-]+$/);
  for (const node of parsed.filter(node => node.tagName === 'a' && node.properties.href.startsWith('#'))) assert.ok(ids.has(node.properties.href.slice(1)));
  assert.match(result, /class="footnotes"/); assert.match(result, /class="sr-only"/);
  assert.notEqual(result.match(/md-[a-f0-9]{32}-/)[0], html('See[^ä].\n\n[^ä]: Definition.').match(/md-[a-f0-9]{32}-/)[0]);
});
await test('code preserves escaped source/language and never parses Markdown inside', () => {
  const result = html('```js\nconst html = "<img src=x onerror=alert(1)>";\n**raw**\n```\n\n    <script>alert(2)</script>\n\n`<b>inline</b>`');
  assert.match(result, /<pre><code class="language-js">/); assert.match(result, /&lt;img src=x onerror=alert\(1\)&gt;/); assert.match(result, /\*\*raw\*\*/);
  assert.doesNotMatch(result, /<script|<img|<strong>raw/);
  assert.match(result, /<code>&lt;b&gt;inline&lt;\/b&gt;<\/code>/);
});
await test('raw HTML stays literal, with no active elements/attributes', () => {
  const result = html('<script>alert("x")</script>\n\n<svg onload=alert(1)><a href="javascript:alert(1)">hi</a></svg>\n\nText <img src="https://tracker.test/x" onerror="alert(2)"> <br> done.');
  assert.match(result, /&lt;script&gt;/); assert.match(result, /&lt;svg onload/); assert.match(result, /&lt;img src=/); assert.match(result, /&lt;br&gt;/);
  const tags = elements(htmlToHast(result, { fragment: true })).map(node => node.tagName);
  for (const tag of ['script','svg','img','iframe','style','input']) assert.ok(!tags.includes(tag));
});
await test('URL allowlist rejects active schemes/credentials/protocol relative, preserves Pocket routes', () => {
  const result = html('[one](javascript:alert%281%29) [two](data:text/html,foo) [three](https://u:p@example.com/) [four](//example.com) [five](/notes/abc) [six](#/tasks/pip-123) [mail](mailto:me@example.com)');
  assert.doesNotMatch(result, /href="(?:javascript:|data:|https:\/\/u:p|\/\/)/); assert.match(result, /href="#\/notes\/abc"/); assert.match(result, /href="#\/tasks\/pip-123"/); assert.match(result, /href="mailto:me@example.com"/);
});
await test('Markdown images are user-opened links, and image inside anchor cannot nest anchors', () => {
  const result = html('![description](https://tracker.test/image.png)\n\n[![inside](https://tracker.test/other.png)](https://example.com)');
  assert.doesNotMatch(result, /<img/); assert.match(result, /href="https:\/\/tracker.test\/image.png"[^>]*>description<\/a>/); assert.match(result, /href="https:\/\/example.com\/"[^>]*>inside<\/a>/);
  assert.equal((result.match(/<a /g) || []).length, 2);
});
await test('frontmatter is ordinary content; heading attributes cannot create source IDs/classes', () => {
  const result = html('---\nsecret: visible\n---\n\n# Heading {#constructor .unsafe}');
  assert.match(result, /secret: visible/); assert.match(result, /\{#constructor \.unsafe\}/); assert.doesNotMatch(result, /id="constructor"|class="unsafe"/);
});
await test('inline native formatting escapes HTML and keeps leading block punctuation literal', () => {
  assert.equal(html('**bold** *em* `code`', { inline: true }), '<strong>bold</strong> <em>em</em> <code>code</code>');
  assert.equal(html('# title', { inline: true }), '# title');
  assert.equal(html('<b>plain</b>', { inline: true }), '&lt;b&gt;plain&lt;/b&gt;');
  assert.doesNotMatch(html('[![inner](https://tracker.test/a)](https://example.com)', { inline: true }), /<a[^>]*>[\s\S]*<a/);
});
await test('thought annotation safely formats text/status and preserves neighboring structure', () => {
  const result = html('before\n>> a **thought** @tomorrow\nafter\n\n- list', { annotations:[{line:2,thought:{text:'a **thought** <img src=x>',status:'parked <script>'},strip:{top:0.1,bottom:0.2}}] });
  assert.match(result, /<p>before<\/p>/); assert.match(result, /<p class="thought-line" data-top="0.1" data-bottom="0.2">/); assert.match(result, /<strong>thought<\/strong> &lt;img src=x&gt;/); assert.match(result, /parked &lt;script&gt;/); assert.match(result, /<p>after<\/p>/); assert.match(result, /<ul>/);
  assert.doesNotMatch(result, /<img|<script/);
  const linked = html('>> [site][target] <b>literal</b> [^a]\n\n[target]: https://example.com\n\n[^a]: A footnote.', {annotations:[{line:1,thought:{text:'[site][target] <b>literal</b> [^a]',status:'parked'}}]});
  assert.match(linked, /class="thought-line"[\s\S]*href="https:\/\/example.com\/"/); assert.match(linked, /&lt;b&gt;literal&lt;\/b&gt;/); assert.match(linked, /<sup><a href="#md-/);
  const rawBlock = html('<div>\n>> raw block\n</div>', {annotations:[{line:2,thought:{text:'wrong',status:'parked'}}]});
  assert.doesNotMatch(rawBlock, /thought-line|wrong/); assert.match(rawBlock, /&gt;&gt; raw block/);
});
await test('fenced and indented code ignores all thought/strip annotations', () => {
  const source = '```\n>> fenced\n```\n\n    >> indented\n\nnormal';
  const result = html(source, { annotations:[{line:2,thought:{text:'wrong',status:'parked'},strip:{top:0.1,bottom:0.2}},{line:5,thought:{text:'wrong',status:'parked'},strip:{top:0.2,bottom:0.3}}] });
  assert.doesNotMatch(result, /thought-line|data-top|wrong/); assert.match(result, /&gt;&gt; fenced/); assert.match(result, /&gt;&gt; indented/);
});
await test('code in list/quote does not receive handwriting handles or thought substitution', () => {
  const source = '- ```\n  >> inside\n  ```\n\n> ```\n> >> quoted\n> ```';
  const result = html(source, { annotations:[{line:1,strip:{top:0.1,bottom:0.2}},{line:2,thought:{text:'wrong',status:'parked'},strip:{top:0.2,bottom:0.3}},{line:6,thought:{text:'wrong',status:'parked'},strip:{top:0.3,bottom:0.4}}] });
  assert.doesNotMatch(result, /thought-line|data-top|wrong/); assert.match(result, /&gt;&gt; inside/); assert.match(result, /&gt;&gt; quoted/);
});
await test('paper paragraph crops stay per line; source links/formatting preserved', () => {
  const result = html('first **bold**\nsecond [link](https://example.com)\nthird', { annotations:[{line:1,strip:{top:0.1,bottom:0.2}},{line:2,strip:{top:0.2,bottom:0.3}},{line:3,strip:{top:0.3,bottom:0.4}}] });
  assert.match(result, /<p data-top="0.1" data-bottom="0.2">first <strong>bold<\/strong><\/p>/); assert.match(result, /<p data-top="0.2" data-bottom="0.3">second <a/); assert.match(result, /<p data-top="0.3" data-bottom="0.4">third<\/p>/);
  const linked = html('first **bold\nsecond bold** and [site][target] [^a]\n\n[target]: https://example.com\n\n[^a]: A footnote.', {annotations:[{line:1,strip:{top:0.1,bottom:0.2}},{line:2,strip:{top:0.2,bottom:0.3}}]});
  assert.match(linked, /<p data-top="0.1" data-bottom="0.2">first <strong>bold<\/strong><\/p>/); assert.match(linked, /<p data-top="0.2" data-bottom="0.3"><strong>second bold<\/strong> and <a href="https:\/\/example.com\/"/); assert.match(linked, /<sup><a href="#md-/);
  const loose = html('- first\n\n  second', {annotations:[{line:1,strip:{top:0.1,bottom:0.2}},{line:3,strip:{top:0.2,bottom:0.3}}]});
  assert.equal((loose.match(/data-top="0.1"/g)||[]).length,1); assert.equal((loose.match(/data-top="0.2"/g)||[]).length,1);
});
await test('invalid metadata rejected without trusting HTML or non-finite crop numbers', () => {
  for (const annotation of [{line:0,strip:{top:0,bottom:1}},{line:1,strip:{top:-1,bottom:1}},{line:1,strip:{top:0.5,bottom:0.1}},{line:1,strip:{top:0,bottom:Infinity}},{line:1,thought:{text:'x',status:'a'.repeat(81)}},{line:1,thought:{text:'x',html:'<script>'}},{line:1,thought:{text:' '}},{line:1,thought:{text:'first\nsecond'}}]) assert.throws(()=>markdownInput({source:'x',annotations:[annotation]}),{status:400});
  assert.equal(html('**inline**',{inline:true,annotations:[]}), '<strong>inline</strong>');
  assert.throws(()=>markdownInput({source:'x',inline:true,annotations:[{line:1,strip:{top:0,bottom:1}}]}),{status:400});
  assert.throws(()=>markdownInput({source:'x',annotations:[{line:1,strip:{top:0,bottom:1}},{line:1,strip:{top:0,bottom:1}}]}),{status:400});
});
await test('source length/node count/depth budgets fail cleanly, not stack overflow', () => {
  assert.throws(()=>html('x'.repeat(200001)),{status:413});
  assert.throws(()=>html('> '.repeat(3000)+'deep'),error=>error.status===413 && !(error instanceof RangeError));
  assert.throws(()=>html('*a* '.repeat(7000)),{status:413});
  assert.ok(html('x'.repeat(200000)).length > 200000);
});
await test('endpoint accepts JSON and exposes no-store/nosniff without source persistence', async () => {
  const result = await api({source:'**native**'});
  assert.equal(result.status,200); assert.deepEqual(result.body,{html:'<p><strong>native</strong></p>'}); assert.equal(result.headers.get('cache-control'),'no-store'); assert.equal(result.headers.get('x-content-type-options'),'nosniff');
});
await test('endpoint allows anonymous non-browser client but rejects cross-origin browser requests', async () => {
  assert.equal((await api({source:'x'},{origin:'https://evil.test'})).status,403);
  assert.equal((await api({source:'x'},{'sec-fetch-site':'cross-site'})).status,403);
  const headers = new Headers({'content-type':'application/json'});
  const result = await POST({request:new Request('https://pocket.test/api/markdown',{method:'POST',headers,body:JSON.stringify({source:'x'})})}); assert.equal(result.status,200);
  headers.set('cookie','session=fictional');
  const cookie = await POST({request:new Request('https://pocket.test/api/markdown',{method:'POST',headers,body:JSON.stringify({source:'x'})})}); assert.equal(cookie.status,403);
});
await test('endpoint rejects malformed JSON/content types/shapes without echoing source', async () => {
  const secret='fictional-private-string';
  for (const [body,headers,status] of [[`{"source":"${secret}"`,{},400],[{source:secret},{'content-type':'text/plain'},415],[{source:secret,html:'<script>'},{},400],[{source:42},{},400]]) {
    const result=await api(body,headers); assert.equal(result.status,status); assert.ok(!JSON.stringify(result.body).includes(secret)); assert.equal(result.headers.get('cache-control'),'no-store');
  }
});
await test('body budget supports200k multibyte characters and rejects unknown-length oversized streams', async () => {
  const valid=await api({source:'ä'.repeat(200000)}); assert.equal(valid.status,200);
  assert.equal((await api({source:'x'},{'content-length':'1048577'})).status,413);
  const stream=new ReadableStream({start(controller){for(let i=0;i<17;i++)controller.enqueue(new Uint8Array(65536).fill(32));controller.close();}});
  const result=await api('',{}, {body:stream,duplex:'half'}); assert.equal(result.status,413);
});
await test('local note saving extracts thought markers outside fenced and indented code', () => {
  const thoughts = text => noteProseLines(text).filter(item => /^\s*>>\s+/.test(item.line)).map(item => item.line.trim());
  assert.deepEqual(thoughts('>> real\n\n```js\n>> code\n```\n\n>> later'), ['>> real','>> later']);
  assert.deepEqual(thoughts('~~~\n>> code\n~~~\n>> real'), ['>> real']);
  assert.deepEqual(thoughts('````\n>> code\n```\n>> still code\n````\n>> real'), ['>> real']);
  assert.deepEqual(thoughts('    >> code\n\t>> code\n  \t>> code\n>> real'), ['>> real']);
  assert.deepEqual(thoughts('```\n>> unfinished code'), []);
  assert.deepEqual(thoughts('- ```js\n  >> code\n  ```\n>> real'), ['>> real']);
  assert.deepEqual(thoughts('> ```\n>> code\n> ```\n>> real'), ['>> real']);
  assert.deepEqual(thoughts('    ```\n>> real'), ['>> real']);
  assert.deepEqual(noteProseLines('a\n```\nx\n```\n>> last').at(-1), {line:'>> last', index:4});
});
console.log(`${checks} native Markdown and local note checks passed.`);

} finally {
  const taskTarget = resolve(taskDir);
  const taskRelative = relative(resolve(tmpdir()), taskTarget);
  if (!taskRelative || taskRelative.startsWith('..') || isAbsolute(taskRelative)) throw new Error('Markdown check directory left the temporary workspace.');
  await rm(taskTarget, { recursive: true, force: true });
}
