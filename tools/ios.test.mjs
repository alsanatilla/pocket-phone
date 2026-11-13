import test from 'node:test';
import assert from 'node:assert/strict';
process.env.TURSO_DATABASE_URL = 'file::memory:';
delete process.env.TURSO_AUTH_TOKEN;
const {iosSchema,issueKey,iosUser,widgetTask,keyHash} = await import('../src/server/ios.js');
const {execute} = await import('../src/server/database.js');
test('iPhone keys are hashed, scoped to an owner, replaced, expired and rate limited',async()=>{
 await iosSchema();
 await execute("INSERT INTO pocket_user(id,name,email,createdAt,updatedAt) VALUES ('ios-test','Test','ios@test.invalid',0,0)");
 const key=await issueKey('ios-test');
 const req=k=>new Request('https://pocket.test',{headers:{Authorization:'Bearer '+k}});
 assert.equal(await iosUser(req(key)), 'ios-test');
 assert.equal((await execute('SELECT hash FROM pocket_ios_keys')).rows[0].hash,keyHash(key));
 await assert.rejects(()=>iosUser(req('invalid')),e=>e.status===401);
 await iosUser(req(key),true);
 await assert.rejects(()=>iosUser(req(key),true),e=>e.status===429);
 const replacement=await issueKey('ios-test');
 await assert.rejects(()=>iosUser(req(key)),e=>e.status===401);
 await execute('UPDATE pocket_ios_keys SET expires=0');
 await assert.rejects(()=>iosUser(req(replacement)),e=>e.status===401);
});
test('widget respects selected task and excludes completed/deleted tasks',()=>{
 const doc={next:{uid:'b'},tasks:[{uid:'a',text:'A'},{uid:'b',text:'B'},{uid:'c',done:true}]};
 assert.equal(widgetTask(doc).uid,'b'); doc.tasks[1].deleted=true;
 assert.equal(widgetTask(doc).uid,'a'); assert.equal(widgetTask({tasks:[]}),null);
});
