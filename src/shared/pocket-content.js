import { canonical } from './objects.js';

export const CONTENT_FILES = ['agenda.json', 'clock.json', 'drafts.json', 'preferences.json'];
export const CONTENT_EMPTY = {
  'agenda.json': () => ({v:1,events:[]}),
  'clock.json': () => ({v:1,entries:[]}),
  'drafts.json': () => ({v:1,items:[]}),
  'preferences.json': () => ({v:1,items:[]}),
};
const arrays={'agenda.json':'events','clock.json':'entries','drafts.json':'items','preferences.json':'items'};
const limits={'agenda.json':300,'clock.json':200,'drafts.json':500,'preferences.json':64};
const stamp=value=>Number.isSafeInteger(value)&&value>=0;
const uid=value=>typeof value==='string'&&/^[A-Za-z0-9_:-]{1,160}$/.test(value);
const string=(value,max)=>typeof value==='string'&&value.length<=max;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const link=value=>value===undefined||value===''||uid(value);
export const PREFERENCE_IDS=['appearance','dice','pip-defaults','today-tiles','camera','calculator','home-tiles','daily-brief'];
export function validContent(name,doc){
  if(!object(doc)||!Array.isArray(doc[arrays[name]])||doc[arrays[name]].length>limits[name])return false;
  const seen=new Set();
  return doc[arrays[name]].every(item=>{
    if(!object(item)||!uid(item.uid)||!stamp(item.updated)||seen.has(item.uid))return false;
    seen.add(item.uid);
    if(name==='preferences.json'&&!PREFERENCE_IDS.includes(item.uid))return false;
    if(name==='preferences.json'&&item.uid==='daily-brief'&&item.deleted!==undefined&&typeof item.deleted!=='boolean')return false;
    if(item.deleted===true)return true;
    if(name==='agenda.json')return string(item.title,500)&&item.title.trim().length>0&&stamp(item.when)&&Number.isInteger(item.minutes)&&item.minutes>=1&&item.minutes<=1440&&link(item.task_uid)&&stamp(item.remindAt??0)&&stamp(item.created);
    if(name==='clock.json')return ['alarm','timer','focus','stopwatch'].includes(item.kind)&&string(item.title,500)&&typeof item.enabled==='boolean'&&typeof item.daily==='boolean'&&Number.isInteger(item.hour)&&item.hour>=0&&item.hour<=23&&Number.isInteger(item.minute)&&item.minute>=0&&item.minute<=59&&stamp(item.due)&&stamp(item.remaining)&&link(item.task_uid)&&stamp(item.created)&&(item.laps===undefined||string(item.laps,2400));
    if(name==='drafts.json')return ['note','task','thought','capture','appointment'].includes(item.kind)&&link(item.target_uid)&&object(item.value)&&JSON.stringify(item.value).length<=32000;
    if(item.uid==='daily-brief')return object(item.value)&&typeof item.value.enabled==='boolean'&&Object.keys(item.value).every(key=>key==='enabled');
    return JSON.stringify(item.value??null).length<=100000;
  });
}
export function mergeContent(name,stored,incoming){
  const key=arrays[name],all=new Map();
  for(const item of stored?.[key]||[])all.set(item.uid,item);
  for(const item of incoming?.[key]||[]){const old=all.get(item.uid);
    // Match native concurrent Brief edits: deletion wins, then the canonical boolean value.
    const briefTie=old&&name==='preferences.json'&&item.uid==='daily-brief'&&item.updated===old.updated
      &&(item.deleted===true&&old.deleted!==true||item.deleted!==true&&old.deleted!==true&&canonical(item.value)>canonical(old.value));
    if(!old||item.updated>old.updated||briefTie)all.set(item.uid,item);
  }
  return {v:1,[key]:[...all.values()]};
}
