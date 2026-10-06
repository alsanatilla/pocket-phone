import { activeAccount } from './workspace-storage.js';
import { load } from './store.js';
import * as cloud from './cloud.js';

// Paper originals and pending uploads survive reloads and remain isolated by account.
let opening;
function database(){if(!opening)opening=new Promise((resolve,reject)=>{const r=indexedDB.open('pocket-paper:'+(activeAccount()||'guest'),1);r.onupgradeneeded=()=>r.result.createObjectStore('photos',{keyPath:'uid'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>{opening=null;reject(r.error);};});return opening;}
async function op(mode,run){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('photos',mode),r=run(tx.objectStore('photos'));let value;r.onsuccess=()=>{value=r.result;};tx.oncomplete=()=>resolve(value);tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Could not save this Paper photo.'));});}
export async function savePhoto(uid,blob){await op('readwrite',s=>s.put({uid,blob,uploaded:false}));}
export async function paperBlob(uid){
  const cached=await op('readonly',s=>s.get(uid));if(cached)return cached.blob;
  if(!cloud.connected())return null;
  const blob=await cloud.readBlob('page-'+uid+'.jpg');if(blob)await op('readwrite',s=>s.put({uid,blob,uploaded:true}));return blob;
}
export async function syncPaperPhotos(){
  const pages=new Map(load('journal.json').pages.map(p=>[p.uid,p])),photos=await op('readonly',s=>s.getAll()),errors=[];
  for(const photo of photos){
    if(pages.get(photo.uid)?.deleted){await op('readwrite',s=>s.delete(photo.uid));continue;}
    if(photo.uploaded||!pages.has(photo.uid))continue;
    try{await cloud.writeImage('page-'+photo.uid+'.jpg',photo.blob);await op('readwrite',s=>s.put({...photo,uploaded:true}));}catch(error){if(error instanceof cloud.Expired)throw error;errors.push(error.message);}
  }
  if(errors.length)throw new Error(errors[0]);return false;
}
