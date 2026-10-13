import { tabStorage, activeAccount } from './workspace-storage.js';
import './movement.css';
import * as coros from './coros.js';
import { scores } from './scores.js';
import { gym, tasks, onChange } from './store.js';
import { onStatus } from './sync.js';
import { agenda } from './planner.js';
import { mascot } from './pip-pixels.js';
import { dayKey, weekDays, activityFeed, trainingPlans, pipTrainingTasks, recordingChoices, trainingText, setCount, volume } from '../shared/movement.js';
import { editSession } from './movement-plan.js';
import { svg, dayLine, dayBars } from './movement-charts.js';
import { scorePanel, fitnessStrip, charts, splits, bands } from './movement-instruments.js';

const el = (tag, cls, ...children) => { const n=document.createElement(tag); n.className=cls; n.append(...children.flat(Infinity).filter(x=>x!=null)); return n; };
const words = (tag,cls,text) => el(tag,cls,document.createTextNode(String(text)));
const button = (label,run,cls='') => { const b=typeof label==='string'?words('button',cls,label):el('button',cls,label); b.type='button'; b.onclick=run; return b; };
const minutes = n => { n=Math.round(n); return n>=60?`${Math.floor(n/60)}h ${String(n%60).padStart(2,'0')}m`:`${n} min`; };
const moving = seconds => minutes(seconds/60);
const date = at => new Date(at).toLocaleDateString([], {weekday:'short',day:'numeric',month:'short'});
const time = at => new Date(at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
const short = key => new Date(key+'T12:00:00').toLocaleDateString([], {day:'numeric',month:'short'});
const latest = list => list?.at(-1);
let dispose = () => {};
export function leave() { dispose(); dispose=()=>{}; }

export function mount(body, {say=()=>{},go=path=>location.hash='#'+path,arg='',choose,askPip=()=>{},refresh=true}={}) {
  leave();
  const owner=activeAccount(); let stopped=false, loading=false, editor=null, timer;
  let items=[], deck={}, at=0;
  let tab=['overview','activities','trends'].includes(arg)?arg:(tabStorage.getItem('pocket:movement-tab') || 'overview');
  const selected=arg?.startsWith('activity:')?decodeURIComponent(arg.slice(9)):'';
  let open=tabStorage.getItem('pocket:movement-open') || '', filter='all', period=28, weekOffset=0, selectedDay=dayKey(Date.now()), allCharts=false;
  const details=new Map(); let feed=[], plans=[], taskPlans=[], result;
  const alive = () => !stopped && body.isConnected && owner===activeAccount();
  const act = fn => () => { if(!alive())return; try { fn(); } catch(error){say(error.message);} };
  const section = (title,action) => el('div','movement-section-head',words('h2','',title),action);
  const recompute = () => { items=coros.cached()?.list||[]; deck=coros.cachedCockpit()||{}; at=coros.cached()?.at||0;
    feed=activityFeed(items,gym.all()); plans=trainingPlans(agenda.all(),gym.all());taskPlans=pipTrainingTasks(tasks.list(),agenda.all());
    result=scores({activities:items,deck,profile:{...deck.profile,observedMax:coros.observedMaxHr()},span:period}); };
  const cleanupNodes = () => body.querySelectorAll('canvas').forEach(c=>c.dispose?.());
  const saveOpen = name => { open=open===name?'':name; tabStorage.setItem('pocket:movement-open',open); draw(); body.querySelector(`[data-score="${name}"]`)?.focus({preventScroll:true}); };
  const edit = (plan=null) => { editor?.(); editor=editSession(plan,selectedDay,()=>{editor=null;draw();}); };
  const navigateActivity = item => go('/movement/activity:'+encodeURIComponent(item.id));
  async function load(force=false) {
    if(loading || !alive())return; loading=true; draw();
    const values=await Promise.allSettled([coros.activities(90,force),coros.cockpit(90)]);
    if(!alive())return; loading=false; const failed=values.find(x=>x.status==='rejected'); if(failed)say(failed.reason.message); draw();
  }
  function scoreCards() {
    const known=Boolean(at || deck.at), today=dayKey(Date.now());
    const dailyKnown=deck.daily?.days?.some(d=>d.date===today) || items.some(i=>dayKey(i.start)===today);
    const picks=[['recovery','recovery',result.recovery?.score??null,result.recovery?.zone||'no reading','%'],
      ['strain','strain',dailyKnown?result.strain.strain:null,dailyKnown?`target ${result.strain.target.join('–')}%`:'no reading','%'],
      ['conditioning','condition',known&&items.length?result.conditioning.score:null,known&&items.length?({calibrating:'building base',maintaining:'steady',overtraining:'high load',productive:'building',detraining:'easing off'}[result.conditioning.status]||result.conditioning.status):'no history','']];
    const row=el('div','movement-score-cards');
    for(const [name,label,value,status,unit] of picks){
      const bars=el('span','movement-segments'); bars.setAttribute('aria-hidden','true'); for(let i=0;i<16;i++)bars.append(el('i',value!=null&&i<Math.min(16,value/100*16)?'on':''));
      const b=button([words('span','movement-score-label',label),el('strong','',String(value??'—'),value!=null?words('small','',unit):null),bars,words('span','movement-score-status',status)],()=>saveOpen(name),'movement-score '+name);
      b.dataset.score=name; b.setAttribute('aria-expanded',String(open===name)); b.setAttribute('aria-controls','movement-score-details'); row.append(b);
    }
    const panel=el('div','movement-score-details'); panel.id='movement-score-details'; panel.hidden=!open;
    if(open)panel.append(words('p','small muted','Pocket estimate · COROS readings'),...scorePanel(open,scores({activities:items,deck,profile:{...deck.profile,observedMax:coros.observedMaxHr()}}),deck).filter(Boolean));
    return [row,panel];
  }
  function startPlan(plan) {
    const current=agenda.get(plan.uid); if(!current)throw new Error('This session was removed.');
    const workout=gym.startPlan(current); go(workout.ended?'/gym/w:'+workout.id:'/gym');
  }
  function planRow(plan,featured=false) {
    const actions=el('div','movement-session-actions',button('edit',act(()=>edit(plan))));
    if(plan.training.sport==='gym')actions.append(button(plan.done?'view':plan.active?'resume':'start',act(()=>startPlan(plan)),'accent'));
    else actions.append(button(plan.done?'reopen':'done',act(()=>{const current=agenda.get(plan.uid); if(!current)throw new Error('This session was removed.'); agenda.save({...current,training:{...current.training,completedAt:plan.done?0:Date.now()}}); draw();}),'accent'));
    return el('div','movement-session'+(featured?' featured':''),words('span','movement-session-time',time(plan.when)),
      el('div','movement-session-copy',words('strong','',plan.title),words('span','small muted',`${featured?date(plan.when)+' · ':''}${plan.training.sport} · ${plan.minutes} min${plan.training.exercises.length?' · '+plan.training.exercises.length+' exercises':''}${plan.done?' · done':''}`)),actions);
  }
  function night() {
    const n=latest(deck.daily?.days?.filter(x=>x.sleep)), h=latest(deck.hrv), r=latest(deck.resting), cells=el('div','movement-night');
    const before=(deck.resting||[]).filter(x=>r&&x.date<r.date).slice(-28), base=before.length?before.reduce((n,x)=>n+x.bpm,0)/before.length:null;
    const rows=[['sleep',n?minutes(n.sleep.total):'—',n?.date,''],
      ['HRV',h?`${h.avg} ms`:'—',h?.date,h?.low!=null?`normal ${h.low}–${h.high}`:''],
      ['resting HR',r?`${r.bpm} bpm`:'—',r?.date,base!=null?`${r.bpm>=base?'+':''}${Math.round(r.bpm-base)} vs baseline`:'']];
    for(const [label,value,d,baseline]of rows)cells.append(button([words('span','small muted',label),words('strong','',value),words('span','small muted',d?`${d===dayKey(Date.now())?'today':short(d)}${baseline?' · '+baseline:''}`:'no reading')],()=>saveOpen('recovery')));
    return [section('last night'),cells];
  }
  function week() {
    const days=weekDays(Date.now(),weekOffset); if(!days.includes(selectedDay))selectedDay=days[0];
    const done=feed.filter(x=>days.includes(dayKey(x.start))), planned=plans.filter(x=>days.includes(dayKey(x.when))&&!x.done&&!x.active);
    const nav=el('div','keys',button('‹',()=>{weekOffset--;selectedDay=weekDays(Date.now(),weekOffset)[0];draw();}),button('today',()=>{weekOffset=0;selectedDay=dayKey(Date.now());draw();}),button('›',()=>{weekOffset++;selectedDay=weekDays(Date.now(),weekOffset)[0];draw();}));
    nav.children[0].setAttribute('aria-label','Previous week');nav.children[2].setAttribute('aria-label','Next week');
    const rail=el('div','movement-week');rail.setAttribute('aria-label','Training days');
    for(const d of days){const count=done.filter(x=>dayKey(x.start)===d).length, p=plans.filter(x=>dayKey(x.when)===d&&!x.done).length;
      const pending=p+taskPlans.filter(t=>t.due===d&&!t.done).length;
      const b=button([words('span','small muted',new Date(d+'T12:00:00').toLocaleDateString([],{weekday:'short'})),words('strong','',d.slice(-2)),words('span','movement-day-mark',count?'●'.repeat(Math.min(3,count)):pending?'◇':'·')],()=>{selectedDay=d;draw();},d===selectedDay?'selected':''); b.setAttribute('aria-pressed',String(d===selectedDay)); b.setAttribute('aria-label',`${date(d+'T12:00:00')}, ${count} completed, ${pending} planned`);rail.append(b); }
    const list=el('div','movement-day-sessions'), activities=feed.filter(x=>dayKey(x.start)===selectedDay), scheduled=plans.filter(x=>dayKey(x.when)===selectedDay&&!activities.some(a=>a.workout?.plan_uid===x.uid));
    const taskDay=taskPlans.filter(t=>t.due===selectedDay);list.append(...activities.map(activityRow),...scheduled.map(p=>planRow(p)),...taskDay.map(taskRow));
    if(!activities.length&&!scheduled.length&&!taskDay.length)list.append(words('p','small muted','No sessions'));
    return [section(weekOffset===0?'this week':short(days[0])+' – '+short(days[6]),nav),words('p','small muted',`${done.length} completed · ${planned.length+taskPlans.filter(t=>days.includes(t.due)&&!t.done).length} planned · ${moving(done.reduce((n,x)=>n+x.seconds,0))}`),rail,list,button('+ plan session',()=>edit(),'movement-plan-add')];
  }
  const taskRow=t=>button([el('span','movement-session-copy',words('strong','',t.text),words('span','small muted',`${short(t.due)} · Pip training${t.done?' · done':''}`)),words('span','','→')],()=>go('/tasks/'+encodeURIComponent(t.uid)),'movement-session featured');
  function overview(){
    const today=dayKey(Date.now()), next=plans.find(p=>!p.done&&(p.active||dayKey(p.when)>=today));
    const jump=button('your plan',()=>{body.querySelector('.movement-week')?.scrollIntoView({block:'center',behavior:'instant'});});
    const nextTask=taskPlans.find(t=>!t.done&&t.due>=today), taskFirst=nextTask&&(!next||nextTask.due<dayKey(next.when));
    const pip=button([mascot(true),words('span','','talk training with Pip'),words('span','','→')],act(()=>askPip(trainingText({deck,result,feed,plans,tasks:taskPlans}))),'movement-pip');
    return [...scoreCards(),section('next session',jump),taskFirst?taskRow(nextTask):next?planRow(next,true):button('plan a session',()=>edit(),'movement-session featured'),...night(),...week(),pip];
  }
  function activityRow(item){
    const value=item.workout?`${setCount(item.workout)} sets`:item.km>0?`${item.km.toFixed(1)} km`:moving(item.seconds);
    return button([words('span','movement-sport '+item.sport,{gym:'Ⅱ',run:'↗',ride:'○',swim:'≈',walk:'↟',other:'·'}[item.sport]),el('span','movement-activity-copy',words('strong','',item.name),words('span','small muted',`${date(item.start)} · ${item.source} · ${moving(item.seconds)}`)),words('strong','movement-activity-value',value)],()=>navigateActivity(item),'movement-activity');
  }
  function activityView(item){
    if(!item)return [button('‹ activities',()=>go('/movement/activities')),words('p','small muted','This activity is unavailable.')];
    const out=[button('‹ activities',()=>go('/movement/activities'),'movement-back'),words('h2','movement-detail-title',item.name),words('p','small muted',`${date(item.start)} · ${item.source}`)];
    if(item.workout){
      const w=item.workout;
      out.push(el('div','movement-night',words('strong','',moving(item.seconds)),words('strong','',`${setCount(w)} sets`),words('strong','',`${Math.round(volume(w))} kg`)),button('open Gym log',()=>go('/gym/w:'+w.id),'movement-plan-add'));
      const linked=Boolean(w.coros_id), choices=recordingChoices(w,items,gym.all());
      if(linked||choices.length)out.push(button(linked?'unlink COROS recording':'link COROS recording',async()=>{
        const picked=linked?-1:await choose('COROS recording',choices.map(a=>`${time(a.start)} · ${a.name} · ${moving(a.seconds)}`));
        if(picked==null||!alive())return;
        try{const current=gym.get(w.id);if(!current)throw new Error('This workout was removed.');if(picked>=0&&!recordingChoices(current,coros.cached()?.list||[],gym.all()).some(a=>a.id===choices[picked].id))throw new Error('This recording is already linked or unavailable.');gym.edit(w.id,x=>{x.coros_id=picked<0?'':choices[picked].id;});draw();}catch(e){say(e.message);}
      },'movement-plan-add'));
    }
    const a=item.coros;if(!a)return out;
    let info=details.get(a.id);
    const fetch=()=>{details.set(a.id,'loading');coros.activity(a).then(x=>{if(alive()){details.set(a.id,x);draw();}},e=>{if(alive()){details.set(a.id,'error');say(e.message);draw();}});};
    if(!info){fetch();info='loading';}
    const ready=info&&typeof info==='object'?info:null;
    if(info==='error'||ready?.partial)out.push(button('retry activity',()=>{fetch();draw();}));
    if(ready?.path){const p=ready.path;out.push(el('div','movement-route',svg('svg',{viewBox:'0 0 320 190',role:'img','aria-label':`Route of ${a.name}`},svg('path',{d:p.d,fill:'none',stroke:'currentColor','stroke-width':2}),svg('circle',{cx:p.start[0],cy:p.start[1],r:4,fill:'currentColor'}))));}
    else out.push(words('p','small muted',info==='loading'?'Loading activity…':info==='error'?'Activity details unavailable':'No GPS track'));
    const metrics=[[a.km>0?`${a.km.toFixed(1)} km`:null,'distance'],[moving(a.seconds),'moving'],[a.pace,a.paceLabel],[a.hr?`${a.hr} bpm`:null,'avg heart rate'],[a.kcal?String(a.kcal):null,'kcal'],[ready?.climb!=null?`${ready.climb} m`:null,'climb']];
    out.push(el('div','movement-detail-metrics',metrics.filter(([v])=>v!=null).map(([v,l])=>el('div','',words('strong','',v),words('span','',l)))));
    if(ready?.series)out.push(charts(ready.series,a.type==='RIDE',allCharts,()=>{allCharts=!allCharts;draw();}));
    if(ready)out.push(el('details','activity-more',words('summary','','splits & metrics'),splits(ready.laps,a.type==='RIDE'),bands(ready.series),el('dl','activity-facts',(ready.detail||[]).map(([k,v])=>el('div','',words('dt','',k),words('dd','',v))))));
    return out;
  }
  function activities(){
    if(selected)return activityView(feed.find(x=>x.id===selected));
    const filters=el('div','movement-filters');for(const [id,label]of [['all','all'],['run','runs'],['gym','gym'],['ride','rides'],['swim','swims'],['walk','walks'],['other','other']]){const b=button(label,()=>{filter=id;draw();});b.setAttribute('aria-pressed',String(filter===id));filters.append(b);}
    const visible=feed.filter(a=>filter==='all'||a.sport===filter), total=visible.reduce((n,a)=>n+a.seconds,0), km=visible.reduce((n,a)=>n+a.km,0);
    return [filters,words('p','small muted',`${visible.length} sessions · ${moving(total)}${filter!=='all'&&filter!=='gym'&&km>0?' · '+km.toFixed(1)+' km':''}`),...visible.map(activityRow),!visible.length?words('p','small muted','No activities'):null];
  }
  function trends(){
    const controls=el('div','movement-filters');for(const p of [7,28,90]){const b=button(p+' days',()=>{period=p;draw();});b.setAttribute('aria-pressed',String(period===p));controls.append(b);}
    const keys=Array.from({length:period},(_,i)=>{const d=new Date();d.setDate(d.getDate()-period+i+1);return dayKey(d);}), labels=keys.map(short);
    const values=(list,field)=>keys.map(d=>{const item=list?.find(x=>x.date===d);return item?field(item)??null:null;});
    const card=(label,ns,format,bars=false)=>{
      const known=ns.filter(v=>v!=null), last=ns.findLast(v=>v!=null), lastIndex=ns.findLastIndex(v=>v!=null);
      return el('section','movement-trend',el('div','movement-section-head',words('h2','',label),words('strong','',last==null?'—':format(last))),known.length?(bars?dayBars:dayLine)(labels,ns,{label,format}):words('p','small muted','No readings in this period'),el('div','cockpit-axis',words('span','',short(keys[0])),words('span','',`${known.length}/${period} days${lastIndex>=0?' · latest '+short(keys[lastIndex]):''}`)));
    };
    const training=keys.map(d=>feed.filter(a=>dayKey(a.start)===d).reduce((n,a)=>n+a.seconds/60,0));
    return [controls,card('recovery',result.recoveries.map(x=>x?.score??null),v=>v+'%'),card('training time',training,minutes,true),card('resting HR',values(deck.resting,x=>x.bpm),v=>v+' bpm'),
      card('HRV',values(deck.hrv,x=>x.avg),v=>v+' ms'),card('sleep',values(deck.daily?.days,x=>x.sleep?.total),minutes,true),
      card('strain',result.strains.map(x=>items.some(a=>dayKey(a.start)===x.date)||deck.daily?.days?.some(d=>d.date===x.date)?x.strain:null),v=>v+'%',true),
      card('condition',result.conditioning.trail.slice(-period).map(x=>items.some(a=>dayKey(a.start)<=x.date)?x.score:null),String),fitnessStrip(deck)];
  }
  function draw(){
    if(!alive())return;recompute();cleanupNodes();
    const focus=document.activeElement?.dataset?.score;
    const source=button(loading?'COROS · refreshing…':at?'COROS · '+(dayKey(at)===dayKey(Date.now())?'':date(at)+' · ')+time(at):'connect COROS',act(()=>{if(coros.connected())void load(true);else coros.connect().catch(e=>say(e.message));}),'movement-source');source.disabled=loading;
    const nav=el('nav','movement-tabs');nav.setAttribute('aria-label','Movement views');
    for(const name of ['overview','activities','trends']){const b=button(name,()=>{tabStorage.setItem('pocket:movement-tab',name);go('/movement/'+name);});b.setAttribute('aria-current',(selected?'activities':tab)===name?'page':'false');nav.append(b);}
    const message=coros.connectionError();
    const settings=button('settings',async()=>{
      const connected=coros.connected(), index=await choose('COROS',connected?['refresh','open COROS','disconnect']:['connect COROS','open COROS']);
      if(index==null||!alive())return;
      try{if(index===0){if(connected)await load(true);else await coros.connect();}else if(index===1)window.open('https://training.coros.com/','_blank','noopener');else if(await choose('Disconnect COROS?',['disconnect','cancel'])===0){if(!alive())return;await coros.disconnect();draw();}}catch(error){say(error.message);}
    },'movement-settings');
    body.replaceChildren(el('header','movement-header',el('div','',words('h1','movement-title','movement'),words('p','small muted',date(Date.now()))),el('div','movement-header-actions',source,settings)),nav,
      ...(message?[words('p','movement-form-error',message)]:[]),...((selected?'activities':tab)==='activities'?activities():tab==='trends'?trends():overview()).filter(Boolean));
    if(focus)body.querySelector(`[data-score="${focus}"]`)?.focus({preventScroll:true});
  }
  const update=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(owner!==activeAccount()){leave();body.replaceChildren();return;}if(!document.hidden)draw();},120);};
  const unlisten=onChange(name=>{if(['agenda.json','gym.json','tasks.json'].includes(name))update();});
  const unsync=onStatus(update);
  addEventListener('pocket-coros-synced',update);addEventListener('storage',update);document.addEventListener('visibilitychange',update);
  const midnight=setInterval(()=>{if(!document.hidden)update();},60000);
  dispose=()=>{stopped=true;editor?.();clearTimeout(timer);clearInterval(midnight);unlisten();unsync();cleanupNodes();removeEventListener('pocket-coros-synced',update);removeEventListener('storage',update);document.removeEventListener('visibilitychange',update);};
  draw();if(coros.connected()&&refresh)void load();
}
