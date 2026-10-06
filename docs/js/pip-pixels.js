// pip's little activities, drawn with the same 32-pixel grid as the phone.
export function pose(activity, frame) {
  const t=frame/64, pixels=[], box=(x,y,w,h,tone="accent")=>pixels.push({x,y,w,h,tone});
  let x=8,y=10;
  if(activity===1)x+=Math.round(Math.sin(t*Math.PI*2)*5);
  if(activity===2)y+=Math.round(Math.sin(t*Math.PI*4));
  if(activity===4)y-=Math.round(Math.abs(Math.sin(t*Math.PI*2))*4);
  box(x+4,y,8,1);box(x+2,y+1,12,1);box(x+1,y+2,14,7);box(x+2,y+9,12,1);box(x+3,y+10,10,1);
  const step=activity===1&&frame%16<8?1:0;
  box(x+4,y+11+step,2,2);box(x+10,y+12-step,2,2);
  const blink=frame>=48&&frame<51, gaze=activity===1?Math.sign(Math.cos(t*Math.PI*2)):0;
  box(x+4+gaze,y+4,2,blink?1:2,"black");box(x+10+gaze,y+4,2,blink?1:2,"black");
  if(activity===0){box(x-1,y+6,2,4);const wave=Math.round(Math.sin(t*Math.PI*6));box(x+15,y+4+wave,2,4);box(x+17,y+2+wave,2,2);}
  else if(activity===2){box(x-1,y+6,2,2);box(x+15,y+6,2,2);for(let i=0;i<3;i++){const a=t*Math.PI*2+i*Math.PI*2/3;box(15+Math.round(Math.cos(a)*11),5+Math.round(Math.sin(a)*3),2,2);}}
  else if(activity===3){box(x-1,y+7,2,3);box(x+15,y+7,2,3);box(x+3,y+9,10,5,"white");box(x+8,y+9,1,5,"black");box(x+4,y+10,3,1,"black");box(x+10,y+11+(frame%32<16?0:1),2,1,"black");}
  else if(activity===4){box(x-1,y+4,2,3);box(x+15,y+4,2,3);box(x-2,y+2,2,2);box(x+17,y+2,2,2);}
  else{box(x-1,y+6+step,2,3);box(x+15,y+7-step,2,3);}
  return pixels;
}

export function mascot(animated=false) {
  const canvas=document.createElement("canvas");canvas.className="pip-mascot";canvas.width=canvas.height=64;canvas.setAttribute("aria-hidden","true");
  const context=canvas.getContext("2d");let frame=0,activity=animated?Math.floor(Math.random()*5):0,timer=0,disposed=false;
  const media=matchMedia("(prefers-reduced-motion: reduce)");
  const draw=()=>{context.clearRect(0,0,64,64);const accent=getComputedStyle(canvas).color;for(const p of pose(activity,frame)){context.fillStyle=p.tone==="accent"?accent:p.tone==="white"?"#fff":"#000";context.fillRect(p.x*2,p.y*2,p.w*2,p.h*2);}};
  const tick=()=>{timer=0;if(disposed||!canvas.isConnected||document.hidden||media.matches||!animated)return;frame=(frame+1)%64;if(frame===0)activity=(activity+1+Math.floor(Math.random()*4))%5;draw();timer=setTimeout(tick,50);};
  const visibility=()=>{clearTimeout(timer);timer=0;if(!disposed){draw();if(animated&&!document.hidden&&!media.matches)timer=setTimeout(tick,50);}};
  canvas.dispose=()=>{disposed=true;clearTimeout(timer);document.removeEventListener("visibilitychange",visibility);media.removeEventListener("change",visibility);};
  document.addEventListener("visibilitychange",visibility);media.addEventListener("change",visibility);requestAnimationFrame(visibility);
  return canvas;
}
