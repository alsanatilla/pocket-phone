// Original sky artwork. The ordered-dither kernel is shared with PixelBackdrop.java.
const BAYER = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = (a,b,v) => { const t=clamp((v-a)/(b-a)); return t*t*(3-2*t); };

export function shade(x,y,width,height) {
  const u=(x+.5)/width, v=(y+.5)/height, aspect=width/height;
  const cloud=Math.sin(u*19+Math.sin(v*11)*2)+.55*Math.sin(u*43-v*17)+.3*Math.cos(u*83+v*29);
  let light=.11+.13*smooth(-.3,1.25,cloud)*(1-smooth(.32,.64,v));
  const moon=Math.hypot((u-.78)*aspect,v-.19);
  light+=.11*Math.exp(-moon*19);
  if(moon<.066)light=.65;
  const ridge=.53+.045*Math.sin(u*14)+.03*Math.sin(u*31+1);
  if(v>ridge)light=.075+.035*Math.sin(v*125+u*23);
  if(v>ridge+.09)light*=.72;
  light*=1-smooth(.46,.99,v);
  // Quiet left side keeps clock, title and date legible over the artwork.
  light*=.3+.7*smooth(.10,.68,u);
  const value=clamp(light)*10, base=Math.floor(value);
  return Math.min(7,base+(value-base>(BAYER[(y%4)*4+x%4]+.5)/16?1:0));
}

export function backdrop() {
  const canvas=document.createElement('canvas');canvas.className='pixel-backdrop';
  canvas.setAttribute('aria-hidden','true');
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
      const level=shade(x,y,width,height), offset=(y*width+x)*4;
      for(let c=0;c<3;c++)image.data[offset+c]=Math.round((channels[c]*.55+255*.45)*level/7);
      image.data[offset+3]=255;
    }
    context.putImageData(image,0,0);
  };
  const observer=new ResizeObserver(draw);observer.observe(canvas);
  canvas.dispose=()=>{disposed=true;observer.disconnect();};
  return canvas;
}
