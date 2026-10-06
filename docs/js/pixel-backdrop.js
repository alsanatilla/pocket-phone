// Original header artwork, one scene per area. The ordered-dither kernel and every scene are shared with PixelBackdrop.java.
const BAYER = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
export const SCENES = ['sky','stars','road','waves','terrain','iron','tiles','rings','glow'];
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = (a,b,v) => { const t=clamp((v-a)/(b-a)); return t*t*(3-2*t); };
const fract = v => v-Math.floor(v);
const hash = (a,b) => fract(Math.sin(a*127.1+b*311.7)*43758.5453);

function sky(x,y,u,v,aspect) {
  const cloud=Math.sin(u*19+Math.sin(v*11)*2)+.55*Math.sin(u*43-v*17)+.3*Math.cos(u*83+v*29);
  let light=.11+.13*smooth(-.3,1.25,cloud)*(1-smooth(.32,.64,v));
  const moon=Math.hypot((u-.78)*aspect,v-.19);
  light+=.11*Math.exp(-moon*19);
  if(moon<.066)light=.65;
  const ridge=.53+.045*Math.sin(u*14)+.03*Math.sin(u*31+1);
  if(v>ridge)light=.075+.035*Math.sin(v*125+u*23);
  if(v>ridge+.09)light*=.72;
  return light;
}
// Thoughts: a drifting nebula, scattered stars and one bright idea.
function stars(x,y,u,v,aspect,width,height) {
  const band=v-(.78-.55*u)-.06*Math.sin(u*7+1);
  let light=.04+.16*Math.exp(-band*band*26)*(.6+.4*Math.sin(u*31+v*13)*Math.sin(u*11-v*5));
  const gx=Math.floor(x/5), gy=Math.floor(y/5), r=hash(gx,gy);
  if(r>.88){const d=Math.abs(x-gx*5-Math.floor(hash(gy,gx)*4))+Math.abs(y-gy*5-Math.floor(fract(r*7.3)*4));
    if(d===0)light=.3+(r-.88)*3;else if(d===1&&r>.975)light=Math.max(light,.2);}
  const dx=Math.abs(x-Math.round(width*.8)), dy=Math.abs(y-Math.round(height*.3));
  light+=.14*Math.exp(-Math.hypot(dx,dy)/7);
  if((dx===0||dy===0)&&dx+dy<9)light=Math.max(light,.66-(dx+dy)*.05);
  return light;
}
// Tasks: a road of grid lines running to a striped sun.
function road(x,y,u,v,aspect,width,height) {
  const horizon=.36, sx=(u-.74)*aspect;
  if(v<horizon){
    let light=.04+.12*Math.pow(v/horizon,3);
    const sun=Math.hypot(sx,v-horizon), s=(v-horizon+.3)/.3;
    if(sun<.3&&fract(v*26)>s*.6-.08)light=.34+.2*(1-s);
    return light;
  }
  const d=v-horizon, wx=sx/d*1.4, wz=.5/d, pixel=1.2/height;
  const across=Math.abs(wx-Math.round(wx))*d/1.4<pixel, deep=Math.abs(wz-Math.round(wz))*d*d/.5<pixel;
  return .03+.3*Math.max(across?smooth(.07,.24,d):0,deep?smooth(.14,.32,d):0);
}
// Notes: still water with a crescent and its reflection.
function waves(x,y,u,v,aspect) {
  const horizon=.4, mx=(u-.8)*aspect;
  if(v<horizon){
    let light=.05+.09*smooth(0,horizon,v);
    const moon=Math.hypot(mx,v-.2), shadow=Math.hypot(mx+.045,v-.18);
    light+=.08*Math.exp(-moon*14);
    if(moon<.085&&shadow>.075)light=.62;
    return light;
  }
  const d=v-horizon, t=1/(d+.05), crest=Math.sin(t*4.6+Math.sin(u*aspect*t*.9+t)*1.4);
  let light=.04+.1*smooth(.45,1,crest)*(1-smooth(.1,.5,d));
  light+=.34*Math.exp(-mx*mx*90/(1+d*30))*smooth(.2,.9,crest);
  return light;
}
// Movement: contour lines of a hill and a dotted route over it.
function terrain(x,y,u,v,aspect,width,height) {
  const px=u*aspect, hx=(u-.78)*aspect;
  const lift=.9*Math.exp(-(hx*hx*1.6+(v-.62)*(v-.62)*7))+.45*Math.exp(-((hx+.9)*(hx+.9)*2.4+(v-.82)*(v-.82)*9))+.04*Math.sin(px*5+v*9);
  const ring=fract(lift*9);
  let light=.03+.1*lift+(ring<.16&&lift>.06?.2:0);
  const route=.86-.5*u+.07*Math.sin(u*13);
  if(Math.abs(v-route)*height<1.1&&x%4<2)light=.5;
  return light;
}
// Gym: bars climbing to the right under a light.
function iron(x,y,u,v,aspect,width,height) {
  const glow=Math.hypot((u-.82)*aspect,v+.1);
  let light=.04+.16*Math.exp(-glow*2.2);
  const column=Math.floor(x/7), inside=x%7<5, rise=.16+.5*smooth(.05,1,column*7/width)+.08*hash(column,3);
  if(inside&&1-v<rise){light=.09+.07*(1-v);if((1-v)>rise-1.5/height)light=.38;else if((x+y)%4===0)light+=.05;}
  return light;
}
// Apps: a lit mosaic of tiles.
function tiles(x,y,u,v) {
  const gx=Math.floor(x/6), gy=Math.floor(y/6), r=hash(gx,gy+17);
  if(x%6===5||y%6===5)return .02;
  return .05+.16*r*smooth(.1,1,u)*(1-v*.5)+(r>.94?.3:0);
}
// Search: sonar rings around a point.
function rings(x,y,u,v,aspect,width,height) {
  const dx=(u-.8)*aspect, dy=v-.42, dist=Math.hypot(dx,dy);
  let light=.03+.12*Math.exp(-dist*3);
  if(fract(dist*9-.1)<1.4/height*9&&dist>.04)light+=.24*Math.exp(-dist*1.2);
  const angle=Math.atan2(dy,dx), sweep=fract((angle+2.4)/(2*Math.PI));
  if(sweep<.12&&dist<.9)light+=.18*(1-sweep/.12)*(1-dist);
  if(dist<.03)light=.66;
  return light;
}
// Pip: a full-page glow. Light rises behind the composer with rings radiating from it, a bloom spills from the top corner and sparks drift in the light; the middle stays black for reading.
function glow(x,y,u,v,aspect,width,height) {
  const size=Math.min(width,height), d=Math.hypot((x-width*.72)/size*.6,(y-height*1.08)/size), c=Math.hypot((x-width)/size,(y+height*.02)/size);
  let light=.42*Math.exp(-d*3)+.26*Math.exp(-c*4.5);
  for(const [radius,strength] of [[.42,.16],[.66,.11],[.92,.07]])light+=strength*Math.exp(-Math.pow((d-radius)*size/1.6,2));
  if(hash(Math.floor(x/6)+31,Math.floor(y/6))>.9&&x%6===2&&y%6===2)light+=.04+1.2*light;
  return Math.max(0,light-.03);
}
const PAINT = { sky, stars, road, waves, terrain, iron, tiles, rings, glow };

