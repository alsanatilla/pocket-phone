import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatStore, ReplyRunner, DEFAULT_CONFIG, config, apiKey, setKey, saveSettings, settings, requestBody, streamReply, sse } from '../src/client/pip-core.js';

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
  await assert.rejects(streamReply(chat,turn,{key:'key',fetcher:async()=>response(event({type:'content_block_delta',delta:{type:'text_delta',text:'Partial'}})+event({type:'message_delta',delta:{stop_reason:'max_tokens'}})+event({type:'message_stop'}))}),/reply limit/);
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
  await assert.rejects(streamReply(chat,turn,{key:'key',timeoutMs:5,fetcher:async(_,options)=>{calls++;return await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Stopped','AbortError'))));}}),/took too long/);assert.equal(calls,1);
});
test('damaged conversation data is kept rather than silently replaced',()=>{
  const {store,memory,chat}=ready();memory.setItem('pocket:pip-chat:'+chat.uid,'damaged-original');assert.throws(()=>store.get(chat.uid),/original data/);assert.equal(memory.getItem('pocket:pip-chat:'+chat.uid),'damaged-original');
});
