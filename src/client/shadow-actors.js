import { SHADOW_SPRITES as atlas } from '../shared/shadow-sprites.js';
import { K, V } from './shadow-view.js';

const images = {};
if (typeof Image !== 'undefined') for (const [kind, data] of Object.entries(atlas.actors)) {
  const body = new Image(), glow = new Image();
  body.src = data.url; glow.src = data.glowUrl; images[kind] = { body, glow };
}
const clamp = x => Math.max(0, Math.min(1, x));
const ease = x => (x = clamp(x), x * x * (3 - 2 * x));
const loaded = image => image?.complete && image.naturalWidth > 0;

/** Pure selection, also useful for previews. All time values are seconds. */
export function actorFrame(sim, actor, time = sim.t || 0) {
  const player = actor === sim.player, kind = player ? 'operative' : 'guard';
  let name = 'idle', progress = null, clock = actor.anim ?? time, angle = actor.facing || 0;
  if (player) {
    const m = actor.move, a = actor.action, shot = (sim.t ?? time) - (actor.shotAt ?? -99);
    if (m) { name = m.kind; progress = m.t / m.time; angle = m.angle ?? angle; }
    else if (a) { name = { swing:'knifeSwing', kill:'knifeStab', takedown:'takedown', grab:'takedown', body:'crouchIdle', hack:'terminal', panel:'terminal' }[a.kind] || 'idle'; if (a.kind === 'grab') progress = clamp(a.t / a.need) * .35; else if (!['hack','panel','body'].includes(a.kind)) progress = a.t / a.need; }
    else if (actor.carrying != null) { name = 'drag'; if (!actor.moving) clock = 0; }
    else if (shot >= 0 && shot < .26) { name = 'pistolFire'; progress = shot / .26; }
    else if (actor.aiming) name = 'pistolAim';
    else if (actor.crouch) name = actor.moving ? 'sneak' : 'crouchIdle';
    else if (actor.moving) name = actor.running || actor.speed > 140 ? 'sprint' : 'walk';
  } else {
    const a = sim.player?.action, age = (sim.t ?? time) - (actor.deadAt ?? -99);
    if (actor.carried) name = 'dragged';
    else if (actor.grabbed && a?.kind === 'grab') name = 'struggle';
    else if (actor.grabbed) {
      const u = a?.target === actor.id ? clamp(a.t / a.need) : 0;
      name = u > .55 ? 'choked' : 'struggle'; if (name === 'choked') progress = (u - .55) / .45;
    } else if (actor.dead) { name = age >= 0 && age < .8 ? (actor.lastAction === 'shot' ? 'shotDeath' : 'knifedDeath') : 'dead'; if (name !== 'dead') progress = age / (name === 'shotDeath' ? .65 : .8); }
    else if (actor.down) name = 'knockedOut';
    else if (actor.freeze > 0) { name = 'startled'; progress = ((sim.t ?? time) - (actor.spottedAt ?? time)) / .42; }
    else if (actor.moving) name = actor.groggy > 0 ? 'groggyWalk' : actor.sees || actor.state === 'alert' ? 'run' : 'walk';
  }
  const clip = atlas.actors[kind].animations[name] || atlas.actors[kind].animations.idle;
  const direction = ((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8;
  const frame = progress == null ? Math.floor(((clock % clip.duration + clip.duration) % clip.duration) / clip.duration * clip.frames) : Math.min(clip.frames - 1, Math.floor(clamp(progress) * clip.frames));
  const index = clip.start + direction * clip.frames + frame;
  return { kind, name, direction, frame, sx: index % atlas.columns * atlas.cell[0], sy: Math.floor(index / atlas.columns) * atlas.cell[1] };
}
function hidden(sim,a) { return a === sim.player ? !!a.locker : !!a.hidden; }
function opacity(sim,a) { return a === sim.player && a.hidden ? .35 : 1; }
function ellipse(ctx,x,y,rx,ry,color) {ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
function drawCell(ctx, image, f) {ctx.imageSmoothingEnabled=true;ctx.drawImage(image,f.sx,f.sy,...atlas.cell,-atlas.anchor[0]/atlas.px,-atlas.anchor[1]/atlas.px,atlas.cell[0]/atlas.px,atlas.cell[1]/atlas.px);}
function fallback(ctx,sim,a) {
  const guard=a!==sim.player, low=a.down||a.dead, height=low?4:a.crouch?11:17;
  ctx.strokeStyle='#080e12';ctx.lineWidth=1;
  ellipse(ctx,0,-height*.4,low?10:3.8,low?3:height*.43,guard?'#62674a':'#345158');ctx.stroke();
  ellipse(ctx,low?-7:0,-height,2.5,2.2,guard?'#938166':'#456065');ctx.stroke();
  if(!low)for(const side of [-1,1])ellipse(ctx,side*2,0,1.6,1,'#131b20');
}

/** Feet-anchored screen-plane drawing. Caller positions the ground origin; do not rotate or squash it. */
export function drawActor(ctx, sim, actor, time = sim.t || 0, opts = {}) {
  if (hidden(sim,actor)) return;
  const f=actorFrame(sim,actor,time), image=images[f.kind]?.body;
  ctx.save();ctx.globalAlpha*=opacity(sim,actor);
  ellipse(ctx,0,0,actor.down||actor.dead?10:4.6,(actor.down||actor.dead?3.8:3)*K,'rgba(0,0,0,.4)');
  ctx.translate(0,-(actor.z||0)*V);
  // Only a subtle breathing squash is added; baked articulation has no smears.
  const breath=f.name==='idle'||f.name==='crouchIdle'?Math.sin(time*3)*.008*(opts.reduceMotion ? .25 : 1):0;
  ctx.scale(1,1+breath);
  if(loaded(image))drawCell(ctx,image,f);else fallback(ctx,sim,actor);
  ctx.restore();
}

/** Additive pass after scene lighting, with the identical frame and feet anchor. */
export function drawActorGlow(ctx,sim,actor,time=sim.t||0,opts={}) {
  if(hidden(sim,actor))return;
  const f=actorFrame(sim,actor,time),image=images[f.kind]?.glow;
  ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha*=opacity(sim,actor);ctx.translate(0,-(actor.z||0)*V);
  const breath=f.name==='idle'||f.name==='crouchIdle'?Math.sin(time*3)*.008*(opts.reduceMotion ? .25 : 1):0;ctx.scale(1,1+breath);
  if(loaded(image))drawCell(ctx,image,f);
  else if(actor===sim.player&&!actor.down)ellipse(ctx,Math.cos(actor.facing||0)*2,-(actor.crouch?11:17),.7,.4,'#83e889');
  ctx.restore();
}

/** Conservative screen-space extent, centred horizontally above the feet. */
export function actorBox(actor) {
  const lying=actor.down||actor.dead||actor.carried, low=actor.crouch||actor.move?.kind==='slide';
  return {w:36,h:(lying?18:low?17:26)+(actor.z||0)*V};
}

export function heldGuardPose(sim,g,time) {
  const p=sim.player,a=p?.action;
  if(!g.grabbed||a?.target!==g.id||!['kill','takedown','grab'].includes(a.kind))return null;
  // The grab before a tap or hold decides it is the start of the hold.
  const u=a.kind==='grab'?clamp(a.t/a.need)*.35:clamp(a.t/a.need),hold=ease(u/.35)*(1-ease((u-.7)/.3)),choke=a.kind!=='kill';
  const reach=choke?6.8:8,struggle=Math.sin(u*Math.PI*10)*Math.sin(u*Math.PI)*(choke ? .6 : .25);
  return {dx:(p.x+Math.cos(p.facing)*reach-g.x)*hold-Math.sin(p.facing)*struggle,dy:(p.y+Math.sin(p.facing)*reach-g.y)*hold+Math.cos(p.facing)*struggle};
}