export function shade(scene,x,y,width,height) {
  const u=(x+.5)/width, v=(y+.5)/height, aspect=width/height;
  let light=(PAINT[scene]||sky)(x,y,u,v,aspect,width,height);
  if(scene!=='glow'){
    light*=1-smooth(.46,.99,v);
    // Quiet left side keeps clock, title and date legible over the artwork.
    light*=.3+.7*smooth(.10,.68,u);
  }
  const value=clamp(light)*10, base=Math.floor(value);
  return Math.min(7,base+(value-base>(BAYER[(y%4)*4+x%4]+.5)/16?1:0));
}

export function backdrop(scene='sky') {
  const canvas=document.createElement('canvas');canvas.className='pixel-backdrop';
  canvas.setAttribute('aria-hidden','true');canvas.dataset.scene=scene;
  let disposed=false, lastWidth=0, lastHeight=0;
  const draw=()=>{
    if(disposed||!canvas.isConnected)return;
    const box=canvas.getBoundingClientRect(), width=Math.max(1,Math.ceil(box.width/2)), height=Math.max(1,Math.ceil(box.height/2));
    if(width===lastWidth&&height===lastHeight)return;
    lastWidth=canvas.width=width;lastHeight=canvas.height=height;
    const context=canvas.getContext('2d'), image=context.createImageData(width,height);
    const hex=getComputedStyle(canvas).getPropertyValue('--accent').trim().replace('#','');
    const accent=/^[0-9a-f]{6}$/i.test(hex)?parseInt(hex,16):0xf9f594;
    const channels=[accent>>16&255,accent>>8&255,accent&255];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const level=shade(scene,x,y,width,height), offset=(y*width+x)*4;
      for(let c=0;c<3;c++)image.data[offset+c]=Math.round((channels[c]*.55+255*.45)*level/7);
      image.data[offset+3]=255;
    }
    context.putImageData(image,0,0);
  };
  const observer=new ResizeObserver(draw);observer.observe(canvas);
  canvas.dispose=()=>{disposed=true;observer.disconnect();};
  return canvas;
}
