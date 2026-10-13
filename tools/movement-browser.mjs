// Run Astro on 8882. Uses an isolated browser profile and fictional fixtures only.
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000);
const report='app/build/reports/movement-web';await mkdir(report,{recursive:true});
const goto=async path=>{await page.evaluate(p=>location.hash='#/'+p,path);await page.waitForTimeout(220);};
try{
  await page.goto('http://127.0.0.1:8882/#/movement/overview');await page.waitForSelector('.movement-score');
  assert.equal(await page.locator('.movement-score').count(),3);assert.match(await page.locator('.tool-movement').innerText(),/no reading/);assert.equal(await page.locator('.movement-activity').count(),0);
  await page.getByRole('button',{name:'+ plan session',exact:true}).click();
  await page.getByLabel('session',{exact:true}).fill('Strength A');await page.getByLabel('exercises · one per line').fill('Squat\nRow');
  const soon=await page.evaluate(()=>{const d=new Date(Date.now()+300000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);});await page.getByLabel('when',{exact:true}).fill(soon);
  await page.getByRole('dialog').getByRole('button',{name:'save',exact:true}).click();
  assert.equal(await page.locator('dialog').count(),0);assert.match(await page.locator('.movement-session.featured').innerText(),/Strength A/);
  await page.reload();await page.waitForSelector('.movement-session.featured');assert.match(await page.locator('.movement-session.featured').innerText(),/2 exercises/);
  await goto('calendar');assert.match(await page.locator('.tool-calendar').innerText(),/Strength A/);
  await goto('movement/overview');await page.locator('.movement-session.featured').getByRole('button',{name:'start',exact:true}).click();await page.waitForSelector('.gym-log');
  assert.match(await page.locator('.tool-gym').innerText(),/Squat/);assert.match(await page.locator('.tool-gym').innerText(),/Row/);
  await page.getByLabel('Kilograms',{exact:true}).fill('40');await page.getByLabel('Reps',{exact:true}).fill('8');await page.getByRole('button',{name:'log set',exact:true}).click();
  await page.getByRole('button',{name:'finish',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'finish',exact:true}).click();
  await goto('movement/activities');assert.equal(await page.locator('.movement-activity').count(),1);assert.match(await page.locator('.movement-activity').innerText(),/Strength A/);
  console.log('PASS: create → reload → Calendar → start Gym with both exercises → log → finish → Movement');
  await page.evaluate(async()=>{
    const {storage}=await import('/src/client/workspace-storage.js');const {dayKey}=await import('/src/shared/movement.js');const {gym}=await import('/src/client/store.js');
    const now=Date.now(),start=gym.all()[0].started;
    const list=[{id:'watch-strength',sport:402,type:'STRENGTH',name:'Strength training',start,seconds:3600,km:0,hr:110,kcal:240},{id:'watch-run',sport:100,type:'RUN',name:'Morning run',start:now-86400000,seconds:2280,km:6.2,hr:142,kcal:400,pace:'6:08 /km',paceLabel:'pace'}];
    storage.setItem('pocket:coros-activities',JSON.stringify({at:now,list}));
    const days=Array.from({length:28},(_,i)=>{const d=new Date();d.setDate(d.getDate()-27+i);return dayKey(d);});
    storage.setItem('pocket:coros-cockpit',JSON.stringify({at:now,device:'Fixture watch',profile:{age:30},daily:{days:days.map((date,i)=>({date,steps:6000+i*70,sleep:{total:460,deep:80,rem:100,light:270,awake:10}}))},hrv:days.map((date,i)=>({date,avg:60+i%7,baseline:60,low:50,high:70})),resting:days.map((date,i)=>({date,bpm:54+i%3}))}));
    storage.setItem('pocket:coros-details',JSON.stringify({'watch-run':{path:{d:'M10 10 L80 40 L140 5 L240 100',start:[10,10]},series:{x:[0,1,2],unit:'km',hr:[130,140,142],pace:[350,370,360]},detail:[['Training Load','45']]}}));
    dispatchEvent(new Event('pocket-coros-synced'));
  });
  await page.waitForFunction(()=>document.querySelectorAll('.movement-activity').length===3);
  await page.getByRole('button',{name:'gym',exact:true}).last().click();assert.equal(await page.locator('.movement-activity').count(),2);
  await page.locator('.movement-activity').filter({hasText:'Strength A'}).click();await page.getByRole('button',{name:'link COROS recording',exact:true}).click();
  await page.getByRole('dialog').getByRole('button').filter({hasText:'Strength training'}).click();
  await page.getByRole('button',{name:'‹ activities',exact:true}).click();await page.waitForSelector('.movement-activity');assert.equal(await page.locator('.movement-activity').count(),2);assert.match(await page.locator('.tool-movement').innerText(),/Gym \+ COROS/);
  await page.locator('.movement-activity').filter({hasText:'Morning run'}).click();await page.waitForSelector('.movement-route svg');assert.ok(await page.locator('.activity-chart').count()||await page.locator('.chart-trace').count());
  await page.goBack();await page.waitForSelector('.movement-activity');assert.equal(await page.locator('.movement-route').count(),0);
  console.log('PASS: unified history, filters, explicit link deduplication, saved route/charts and browser Back');
  for(const width of [320,360,768,1280]){
    await page.setViewportSize({width,height:1000});await goto('movement/overview');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overview overflow at ${width}`);
    await page.screenshot({path:`${report}/overview-${width}.png`,fullPage:true});
    await goto('movement/trends');await page.getByRole('button',{name:'90 days',exact:true}).click();assert.match(await page.locator('.tool-movement').innerText(),/28\/90 days/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`trends overflow at ${width}`);
    if(width===360)await page.screenshot({path:`${report}/trends-${width}.png`,fullPage:true});
  }
  await goto('movement/overview');await page.getByRole('button',{name:'talk training with Pip →',exact:true}).click();await page.waitForSelector('#pip-prompt');
  assert.match(await page.locator('#pip-prompt').inputValue(),/Pocket estimates from COROS/);assert.match(await page.locator('#pip-prompt').inputValue(),/Strength A/);
  await goto('movement/overview');await context.setOffline(true);await page.getByRole('button',{name:'+ plan session',exact:true}).click();await page.getByLabel('session',{exact:true}).fill('Offline ride');await page.getByLabel('when',{exact:true}).fill(soon);await page.getByLabel('sport',{exact:true}).selectOption('ride');await page.getByRole('dialog').getByRole('button',{name:'save',exact:true}).click();
  assert.match(await page.locator('.tool-movement').innerText(),/Offline ride/);await context.setOffline(false);
  console.log('PASS: 320–1280px layouts, 90-day missing-data coverage, unsent Pip context and offline planning');
  await page.getByRole('button',{name:'+ plan session',exact:true}).click();await page.getByLabel('session',{exact:true}).fill('Unsaved draft');
  const other=await context.newPage();await other.goto('http://127.0.0.1:8882');await other.evaluate(async()=>{const {agenda}=await import('/src/client/planner.js');agenda.save({title:'From phone',when:Date.now()+300000,minutes:30,training:{sport:'run',exercises:[]}});});await page.bringToFront();
  assert.equal(await page.getByLabel('session',{exact:true}).inputValue(),'Unsaved draft');await page.getByRole('dialog').getByRole('button',{name:'cancel',exact:true}).click();await page.waitForTimeout(300);assert.match(await page.locator('.tool-movement').innerText(),/From phone/);await other.close();
  assert.deepEqual(errors,[]);console.log('PASS: incoming workspace edit refreshes Movement and preserves open draft; no page errors');
}catch(error){await page.screenshot({path:`${report}/failure.png`,fullPage:true});console.log(await page.evaluate(()=>[...document.querySelectorAll('.tool-movement *')].filter(n=>n.getBoundingClientRect().right>innerWidth+1).map(n=>({tag:n.tagName,cls:n.className,text:n.textContent.slice(0,80),right:n.getBoundingClientRect().right})).slice(0,20)));throw error;}finally{await browser.close();}
