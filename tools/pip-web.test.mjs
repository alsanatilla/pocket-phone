import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatStore, ReplyRunner, DEFAULT_CONFIG, config, apiKey, setKey, saveSettings, settings, requestBody, streamReply, sse } from '../src/client/pip-core.js';
import { streamChat } from '../src/client/pip-stream.js';
import { execute, definitions } from '../src/client/pip-tools.js';

class Memory {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
const ready = () => { const memory = new Memory(), store = new ChatStore(memory), chat = store.create(); return { memory, store, chat }; };
const response = (events, chunkSize = 7) => {
  const bytes = new TextEncoder().encode(events);
  return new Response(new ReadableStream({ start(controller) { for (let at=0;at<bytes.length;at+=chunkSize) controller.enqueue(bytes.slice(at,at+chunkSize)); controller.close(); } }), { headers:{'content-type':'text/event-stream'} });
};
const event = value => 'data: ' + JSON.stringify(value) + '\r\n\r\n';
const anthropic = text => event({type:'message_start',message:{model:'canonical-model',usage:{input_tokens:20}}}) + event({type:'content_block_delta',delta:{type:'text_delta',text}}) + event({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:8}}) + event({type:'message_stop'});
const source = {kind:'note',uid:'note-1',title:'Trip',text:'Take the train'};
const turn = {uid:'turn-1',text:'What next?',context:[source]};

