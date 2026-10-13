import test from 'node:test';
import assert from 'node:assert/strict';
import {activityFeed,trainingPlans,pipTrainingTasks,recordingChoices,weekDays,trainingText} from '../src/shared/movement.js';
import {validContent,mergeContent} from '../src/shared/pocket-content.js';
import {merge} from '../src/shared/workspace.js';
const at=new Date(2026,9,13,18).getTime();
const event={uid:'session-one',title:'Strength',when:at,minutes:60,remindAt:0,created:at,updated:at,training:{sport:'gym',exercises:['Squat','Row']}};
const w={id:'w',started:at,ended:at+3600000,updated:at,entries:[{exercise:'Squat',sets:[{kg:40,reps:8,at}]}],plan_uid:event.uid};
const a={id:'watch',sport:402,type:'STRENGTH',name:'Strength training',start:at,seconds:3600,km:0};
test('watch recordings count separately until a user links them; stale/duplicate links cannot hide unrelated records',()=>{
  assert.equal(activityFeed([a],[w]).length,2);
  const joined=activityFeed([a],[{...w,coros_id:'watch'}]);assert.equal(joined.length,1);assert.equal(joined[0].source,'Gym + COROS');assert.equal(joined[0].seconds,3600);
  assert.equal(activityFeed([a],[{...w,coros_id:'gone'}]).length,2);
  assert.equal(activityFeed([{...a,sport:100,type:'RUN'}],[{...w,coros_id:'watch'}]).length,2);
  assert.equal(activityFeed([a],[{...w,coros_id:'watch'},{...w,id:'w2',coros_id:'watch'}]).filter(x=>x.coros).length,1);
  assert.equal(recordingChoices(w,[a],[w,{...w,id:'other',coros_id:'watch'}]).length,0);
});
test('planned exercises and completion survive both merge directions and ordinary Calendar edits',()=>{
  const doc={v:1,events:[event]}, edited={...event,title:'Leg day',updated:at+1};
  assert.equal(validContent('agenda.json',doc),true);
  const incoming={v:1,events:[edited]};
  assert.deepEqual(mergeContent('agenda.json',doc,incoming),mergeContent('agenda.json',incoming,doc));
  assert.deepEqual(mergeContent('agenda.json',doc,incoming).events[0].training.exercises,['Squat','Row']);
  const {training,...olderClient}=edited;assert.deepEqual(mergeContent('agenda.json',doc,{v:1,events:[olderClient]}).events[0].training,training);
  assert.equal(trainingPlans([event],[w])[0].done,true);assert.equal(trainingPlans([event],[{...w,ended:0}])[0].active,true);
  assert.equal(trainingPlans([event],[{...w,deleted:true}])[0].done,false);
  assert.equal(validContent('agenda.json',{v:1,events:[{...event,training:{sport:'gym',exercises:['x'.repeat(61)]}}]}),false);
  assert.equal(validContent('agenda.json',{v:1,events:[{...event,training:'gym'}]}),false);
  const linked=merge['gym.json']({v:1,workouts:[w]},{v:1,workouts:[{...w,updated:at+1,coros_id:'watch'}]});
  assert.equal(linked.workouts[0].plan_uid,event.uid);assert.equal(linked.workouts[0].coros_id,'watch');
});
test('calendar weeks follow local civil days across DST and Sunday',()=>{
  assert.deepEqual(weekDays(new Date(2026,9,25,12)),['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23','2026-10-24','2026-10-25']);
  assert.equal(weekDays(new Date(2026,9,25,12),1)[0],'2026-10-26');
});
test('existing Pip training tasks appear once and ordinary tasks stay in Tasks',()=>{
  const task={uid:'pip-training-fixture',text:'Gym · Full body',due:'2026-10-13',source:{name:'Pip training'}};
  assert.equal(pipTrainingTasks([task,{...task,uid:'ordinary',source:null}]).length,1);
  assert.equal(pipTrainingTasks([task],[{...event,task_uid:task.uid}]).length,0);
});
test('Pip gets dated facts and missing readings, never invented readiness',()=>{
  const text=trainingText({now:at,feed:activityFeed([], [w]),plans:trainingPlans([event],[])});
  assert.match(text,/COROS saved: unavailable/);assert.match(text,/recovery unavailable/);assert.match(text,/Squat, Row/);
});
