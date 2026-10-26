// Deterministic articulated, low-poly actor build. Run: node tools/sprites/shadow/actors.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { box, ball, chain, translate, rotY, rotZ, makeTarget, render, ps1Quantize } from '../ps1/raster.mjs';
import { png } from '../ps1/apng.mjs';
import { spriteCamera, SPRITE_LIGHTS, DIRECTIONS, facingToModel } from './camera.mjs';
const ROOT = new URL('../../../', import.meta.url), W = 160, H = 176, AX = 80, AY = 104, COLS = 32;
const TAU = Math.PI * 2, mix = (a,b,t) => a+(b-a)*t, smooth = t => (t=Math.max(0,Math.min(1,t)),t*t*(3-2*t));
const clips = {
  operative: { idle:[6,2], walk:[8,.72], sprint:[8,.48], crouchIdle:[6,2], sneak:[8,1.1], dash:[7,.36,false], slide:[7,.65,false], vault:[8,.7,false], knifeSwing:[8,.5,false], knifeStab:[7,.6,false], takedown:[10,1.5,false], pistolAim:[4,1.4], pistolFire:[5,.26,false], drag:[8,1.1], terminal:[8,1] },
  guard: { idle:[8,3], walk:[8,.85], run:[8,.55], startled:[6,.42,false], struggle:[8,.7], choked:[8,1.1,false], knockedOut:[1,1], shotDeath:[9,.65,false], knifedDeath:[9,.8,false], dead:[1,1], dragged:[6,.8], groggyWalk:[8,1.2] },
};
const cache = new Map();
function mesh(w,h,d,mat,round=false) { const key=[w,h,d,mat,round].join(); if(!cache.has(key)) cache.set(key,round?ball(w/2,h/2,d/2,mat,{slices:8,stacks:5}):box(w,h,d,mat)); return cache.get(key); }
function pose(name,t) {
  const s=Math.sin(t*TAU), c=Math.cos(t*TAU), p={hip:13,lean:0,bob:.18*s,step:0,arms:0,reach:0,head:0,fall:0,twist:0};
  if(['walk','sprint','run','sneak','drag','groggyWalk'].includes(name)) { p.step=s*(name==='sprint'||name==='run'?5.4:3.2); p.bob=Math.abs(c)*.65; p.arms=-s*2.5; p.lean=.12; }
  if(['crouchIdle','sneak'].includes(name)) { p.hip=8.2; p.lean=.42; p.step*=.65; }
  if(name==='idle') p.head=Math.sin(t*TAU)*.28;
  if(name==='sprint'||name==='run') p.lean=.32;
  if(name==='groggyWalk') {p.lean=.3;p.twist=s*.14;p.hip=11.8;}
  if(name==='dash') {p.hip=13-3*Math.sin(Math.PI*t);p.lean=[-.15,-.25,.65,.8,.65,.32,0][Math.round(t*6)];p.step=4*Math.sin(t*Math.PI);p.arms=-4;}
  if(name==='slide') {p.hip=4.5;p.lean=-.65;p.step=6;p.arms=-3;}
  if(name==='vault') {p.hip=10-4*Math.sin(t*Math.PI);p.lean=.6;p.reach=6;p.step=3*Math.sin(t*Math.PI);}
  if(name==='knifeSwing') {p.twist=-.6+1.3*smooth((t-.18)/.55);p.reach=6;p.swing=-1.7+3*smooth((t-.15)/.6);p.lean=.15;}
  if(name==='knifeStab') {p.reach=2+8*Math.sin(smooth(t)*Math.PI);p.lean=.25*Math.sin(t*Math.PI);}
  if(name==='takedown') {p.reach=6-2*smooth(t/.35)-2*smooth((t-.7)/.3);p.hip=13-3*smooth((t-.7)/.3);p.lean=.18;}
  if(name==='pistolAim'||name==='pistolFire') {p.reach=8;p.kick=name==='pistolFire'?Math.exp(-t*7)*2:0;}
  if(name==='drag') {p.reach=-5;p.lean=-.2;}
  if(name==='terminal') {p.reach=6;p.arms=s*.8;p.lean=.22;}
  if(name==='startled') {p.reach=6*smooth(t);p.lean=-.17*Math.sin(t*Math.PI);}
  if(name==='struggle') {p.reach=2;p.arms=s*2;p.twist=s*.13;p.hip=12;}
  if(name==='choked') {p.hip=13-8*smooth(t);p.lean=.2+.5*t;p.arms=-3*t;}
  if(['dead','knockedOut','dragged','shotDeath','knifedDeath'].includes(name)) {p.fall=name.endsWith('Death')?smooth((t-.12)/.78):1;p.lean=name==='knifedDeath'?.65*Math.sin(t*Math.PI):-.3*Math.sin(t*Math.PI);p.arms=-2;p.step=1.5; if(name==='dragged')p.twist=s*.04;}
  return p;
}
function parts(kind,name,t,angle) {
  const p=pose(name,t), guard=kind==='guard', out=[];
  const R=chain(rotZ(facingToModel(angle)),translate(0,0, p.fall*3),rotY(-p.fall*Math.PI/2),translate(0,0,-p.fall*13),rotZ(p.twist));
  const hip=p.hip+p.bob, B=chain(R,translate(0,0,hip),rotY(p.lean));
  const add=(size,at,mat,M=R,round=false)=>out.push({mesh:mesh(...size,mat,round),matrix:chain(M,translate(...at))});
  const bone=(a,b,width,mat,M=R)=> {const d=b.map((x,i)=>x-a[i]), len=Math.hypot(...d), z=d.map(x=>x/len), ref=Math.abs(z[2])<.9?[0,0,1]:[0,1,0], x=[ref[1]*z[2]-ref[2]*z[1],ref[2]*z[0]-ref[0]*z[2],ref[0]*z[1]-ref[1]*z[0]], l=Math.hypot(...x);for(let i=0;i<3;i++)x[i]/=l;const y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];out.push({mesh:mesh(width,width,len,mat),matrix:chain(M,[x[0],y[0],z[0],(a[0]+b[0])/2,x[1],y[1],z[1],(a[1]+b[1])/2,x[2],y[2],z[2],(a[2]+b[2])/2,0,0,0,1])});};
  add([4.8,7,3],[0,0,hip-1],'suit');
  for(const side of [-1,1]) { const step=p.step*side, foot=[step+(name==='slide'?6:0),side*2.2,1.1+Math.max(0,-step)*.35], knee=[2+step*.48,side*2.4,hip*.5]; bone([0,side*2,hip-1],knee,2.8,'suit');bone(knee,foot,2.3,'suit');add([1.3,2.8,2.5],[knee[0]+1.2,knee[1],knee[2]],'armor');add([4,2.8,2.2],[foot[0]+.6,foot[1],foot[2]],'boot'); }
  add([5,7.7,7.5],[0,0,4],'suit',B,true);add([1.6,7,6],[2.1,0,4.2],'armor',B);add([2,5.5,6],[-3,0,4.5],'pack',B);
  for(const side of [-1,1]) {add([1.4,1.5,5],[2.9,side*2.6,4.5],'strap',B);add([1.7,1.8,2.5],[3.2,side*1.15,2.7],'pack',B);}
  add([5.3,7.2,.9],[0,0,.2],'boot',B);add([.7,1.2,.8],[2.8,0,.2],'metal',B);
  const HD=chain(B,translate(.25,0,10.8),rotZ(p.head));
  add([4.9,4.5,5.8],[0,0,0],guard?'skin':'suit',HD,true);
  if(guard) {add([5.5,5.2,1.8],[-.2,0,2.3],'suit',HD);add([2.8,5.3,.5],[2.5,0,1.8],'armor',HD);add([.4,3.5,1],[2.5,0,.5],'boot',HD);}
  else {add([1,5.2,1.6],[2.4,0,.8],'boot',HD);for(const y of [-1.25,1.25]) {add([1.5,1.5,1.5],[3,y,.8],'metal',HD);add([.25,1.05,1.05],[3.8,y,.8],'glow',HD);}}
  let hand;
  for(const side of [-1,1]) { const armed=guard&&!['struggle','choked','dead','knockedOut','dragged','shotDeath','knifedDeath'].includes(name); let h=[p.reach||1+p.arms*side,side*4,1.2]; if(armed)h=[4+p.reach*.4,side*2.5,3.7+p.reach*.35];if(p.reach&&!armed)h=[p.reach-(p.kick||0),side*(name==='takedown'?2:1.6),name==='vault'?-2:5];if(name==='knifeSwing'&&side===-1)h=[Math.cos(p.swing)*8,Math.sin(p.swing)*8,5];const elbow=[(h[0]-1)*.4,side*4.7,(h[2]+5)/2-1.5];bone([0,side*4,6.5],elbow,2.4,'suit',B);bone(elbow,h,2,'suit',B);add([2.2,2.1,2],[...h],'boot',B,true);if(side===-1)hand=h; }
  if(guard&&p.fall<.5&&!['struggle','choked'].includes(name)) {const G=chain(B,translate(5+p.reach*.4,-1,4+p.reach*.35));add([10,1.5,1.7],[0,0,0],'boot',G);add([4,.6,.6],[6,0,.2],'metal',G);add([1.6,1.2,2.7],[-1,0,-1.7],'boot',G);add([2,1,1],[5,0,-1.2],'metal',G);add([.3,.85,.85],[6.1,0,-1.2],'lamp',G);}
  if(name.startsWith('pistol')) {add([4.5,1,1.4],[hand[0]+1.8,hand[1],hand[2]+.6],'metal',B);if(name==='pistolFire'&&t===0)add([2.4,1.6,1.6],[hand[0]+4.7,hand[1],hand[2]+.6],'flash',B);}
  if(name.startsWith('knife')) {const G=chain(B,translate(...hand),rotZ(p.swing||0));add([2,.7,.7],[.8,0,0],'boot',G);add([4,.3,.7],[3.5,0,0],'metal',G);}
  return out;
}
function materials(guard) {return Object.fromEntries(Object.entries({suit:guard?[.31,.34,.23]:[.16,.26,.28],armor:guard?[.22,.25,.17]:[.12,.19,.21],pack:guard?[.38,.37,.24]:[.2,.28,.28],strap:[.42,.43,.35],boot:[.075,.09,.1],metal:[.47,.52,.53],skin:[.57,.45,.34],glow:[.48,1,.45],lamp:[.95,.85,.53],flash:[1,.87,.53]}).map(([k,color],i)=>[k,{id:i+1,color,emissive:['glow','lamp','flash'].includes(k)?1:0}]));}
const manifest={version:1,px:4,cell:[W,H],anchor:[AX,AY],columns:COLS,directions:['E','SE','S','SW','W','NW','N','NE'],actors:{}};
for(const kind of Object.keys(clips)) {
  const total=Object.values(clips[kind]).reduce((s,c)=>s+c[0]*8,0), width=COLS*W,height=Math.ceil(total/COLS)*H;
  const atlas=new Uint8ClampedArray(width*height*4), glow=new Uint8ClampedArray(atlas.length), animations={};let index=0;
  for(const [name,[frames,duration,loop=true]] of Object.entries(clips[kind])) {animations[name]={start:index,frames,duration,loop,directions:8};
    for(const angle of DIRECTIONS) for(let f=0;f<frames;f++) {const target=makeTarget(W,H),t=frames===1?1:f/(loop?frames:frames-1);render(target,parts(kind,name,t,angle),{camera:spriteCamera({origin:[AX,AY]}),materials:materials(kind==='guard'),lights:SPRITE_LIGHTS,snap:false});const rgba=ps1Quantize(target),ox=index%COLS*W,oy=Math.floor(index/COLS)*H;
      for(let y=0;y<H;y++)for(let x=0;x<W;x++)if((x<2||y<2||x>=W-2||y>=H-2)&&rgba[(y*W+x)*4+3])throw new Error(`Clipped ${kind}/${name}/${angle}/${f}`);
      for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){const n=y*W+x,s=n*4,d=((oy+y)*width+ox+x)*4;if(rgba[s+3]){atlas.set(rgba.subarray(s,s+4),d);if(target.mat[n]>=8)glow.set(rgba.subarray(s,s+4),d);}else if([n-1,n+1,n-W,n+W].some(j=>rgba[j*4+3]))atlas.set([7,12,14,255],d);}
      index++;
    }
  }
  const url=`/sprites/shadow-${kind}.png`,glowUrl=`/sprites/shadow-${kind}-glow.png`;
  png(fileURLToPath(new URL(`public${url}`,ROOT)),width,height,atlas);png(fileURLToPath(new URL(`public${glowUrl}`,ROOT)),width,height,glow);
  manifest.actors[kind]={url,glowUrl,width,height,animations};console.log(kind,index,'frames',width,height);
}
fs.writeFileSync(new URL('src/shared/shadow-sprites.js',ROOT),`// Generated by tools/sprites/shadow/actors.mjs. Direction-major frames per animation.\nexport const SHADOW_SPRITES = ${JSON.stringify(manifest,null,2)};\n`);
