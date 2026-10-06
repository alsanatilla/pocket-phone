import test from 'node:test';
import assert from 'node:assert/strict';
import { parking, notes, tasks, thought, parkThought, thoughtStatus, load, save, merge, taskDay } from '../src/client/store.js';
const copies=new Map();
globalThis.localStorage={getItem:key=>copies.get(key)??null,setItem:(key,value)=>copies.set(key,String(value)),removeItem:key=>copies.delete(key)};
test.beforeEach(()=>copies.clear());
test('an untagged note thought stays undecided until an action is chosen',()=>{
  const note=notes.create('# Trip\n>> Book the train'),idea=parkThought(note.uid,thought('>> Book the train'));
  assert.equal(idea.due,0);assert.equal(tasks.list().length,0);assert.equal(thoughtStatus(note.uid,'>> Book the train'),'saved to thoughts');
  const action=tasks.fromThought(idea);assert.equal(tasks.list().length,1);assert.equal(action.due,'');assert.equal(action.source.note_uid,note.uid);assert.equal(action.source.text,note.text);assert.equal(parking.open().length,0);assert.equal(tasks.fromThought(idea).uid,action.uid);
});
test('a phone-promoted action is reused after a stale thought arrives',()=>{
  const idea=parking.park('Call Sam',0),now=Date.now();
  save('tasks.json',merge['tasks.json'](load('tasks.json'),{tasks:[{uid:'phone-task',text:idea.text,done:false,updated:now+100,created:now,source:{kind:'shared',name:'Thought',text:idea.text,token:'thought:'+idea.id}}]},now));
  assert.equal(tasks.fromThought(idea).uid,'phone-task');assert.equal(tasks.list().length,1);assert.equal(parking.open().length,0);
});
test('a failed local task save leaves the original thought undecided',()=>{
  const idea=parking.park('Keep the source',0),original=localStorage.setItem;
  localStorage.setItem=(key,value)=>{if(key==='pocket:tasks.json')throw new Error('Storage is full');original(key,value);};
  try{assert.throws(()=>tasks.fromThought(idea),/Storage is full/);assert.equal(parking.open()[0].id,idea.id);assert.equal(tasks.list().length,0);}finally{localStorage.setItem=original;}
});
test('completion, chosen next and deletion survive portable task round trips',()=>{
  const action=tasks.create('Send invoice');tasks.edit(action.uid,t=>{t.due=taskDay();t.steps=[{text:'Attach PDF',done:true}];});tasks.next(action.uid);tasks.complete(action.uid);
  const remote=load('tasks.json');copies.clear();save('tasks.json',merge['tasks.json'](load('tasks.json'),remote,Date.now()));
  assert.equal(tasks.get(action.uid).done,true);assert.equal(tasks.get(action.uid).steps[0].done,true);assert.equal(load('tasks.json').next.uid,action.uid);
  tasks.remove(action.uid);const merged=merge['tasks.json'](load('tasks.json'),remote,Date.now()+90*86400000);assert.equal(merged.tasks.find(t=>t.uid===action.uid).deleted,true);
});
test('handled thoughts cannot return when a long-offline copy syncs',()=>{
  const idea=parking.park('An old idea',0),stale=load('parking.json');parking.close(idea.id,'killed');
  save('parking.json',merge['parking.json'](load('parking.json'),stale,Date.now()+90*86400000));assert.equal(parking.open().length,0);
});
