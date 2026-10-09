import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatStore, ReplyRunner, DEFAULT_CONFIG, config, apiKey, setKey, saveSettings, settings, requestBody, streamReply } from '../src/client/pip-core.js';
import { streamChat } from '../src/client/pip-stream.js';
import { execute, definitions } from '../src/client/pip-tools.js';
import { event, response, anthropicMessage } from './pip-provider-fixtures.mjs';

class Memory {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
const ready = () => { const memory = new Memory(), store = new ChatStore(memory), chat = store.create(); return { memory, store, chat }; };
const anthropic = text => anthropicMessage({ text, model: 'canonical-model', usage: { input_tokens: 20 } });
const source = {kind:'note',uid:'note-1',title:'Trip',text:'Take the train'};
const turn = {uid:'turn-1',text:'What next?',context:[source]};

test('UTF-8, CRLF and multiline SSE framing survive single-byte chunks', async()=>{
  const { chat } = ready();
  const wire = ': ping\r\n' + anthropic('Grüße 🌱').replace(/data: (.+)\r\n\r\n/g, (_, json) => JSON.stringify(JSON.parse(json), null, 2).split('\n').map(line => 'data: ' + line).join('\r\n') + '\r\n\r\n');
  const result = await streamReply(chat, turn, { key: 'fixture', fetcher: async () => response(wire, 1) });
  assert.equal(result.answer, 'Grüße 🌱'); assert.equal(result.usage.runtime, 'ai-sdk');
});
test('Anthropic streams keep the answer, summary and usage separate', async()=>{
  const {chat}=ready(), updates=[];
  const wire=anthropicMessage({ text:'Take the train 🌱', reasoning:'Compare options.', signature:'private-signature', model:'canonical-model', usage:{ input_tokens:20 } });
  let request;
  const result=await streamReply(chat,turn,{key:'tab-key',fetcher:async(url,options)=>{request={url,options};return response(wire,1);},onUpdate:value=>updates.push(value)});
  assert.equal(result.answer,'Take the train 🌱');assert.equal(result.reasoning,'Compare options.');assert.equal(result.usage.output_tokens,8);assert.equal(result.model,'canonical-model');
  assert.equal(result.usage.last_input_tokens,20);assert.equal(result.usage.last_output_tokens,8);assert.equal(result.usage.history_replay.total,0);
  assert.equal(request.url,'https://api.anthropic.com/v1/messages');assert.equal(request.options.headers['x-api-key'],'tab-key');assert.equal(request.options.redirect,'error');assert.equal(request.options.credentials,'omit');
  assert.equal(request.options.headers['anthropic-dangerous-direct-browser-access'],'true');assert.ok(updates.length>1);assert.ok(!JSON.stringify(result).includes('private-signature'));
});
test('compatible streams do not double a summary supplied in two fields', async()=>{
  const {chat}=ready();chat.config=config({...DEFAULT_CONFIG,provider:'compatible',model:'local-model',baseUrl:'https://model.example/v1'});
  const wire=event({choices:[{index:0,delta:{reasoning_content:'One thought.',reasoning:'One thought.'}}]})+event({choices:[{index:0,delta:{content:'One answer.'},finish_reason:'stop'}],usage:{prompt_tokens:9,completion_tokens:3,prompt_tokens_details:{cached_tokens:4}}})+'data: [DONE]\n\n';
  let request;
  const result=await streamReply(chat,turn,{key:'own-key',fetcher:async(url,options)=>{request={url,options};return response(wire);}});
  assert.equal(result.answer,'One answer.');assert.equal(result.reasoning,'One thought.');assert.equal(result.usage.cache_read_input_tokens,4);assert.equal(request.options.headers.authorization,'Bearer own-key');assert.ok(!request.options.headers['x-api-key']);
  assert.equal(result.usage.last_input_tokens,9);assert.equal(result.usage.last_output_tokens,3);
});
test('truncated streams and reply limits stay unfinished', async()=>{
  const {chat}=ready();
  await assert.rejects(streamReply(chat,turn,{key:'key',fetcher:async()=>response(anthropicMessage({text:'Partial',complete:false}))}),/before the reply was complete/);
  await assert.rejects(streamReply(chat,turn,{key:'key',fetcher:async()=>response(anthropicMessage({text:'Partial',finish:'max_tokens',output:4096}))}),/reply token limit/);
});
test('request errors do not expose provider text or an echoed API key', async()=>{
  const {chat}=ready();
  await assert.rejects(streamReply(chat,turn,{key:'secret',fetcher:async()=>new Response('secret',{status:401})}),error=>!error.message.includes('secret')&&/rejected/.test(error.message));
  await assert.rejects(streamReply(chat,turn,{key:'secret',fetcher:async()=>response(event({error:{message:'secret'}}))}),error=>!error.message.includes('secret')&&/interrupted/.test(error.message));
});
test('context overflow is named with a fixed message, never retried and never echoes the body', async()=>{
  const overflow='This chat is too long for this model. Start a new chat, or choose a model with a larger context window.', generic='The provider could not accept this request (400). Check its model, tools and search settings.';
  const attempt=async(settings,status,body)=>{const {chat}=ready();if(settings)chat.config=config({...DEFAULT_CONFIG,...settings});let calls=0,message='';
    await assert.rejects(streamReply(chat,turn,{key:'key',fetcher:async()=>{calls++;return typeof body==='string'?new Response(body,{status}):body;}}),error=>{message=error.message;return true;});
    assert.equal(calls,1);assert.ok(!/secret|tokens|128000|200000/.test(message));return message;};
  const compatible={provider:'compatible',model:'local-model',baseUrl:'https://model.example/v1'}, openrouter={provider:'compatible',model:'openrouter/free',baseUrl:'https://openrouter.ai/api/v1'};
  assert.equal(await attempt(null,400,JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'prompt is too long: 210000 tokens > 200000 maximum secret'}})),overflow);
  assert.equal(await attempt(compatible,400,JSON.stringify({error:{message:"This model's maximum context length is 128000 tokens. secret",type:'invalid_request_error',param:'messages',code:'context_length_exceeded'}})),overflow);
  assert.equal(await attempt(openrouter,400,JSON.stringify({error:{message:'Provider returned error secret',code:400,metadata:{raw:JSON.stringify({error:{message:"This endpoint's maximum context length is 131072 tokens secret"}})}}})),overflow);
  assert.equal(await attempt(null,413,'secret request entity too large'),overflow);
  assert.equal(await attempt(null,400,JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'model: secret-model'}})),generic);
  for (const message of ['max_tokens must be less than the model context length.', 'Too many tokens requested for max_tokens; maximum supported output is 4096.']) {
    assert.equal(await attempt(compatible,400,JSON.stringify({error:{message}})),generic);
    assert.match(await attempt(compatible,200,response(event({error:{message}}))),/interrupted/);
  }
  // A validation error that echoes the request is not mistaken for overflow because the chat mentions a context window.
  assert.equal(await attempt(compatible,422,JSON.stringify({detail:[{msg:'Field required secret',input:{messages:[{content:'my context window is too long secret'}]}}]})),generic.replace('400','422'));
  assert.equal(await attempt(compatible,422,JSON.stringify({error:{message:'Invalid message format',metadata:{raw:JSON.stringify({detail:[{msg:'Field required',input:{messages:[{content:'Explain the maximum context length.'}]}}]})}}})),generic.replace('400','422'));
  assert.equal(await attempt(null,200,response(event({type:'error',error:{type:'invalid_request_error',message:'prompt is too long: secret'}}))),overflow);
});
test('unanswered questions keep their place with a marker; reasoning and partials do not repeat',()=>{
  const {chat}=ready();chat.turns=[{uid:'old-1',text:'First',context:[source],answer:'Answer',reasoning:'private trace',status:'done'},{uid:'old-2',text:'Failed',answer:'Partial',status:'failed'},{uid:'old-3',text:'Stopped',answer:'More partial',status:'stopped'},turn];
  const request=requestBody(chat,turn), json=JSON.stringify(request);
  assert.deepEqual(request.messages.map(m=>m.role),['user','assistant','user','assistant','user','assistant','user']);
  assert.equal(request.messages[1].content,'Answer');assert.match(request.messages[0].content,/Take the train/);
  assert.equal(request.messages[2].content,'Failed');assert.match(request.messages[3].content,/^\[No answer: this reply failed/);
  assert.equal(request.messages[4].content,'Stopped');assert.match(request.messages[5].content,/^\[No answer: the user stopped this reply/);
  for(const hidden of ['private trace','Partial','More partial'])assert.ok(!json.includes(hidden),hidden);
  assert.ok(!request.messages.at(-1).content.includes('<pocket_history_coverage>'),'nothing omitted, so no coverage block');assert.ok(request.instructions.includes('You are pip'));
});
test('keys are tab-only and bound to their endpoint; settings contain no key',()=>{
  const tab=new Memory(), disk=new Memory(), a=config({...DEFAULT_CONFIG,provider:'compatible',model:'model-a',baseUrl:'https://a.example/v1/'}), b=config({...a,baseUrl:'https://b.example/v1'});
  setKey(a,'my-private-key',tab);saveSettings(a,disk);assert.equal(apiKey(a,tab),'my-private-key');assert.equal(apiKey(b,tab),'');assert.equal(settings(disk).baseUrl,'https://a.example/v1');assert.ok(!JSON.stringify([...disk.values]).includes('my-private-key'));
  for(const url of ['http://provider.example/v1','https://user:password@provider.example/v1','https://provider.example/v1?key=x','https://provider.example/v1#x'])assert.throws(()=>config({...a,baseUrl:url}),/HTTPS/);
});
test('failed chat save prevents the paid request and keeps its draft',async()=>{
  const {memory,store,chat}=ready();store.update(chat.uid,c=>{c.draft='Keep my draft';c.context=[source];});let called=0;
  const runner=new ReplyRunner(store,{key:()=> 'key',stream:async()=>{called++;}});memory.setItem=()=>{throw new Error('Storage is full');};
  await assert.rejects(runner.send(chat.uid,{text:'Keep my draft',context:[source]}),/Storage is full/);assert.equal(called,0);assert.equal(runner.active,null);assert.equal(store.get(chat.uid).draft,'Keep my draft');assert.equal(store.get(chat.uid).context.length,1);
});
test('switching chats and editing a new draft leaves the reply in its original chat',async()=>{
  const {store,chat}=ready(), other=store.create({...DEFAULT_CONFIG,model:'another-model'});let finish, update;
  const runner=new ReplyRunner(store,{key:()=> 'key',stream:(_,__,options)=>{update=options.onUpdate;return new Promise(resolve=>{finish=resolve;});}});
  const pending=runner.send(chat.uid,{text:'First question',context:[source]});store.update(other.uid,c=>{c.draft='Other draft';});store.update(chat.uid,c=>{c.draft='Next question';});
  update({answer:'Beginning',reasoning:'Summary'});finish({answer:'Finished',reasoning:'Summary',model:'canonical-name',usage:{output_tokens:10}});await pending;
  assert.equal(store.get(chat.uid).turns[0].answer,'Finished');assert.equal(store.get(chat.uid).turns[0].status,'done');assert.equal(store.get(chat.uid).config.model,DEFAULT_CONFIG.model);assert.equal(store.get(chat.uid).draft,'Next question');assert.equal(store.get(other.uid).draft,'Other draft');assert.equal(store.get(other.uid).turns.length,0);
});
test('stop saves the latest partial and ignores late callbacks; retry replaces that answer',async()=>{
  const {store,chat}=ready();let finish, update, calls=0;
  const runner=new ReplyRunner(store,{key:()=> 'key',stream:async(_,__,options)=>{calls++;if(calls>1)return {answer:'Fresh answer',reasoning:'',usage:{}};update=options.onUpdate;return await new Promise(resolve=>{finish=resolve;});}});
  const pending=runner.send(chat.uid,{text:'A question'});update({answer:'A'});update({answer:'Newest partial'});runner.stop();const stopped=store.get(chat.uid).turns[0];assert.equal(stopped.status,'stopped');assert.equal(stopped.answer,'Newest partial');
  update({answer:'Late answer'});finish({answer:'Also late',reasoning:'',usage:{}});await pending;assert.equal(store.get(chat.uid).turns[0].answer,'Newest partial');
  await runner.send(chat.uid,{retry:stopped.uid});assert.equal(store.get(chat.uid).turns.length,1);assert.equal(store.get(chat.uid).turns[0].answer,'Fresh answer');assert.equal(store.get(chat.uid).turns[0].status,'done');assert.equal(calls,2);
});
test('provider failures keep a retryable question without replaying the partial',async()=>{
  const {store,chat}=ready();const runner=new ReplyRunner(store,{key:()=> 'key',stream:async(_,__,options)=>{options.onUpdate({answer:'Partial answer'});throw new Error('Disconnected');}});
  await runner.send(chat.uid,{text:'Question'});const failed=store.get(chat.uid).turns[0];assert.equal(failed.status,'failed');assert.equal(failed.error,'Disconnected');assert.equal(failed.text,'Question');assert.equal(failed.answer,'Partial answer');assert.equal(runner.active,null);
});
test('deleted chats cannot be resurrected by an outstanding request',async()=>{
  const {store,chat}=ready();let finish;
  const runner=new ReplyRunner(store,{key:()=> 'key',stream:()=>new Promise(resolve=>{finish=resolve;})});
  const pending=runner.send(chat.uid,{text:'Question'});store.remove(chat.uid);finish({answer:'Too late',reasoning:'',usage:{}});await pending;assert.equal(store.get(chat.uid),null);assert.equal(store.list().length,0);
});
test('a timeout cancels a stalled response without automatically retrying',async()=>{
  const {chat}=ready();let calls=0;
  await assert.rejects(streamReply(chat,turn,{key:'key',timeoutMs:5,fetcher:async(_,options)=>{calls++;return await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError'))));}}),/stopped responding/);assert.equal(calls,1);
});
for (const reason of ['timeout', 'stop']) test(reason + ' cancels a stalled error body without retrying', { timeout: 1000 }, async t => {
  const { chat } = ready(), stop = new AbortController(); let calls = 0, cancelled = false, bodyController;
  const body = new ReadableStream({ start(controller) { bodyController = controller; }, cancel() { cancelled = true; } });
  t.after(() => { try { bodyController.close(); } catch {} });
  const pending = streamReply(chat, turn, { key: 'key', signal: stop.signal, timeoutMs: reason === 'timeout' ? 10 : 500,
    fetcher: async () => { calls++; return new Response(body, { status: 400 }); } });
  const timer = reason === 'stop' && setTimeout(() => stop.abort(), 10); t.after(() => { if (timer) clearTimeout(timer); });
  await assert.rejects(pending, error => reason === 'stop' ? error.name === 'AbortError' : /stopped responding/.test(error.message));
  assert.equal(calls, 1); assert.equal(cancelled, true); assert.equal(body.locked, false);
});
test('damaged conversation data is kept rather than silently replaced',()=>{
  const {store,memory,chat}=ready();memory.setItem('pocket:pip-chat:'+chat.uid,'damaged-original');assert.throws(()=>store.get(chat.uid),/original data/);assert.equal(memory.getItem('pocket:pip-chat:'+chat.uid),'damaged-original');
});
test('a tool round gets a usable token allowance instead of the full-budget split',async()=>{
  // The reply limit is shared across rounds, but dividing it evenly across every possible
  // continuation left round 0 with too few tokens to finish a tool call, so the provider
  // stopped at max_tokens mid-arguments ("prepare action · failed").
  const {chat}=ready(), value=config({...DEFAULT_CONFIG});
  const body={...requestBody(chat,turn),tools:[{name:'propose_action',description:'Prepare an action',input_schema:{type:'object'}}]};
  const requests=[];
  const wire=anthropicMessage({text:'ok',model:'m',usage:{input_tokens:5},output:4});
  await streamChat(chat,turn,{value,body,key:'k',fetcher:async(url,options)=>{requests.push(JSON.parse(options.body));return response(wire);}});
  assert.equal(value.maxTokens,4096);
  assert.ok(requests[0].max_tokens>=2048,`first tool round allowance ${requests[0].max_tokens} should finish a tool call`);
  assert.ok(requests[0].max_tokens<=value.maxTokens);
});
// Native Anthropic web_search is not offered by Pocket; current web research
// uses Firecrawl client tools for every provider (covered below and in SDK tests).
test('a note can still be prepared after the budget forces synthesis', async () => {
  const { chat } = ready(), value = config({ ...DEFAULT_CONFIG });
  const body = requestBody(chat, { ...turn, text: 'Save a note about the car industry' });
  const truncated = anthropicMessage({ text: 'Let me check.', finish: 'max_tokens', usage: { input_tokens: 10 }, output: 12 });
  const proposing = anthropicMessage({ calls: [{ name: 'propose_action', id: 'toolu_1', input: { kind: 'note', title: 'Car industry turmoil', text: 'VW plans to cut jobs.' } }], output: 30 });
  const answering = anthropicMessage({ text: 'Prepared the note for you.' });
  let calls = 0;
  const result = await streamChat(chat, turn, { value, body, key: 'k', fetcher: async () => response(++calls === 1 ? truncated : calls === 2 ? proposing : answering) });
  assert.equal(calls, 3); assert.equal(result.answer, 'Prepared the note for you.');
  assert.ok(result.activity.some(row => row.name === 'propose_action' && row.state === 'done'));
});

test('web search runs through Firecrawl for every provider',()=>{
  const {chat}=ready();
  const names = value => (requestBody({ ...chat, config: value }, turn).tools || []).map(tool => tool.name || tool.function?.name);
  const anthropic = config({...DEFAULT_CONFIG, webSearch:true});
  const compatible = config({...DEFAULT_CONFIG, provider:'compatible', model:'local-model', baseUrl:'https://model.example/v1', webSearch:true});
  assert.ok(names(anthropic).includes('search_web'));
  assert.ok(names(anthropic).includes('read_web_page'));
  assert.ok(!names(anthropic).includes('web_search'));
  assert.ok(names(compatible).includes('search_web'));
});
test('search_web forwards news and research filters to Firecrawl',async()=>{
  const value=config({...DEFAULT_CONFIG,webSearch:true});
  const savedFetch=globalThis.fetch, savedLocal=globalThis.localStorage, savedSession=globalThis.sessionStorage;
  globalThis.localStorage=new Memory(); globalThis.sessionStorage=new Memory();
  let sent;
  globalThis.fetch=async(url,options)=>{sent=JSON.parse(options.body);return new Response(JSON.stringify({data:{web:[{url:'https://example.com/a',title:'A',description:'a'}],news:[{url:'https://news.example/b',title:'B',description:'b'}]}}),{headers:{'content-type':'application/json'}});};
  try{
    const schema=(definitions(value).find(tool=>tool.name==='search_web')||{}).input_schema?.properties||{};
    assert.ok(schema.sources&&schema.categories);
    const result=await execute(value,'search_web',{query:'car industry',sources:['news'],categories:['research','pdf']},undefined,{cache:new Map()});
    assert.deepEqual(sent.sources,['news']);assert.deepEqual(sent.categories,['research','pdf']);
    assert.ok(result.results.some(item=>item.url.includes('news.example')));
  }finally{globalThis.fetch=savedFetch;globalThis.localStorage=savedLocal;globalThis.sessionStorage=savedSession;}
});
test('replayed history tells Pip which proposals it already prepared',()=>{
  const {chat}=ready();
  chat.turns=[
    {uid:'t1',text:'Research the car industry and save a note',status:'done',answer:'I prepared a note.',activity:[
      {id:'r1',name:'propose_action',state:'done',applied_href:'/notes/abc',result:JSON.stringify({kind:'proposal',proposal:{kind:'note',title:'Car industry turmoil',text:'…'}})},
      {id:'r2',name:'propose_change',state:'done',result:JSON.stringify({kind:'change',change:{change:'append_note'},before:{title:'Trip'}})},
    ]},
    {uid:'t2',text:'which stock should I buy?',context:[],status:'open',answer:''},
  ];
  const body=requestBody({...chat,config:config({...DEFAULT_CONFIG})},chat.turns[1]);
  const assistant=body.messages.find(message=>message.role==='assistant');
  assert.ok(assistant,'the finished turn is replayed');
  assert.match(assistant.content,/\[Pip prepared: note "Car industry turmoil" \(saved by the user\); append_note on "Trip" \(not applied\)\]/);
});