test('UTF-8, CRLF and multiline SSE framing survive single-byte chunks', async()=>{
  const wire=': ping\r\ndata: {"text":\r\ndata: "Grüße 🌱"}\r\n\r\n';
  const data=[];for await(const value of sse(response(wire,1).body))data.push(JSON.parse(value));
  assert.deepEqual(data,[{text:'Grüße 🌱'}]);
});
test('Anthropic streams keep the answer, summary and usage separate', async()=>{
  const {chat}=ready(), updates=[];
  const wire=event({type:'content_block_delta',delta:{type:'thinking_delta',thinking:'Compare options.'}})+event({type:'content_block_delta',delta:{type:'signature_delta',signature:'private-signature'}})+anthropic('Take the train 🌱');
  let request;
  const result=await streamReply(chat,turn,{key:'tab-key',fetcher:async(url,options)=>{request={url,options};return response(wire,1);},onUpdate:value=>updates.push(value)});
  assert.equal(result.answer,'Take the train 🌱');assert.equal(result.reasoning,'Compare options.');assert.equal(result.usage.output_tokens,8);assert.equal(result.model,'canonical-model');
  assert.equal(request.url,'https://api.anthropic.com/v1/messages');assert.equal(request.options.headers['x-api-key'],'tab-key');assert.equal(request.options.redirect,'error');assert.equal(request.options.credentials,'omit');
  assert.equal(request.options.headers['anthropic-dangerous-direct-browser-access'],'true');assert.ok(updates.length>1);assert.ok(!JSON.stringify(result).includes('private-signature'));
});
test('compatible streams do not double a summary supplied in two fields', async()=>{
  const {chat}=ready();chat.config=config({...DEFAULT_CONFIG,provider:'compatible',model:'local-model',baseUrl:'https://model.example/v1'});
  const wire=event({choices:[{index:0,delta:{reasoning_content:'One thought.',reasoning:'One thought.'}}]})+event({choices:[{index:0,delta:{content:'One answer.'},finish_reason:'stop'}],usage:{prompt_tokens:9,completion_tokens:3,prompt_tokens_details:{cached_tokens:4}}})+'data: [DONE]\n\n';
  let request;
  const result=await streamReply(chat,turn,{key:'own-key',fetcher:async(url,options)=>{request={url,options};return response(wire);}});
  assert.equal(result.answer,'One answer.');assert.equal(result.reasoning,'One thought.');assert.equal(result.usage.cache_read_input_tokens,4);assert.equal(request.options.headers.authorization,'Bearer own-key');assert.ok(!request.options.headers['x-api-key']);
});
test('truncated streams and reply limits stay unfinished', async()=>{
  const {chat}=ready();
  await assert.rejects(streamReply(chat,turn,{key:'key',fetcher:async()=>response(event({type:'content_block_delta',delta:{type:'text_delta',text:'Partial'}}))}),/before the reply was complete/);
  await assert.rejects(streamReply(chat,turn,{key:'key',fetcher:async()=>response(event({type:'content_block_delta',delta:{type:'text_delta',text:'Partial'}})+event({type:'message_delta',delta:{stop_reason:'max_tokens'}})+event({type:'message_stop'}))}),/reply token limit/);
});
test('request errors do not expose provider text or an echoed API key', async()=>{
  const {chat}=ready();
  await assert.rejects(streamReply(chat,turn,{key:'secret',fetcher:async()=>new Response('secret',{status:401})}),error=>!error.message.includes('secret')&&/rejected/.test(error.message));
  await assert.rejects(streamReply(chat,turn,{key:'secret',fetcher:async()=>response(event({error:{message:'secret'}}))}),error=>!error.message.includes('secret')&&/interrupted/.test(error.message));
});
test('only answered pairs enter history; reasoning and partials do not repeat',()=>{
  const {chat}=ready();chat.turns=[{uid:'old-1',text:'First',context:[source],answer:'Answer',reasoning:'private trace',status:'done'},{uid:'old-2',text:'Failed',answer:'Partial',status:'failed'},{uid:'old-3',text:'Stopped',answer:'More partial',status:'stopped'},turn];
  const request=requestBody(chat,turn);
  assert.equal(request.messages.length,3);assert.equal(request.messages[1].content,'Answer');assert.match(request.messages[0].content,/Take the train/);assert.ok(!JSON.stringify(request).includes('private trace'));assert.ok(!JSON.stringify(request).includes('Partial'));assert.equal(request.model,DEFAULT_CONFIG.model);
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
  const wire=event({type:'message_start',message:{model:'m',usage:{input_tokens:5}}})+event({type:'content_block_delta',delta:{type:'text_delta',text:'ok'}})+event({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:4}})+event({type:'message_stop'});
  await streamChat(chat,turn,{value,body,readSse:sse,key:'k',fetcher:async(url,options)=>{requests.push(JSON.parse(options.body));return response(wire);}});
  assert.equal(value.maxTokens,4096);
  assert.ok(requests[0].max_tokens>=2048,`first tool round allowance ${requests[0].max_tokens} should finish a tool call`);
  assert.ok(requests[0].max_tokens<=value.maxTokens);
});
test('a web search that resolves after a paused turn updates its own search',async()=>{
  // Anthropic can return pause_turn after a server_tool_use and deliver the
  // web_search_tool_result on the continuation. Activity ids carry the round, so the
  // result must be matched by the provider's id or it is rejected as "unmatched".
  const {chat}=ready(), value=config({...DEFAULT_CONFIG,webSearch:true});
  const body={model:value.model,max_tokens:value.maxTokens,stream:true,messages:[{role:'user',content:'Compare German carmakers.'}],tools:[{name:'web_search'},{name:'search_pocket'}]};
  const paused=event({type:'message_start',message:{model:'m',usage:{input_tokens:10}}})
    +event({type:'content_block_start',index:0,content_block:{type:'server_tool_use',id:'srvtoolu_1',name:'web_search',input:{}}})
    +event({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"query":"VW quarterly"}'}})
    +event({type:'content_block_stop',index:0})
    +event({type:'message_delta',delta:{stop_reason:'pause_turn'},usage:{output_tokens:20}})
    +event({type:'message_stop'});
  const resolved=event({type:'message_start',message:{model:'m',usage:{input_tokens:12}}})
    +event({type:'content_block_start',index:0,content_block:{type:'web_search_tool_result',tool_use_id:'srvtoolu_1',content:[{type:'web_search_result',url:'https://example.com/vw',title:'VW figures'}]}})
    +event({type:'content_block_stop',index:0})
    +event({type:'content_block_delta',index:1,delta:{type:'text_delta',text:'Done'}})
    +event({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:10}})
    +event({type:'message_stop'});
  let calls=0;
  const result=await streamChat(chat,turn,{value,body,readSse:sse,key:'k',fetcher:async()=>response(++calls===1?paused:resolved)});
  assert.equal(calls,2);assert.equal(result.answer,'Done');
  const web=result.activity.filter(row=>row.kind==='web');
  assert.equal(web.length,1);assert.equal(web[0].state,'done');assert.equal(web[0].summary,'1 results');
});
test('a web result the client cannot match no longer ends the run',async()=>{
  // Defensive: whatever id a provider uses, a search result must not abort the whole reply.
  const {chat}=ready(), value=config({...DEFAULT_CONFIG,webSearch:true});
  const body={model:value.model,max_tokens:value.maxTokens,stream:true,messages:[{role:'user',content:'x'}],tools:[{name:'web_search'}]};
  const wire=event({type:'message_start',message:{model:'m',usage:{input_tokens:10}}})
    +event({type:'content_block_start',index:0,content_block:{type:'web_search_tool_result',tool_use_id:'srvtoolu_orphan',content:[{type:'web_search_result',url:'https://example.com/x',title:'X'}]}})
    +event({type:'content_block_stop',index:0})
    +event({type:'content_block_delta',index:1,delta:{type:'text_delta',text:'Done'}})
    +event({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:10}})
    +event({type:'message_stop'});
  const result=await streamChat(chat,turn,{value,body,readSse:sse,key:'k',fetcher:async()=>response(wire)});
  assert.equal(result.answer,'Done');
  const web=result.activity.filter(row=>row.kind==='web');
  assert.equal(web.length,1);assert.equal(web[0].state,'done');
});
test('a note can still be prepared after the budget forces synthesis',async()=>{
  const {chat}=ready(), value=config({...DEFAULT_CONFIG});
  const body={model:value.model,max_tokens:value.maxTokens,stream:true,messages:[{role:'user',content:'Save a note about the car industry'}],tools:[{name:'propose_action'},{name:'search_notes'}]};
  const truncated=event({type:'message_start',message:{model:'m',usage:{input_tokens:10}}})
    +event({type:'content_block_delta',delta:{type:'text_delta',text:'Let me check.'}})
    +event({type:'message_delta',delta:{stop_reason:'max_tokens'},usage:{output_tokens:12}})
    +event({type:'message_stop'});
  const proposing=event({type:'content_block_start',index:0,content_block:{type:'tool_use',id:'toolu_1',name:'propose_action',input:{}}})
    +event({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:'{"kind":"note","title":"Car industry turmoil","text":"VW plans to cut jobs."}'}})
    +event({type:'content_block_stop',index:0})
    +event({type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:30}})
    +event({type:'message_stop'});
  const answering=event({type:'content_block_delta',delta:{type:'text_delta',text:'Prepared the note for you.'}})
    +event({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:8}})
    +event({type:'message_stop'});
  let calls=0;
  const result=await streamChat(chat,turn,{value,body,readSse:sse,key:'k',fetcher:async()=>response(++calls===1?truncated:calls===2?proposing:answering)});
  assert.equal(calls,3);
  assert.equal(result.answer,'Prepared the note for you.');
  assert.ok(result.activity.some(row=>row.name==='propose_action'&&row.state==='done'),'the note proposal is prepared during the final round');
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
