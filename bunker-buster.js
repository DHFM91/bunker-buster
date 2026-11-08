"use strict";

// Bump on every public build; index.html's script tag carries the same ?v= so browsers drop stale copies.
const VERSION = "v5";
const screen = document.querySelector("#screen");
const ctx = screen.getContext("2d");
// Phones get a render buffer matching their wider screen shape (same height, more width = wider view).
const touchDevice=matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints>0 && !matchMedia("(pointer: fine)").matches;
if (touchDevice) {
  const long=Math.max(innerWidth,innerHeight), short=Math.min(innerWidth,innerHeight)||1;
  const aspect=Math.max(16/9,Math.min(2.4,long/short));
  screen.width=Math.round(180*aspect/2)*2;
  document.querySelector("#viewmodel").width=Math.round(720*aspect);
}
const width = screen.width, height = screen.height;
const image = ctx.createImageData(width, height);
const pixels = image.data;
const overlay = document.querySelector("#overlay");
const title = document.querySelector("#title");
const brief = document.querySelector("#brief");
const deploy = document.querySelector("#deploy");
const objective = document.querySelector("#objective");
const health = document.querySelector("#health");
const ammo = document.querySelector("#ammo");
const message = document.querySelector("#message");
const bearing = document.querySelector("#bearing");
const signal = document.querySelector("#signal");
const healthFill = document.querySelector("#health-fill");
const chargeFill = document.querySelector("#charge-fill");
const prompt = document.querySelector("#prompt");
const vm = document.querySelector("#viewmodel").getContext("2d");
const VW = document.querySelector("#viewmodel").width, VH = 720, VS = VH/180;

const columns=7, rows=10, room=5, stride=8, wallTop=9;   // ~2x the original 5x7 rooms
const X=(columns-1)*stride+room+2, Y=12, Z=(rows-1)*stride+room+2;
const midCol=Math.floor(columns/2);
const firstCell=midCol, lastCell=(rows-1)*columns+midCol;
const world = new Uint8Array(X * Y * Z);
let colors = [[0,0,0], [76,82,75], [153,139,108], [66,83,84],
  [43,160,106], [229,143,47], [108,84,57], [124,112,92]];
// Per-deploy colour scheme. Intel (orange) and extraction pad (green) never change so
// objectives always read the same; everything else is re-rolled on each load.
let palette = {stripe:[178,126,53], stripeDark:[60,57,45], skyLo:[105,124,128], skyHi:[46,77,92]};
function hsl(h,s,l) {
  h=((h%360)+360)%360/360;
  const f=n=>{ const k=(n+h*12)%12, a=s*Math.min(l,1-l); return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))); };
  return [f(0),f(8),f(4)];
}
function rollPalette(random=Math.random) {
  const r=(a,b)=>a+random()*(b-a);
  const hue=r(0,360);
  const concrete=hsl(hue+r(-20,20),r(.08,.3),r(.42,.6));
  const floor=hsl(hue+r(-60,60),r(.05,.2),r(.24,.36));
  const outer=hsl(hue+r(120,240),r(.08,.25),r(.22,.34));
  // hazard-stripe accent: kept away from the intel's orange and the pad's green
  const accentHue=[0,52,190,215,280,320][Math.floor(random()*6)]+r(-8,8);
  const skyHue=hue+r(-90,90);
  palette={
    stripe:hsl(accentHue,r(.55,.8),r(.42,.55)), stripeDark:hsl(accentHue+180,.1,.18),
    skyLo:hsl(skyHue,r(.1,.35),r(.38,.6)), skyHi:hsl(skyHue+r(-20,20),r(.2,.45),r(.16,.3)),
  };
  colors=[[0,0,0], floor, concrete, outer, [43,160,106], [229,143,47], [108,84,57],
    concrete.map(c=>c*.82)];
  const fogMix=hsl(skyHue,.12,.24);
  for (let c=0;c<3;c++) {
    groundFog[c]=fogMix[c];
    dustColor[c]=concrete[c]*.95; rubbleColor[c]=Math.min(255,concrete[c]*1.15);
  }
  textures=buildTextures();
}
function cellCenter(cell) {
  return {x:1+cell%columns*stride+room/2, z:1+Math.floor(cell/columns)*stride+room/2};
}
const extraction=cellCenter(firstCell), intel=cellCenter(lastCell);
const intelX=Math.floor(intel.x), intelZ=Math.floor(intel.z);
const keys = new Set();
const player = {};
let guards, charges, reserve, magazine, reload, cooldown, flash, hurt;
let phase, hasIntel, notice, noticeTime, audio;
let particles = [];
let bullets = [];
let fallers = [], pending = new Map(), integrityTimer = 0, rumbleCD = 0, thudCD = 0, shake = 0, crushCD = 0;
const SPAN = 3;                      // how many voxels concrete may reach sideways from a support
let noise = null;                    // {field, x, z} — the last explosion guards are walking toward
const windup = .6, bulletSpeed = 21;
let blast, stridePhase, sway;
const plantTime = .55, fuseTime = 1.65, plantRange = 4.5;
let charge;
let run={time:0,blocks:0};

function inside(x, y, z) {
  return x >= 0 && y >= 0 && z >= 0 && x < X && y < Y && z < Z;
}
function index(x, y, z) { return x + X * (z + Z * y); }
function tile(x, y, z) {
  return inside(x, y, z) ? world[index(x,y,z)] : 0;
}
function box(x0,y0,z0,x1,y1,z1,material) {
  for (let y=y0; y<y1; y++)
    for (let z=z0; z<z1; z++)
      for (let x=x0; x<x1; x++) world[index(x,y,z)] = material;
}

// Random depth-first traversal opens one passage per newly visited room.
function generateMaze(random) {
  for (let attempt=0; attempt<96; attempt++) {
    const distance=Array(columns*rows).fill(-1);
    const route=[firstCell], passages=[];
    distance[firstCell]=0;
    let centralOpen=0;
    while (route.length) {
      const cell=route[route.length-1];
      const col=cell%columns, row=Math.floor(cell/columns);
      const options=[];
      if (col>0 && distance[cell-1]<0) options.push(cell-1);
      if (col<columns-1 && distance[cell+1]<0) options.push(cell+1);
      if (row>0 && distance[cell-columns]<0) options.push(cell-columns);
      if (row<rows-1 && distance[cell+columns]<0) options.push(cell+columns);
      if (!options.length) { route.pop(); continue; }
      const next=options[Math.floor(random()*options.length)];
      passages.push([cell,next]);
      distance[next]=distance[cell]+1;
      if (col===midCol && next%columns===midCol) centralOpen++;
      route.push(next);
    }
    if (distance[lastCell]>=34 && centralOpen<=4) return passages;
  }

  // Bounded fallback keeps the same guarantees if the search finds no match.
  const snake=Array.from({length:columns*rows},(_,i)=>{
    const row=Math.floor(i/columns), col=i%columns;
    return row*columns+(row%2?columns-1-col:col);
  });
  return snake.slice(1).map((cell,i)=>[snake[i],cell]);
}

function reset(random=Math.random) {
  rollPalette();
  run={time:0,blocks:0};
  world.fill(0);
  box(0,0,0,X,1,Z,1);
  box(0,1,0,1,wallTop,Z,3);
  box(X-1,1,0,X,wallTop,Z,3);
  box(0,1,0,X,wallTop,1,3);
  box(0,1,Z-1,X,wallTop,Z,3);
  box(1,1,1,X-1,wallTop,Z-1,2);
  for (let cell=0; cell<columns*rows; cell++) {
    const {x,z}=cellCenter(cell);
    box(x-room/2,1,z-room/2,x+room/2,wallTop,z+room/2,0);
  }
  const passages=generateMaze(random);
  // a few extra openings turn the perfect maze into loops, so sweeps and flanking routes exist
  for (let k=0;k<Math.round(columns*rows*.08);k++) {
    const cell=Math.floor(random()*columns*rows), right=random()<.5;
    const col=cell%columns, row=Math.floor(cell/columns);
    if (right && col<columns-1) passages.push([cell,cell+1]);
    else if (!right && row<rows-1) passages.push([cell,cell+columns]);
  }
  for (const [from,to] of passages) {
    const a=cellCenter(from), b=cellCenter(to);
    box(Math.min(a.x,b.x)-room/2,1,Math.min(a.z,b.z)-room/2,
      Math.max(a.x,b.x)+room/2,wallTop,Math.max(a.z,b.z)+room/2,0);
  }

  const padX=Math.floor(extraction.x), padZ=Math.floor(extraction.z);
  box(padX-2,0,padZ-2,padX+3,1,padZ+3,4);
  box(intelX,1,intelZ,intelX+1,2,intelZ+1,6);
  Object.assign(player,{...extraction,eye:4.15,yaw:0,pitch:0,hp:100});
  // Starting garrison: spread through the base, never in or beside the insertion room.
  const taken=new Set();
  guards=[];
  for (let tries=0; guards.length<GARRISON && tries<400; tries++) {
    const cell=Math.floor(random()*columns*rows);
    const col=cell%columns, row=Math.floor(cell/columns);
    if (taken.has(cell) || row<2 && Math.abs(col-midCol)<2) continue;
    taken.add(cell);
    const {x,z}=cellCenter(cell);
    guards.push(makeGuard(x,z,cell,random()*6.28));
  }
  alertLevel=0; alertTimer=0; lastKnown=null; reinforced=false; chaseField=null; chaseTimer=0; stepTimer=0;
  charges=10; reserve=144; magazine=24; reload=0; cooldown=0;
  flash=0; hurt=0; phase="ready"; hasIntel=false;
  notice=""; noticeTime=0; particles=[]; bullets=[];
  fallers=[]; pending.clear(); integrityTimer=0; shake=0; noise=null; charge=null; blast=null; stridePhase=0; sway=0;
}

// Grid traversal returns the actual occupied cell hit by a ray.
function trace(x,y,z,dx,dy,dz,limit,out) {
  let ix=Math.floor(x), iy=Math.floor(y), iz=Math.floor(z);
  const sx=dx<0?-1:1, sy=dy<0?-1:1, sz=dz<0?-1:1;
  const ax=dx===0?Infinity:Math.abs(1/dx);
  const ay=dy===0?Infinity:Math.abs(1/dy);
  const az=dz===0?Infinity:Math.abs(1/dz);
  let tx=dx===0?Infinity:(sx>0?ix+1-x:x-ix)*ax;
  let ty=dy===0?Infinity:(sy>0?iy+1-y:y-iy)*ay;
  let tz=dz===0?Infinity:(sz>0?iz+1-z:z-iz)*az;
  let t=0, side=0;
  while (t<=limit && inside(ix,iy,iz)) {
    const material=world[index(ix,iy,iz)];
    if (material && (material!==7 || rubbleTrace(ix,iy,iz,x,y,z,dx,dy,dz,t,side,out))) {
      out.x=ix; out.y=iy; out.z=iz;
      if (material!==7) { out.t=t; out.side=side; }
      return material;
    }
    if (tx<ty && tx<tz) { t=tx; tx+=ax; ix+=sx; side=0; }
    else if (ty<tz) { t=ty; ty+=ay; iy+=sy; side=1; }
    else { t=tz; tz+=az; iz+=sz; side=2; }
  }
  out.t=Infinity;
  return 0;
}

// Rubble cells are drawn as a heap of 4x4x4 sub-voxels instead of a solid cube.
// Collision still uses the whole cell; only what you see (and what bullets hit) is the heap.
function h3(a,b,c) { return (Math.imul(a,73856093)^Math.imul(b,19349663)^Math.imul(c,83492791))>>>0; }
function rubbleOcc(ix,iy,iz,sx,sy,sz) {
  const h=h3(ix*4+sx,iy*4+sy,iz*4+sz);
  const above=tile(ix,iy+1,iz);
  if (above===7 || above===2) return (h%9)!==0;          // buried rubble is packed solid
  let top=3.7-Math.hypot(sx-1.5,sz-1.5)*1.05+((h3(ix*4+sx,0,iz*4+sz)&7)-3.5)*.32;
  if ((sx===3 && tile(ix+1,iy,iz)===7) || (sx===0 && tile(ix-1,iy,iz)===7) ||
      (sz===3 && tile(ix,iy,iz+1)===7) || (sz===0 && tile(ix,iy,iz-1)===7)) top+=1.3;  // heaps merge
  return sy<top && (sy===0 || (h&15)!==0);
}
function rubbleTrace(ix,iy,iz,x,y,z,dx,dy,dz,t,side,out) {
  const px=(x+dx*t-ix)*4, py=(y+dy*t-iy)*4, pz=(z+dz*t-iz)*4;
  let cx=Math.min(3,Math.max(0,Math.floor(px))), cy=Math.min(3,Math.max(0,Math.floor(py))), cz=Math.min(3,Math.max(0,Math.floor(pz)));
  const sx=dx<0?-1:1, sy=dy<0?-1:1, sz=dz<0?-1:1;
  const ax=dx===0?Infinity:Math.abs(.25/dx), ay=dy===0?Infinity:Math.abs(.25/dy), az=dz===0?Infinity:Math.abs(.25/dz);
  let tx=dx===0?Infinity:t+(sx>0?cx+1-px:px-cx)*ax;
  let ty=dy===0?Infinity:t+(sy>0?cy+1-py:py-cy)*ay;
  let tz=dz===0?Infinity:t+(sz>0?cz+1-pz:pz-cz)*az;
  let tc=t;
  for (let n=0;n<12;n++) {
    if (rubbleOcc(ix,iy,iz,cx,cy,cz)) {
      out.t=tc; out.side=side;
      out.tint=.68+(h3(ix*4+cx,iy*4+cy,iz*4+cz)>>>4&15)/15*.5;   // each chunk its own shade
      return true;
    }
    if (tx<ty && tx<tz) { tc=tx; tx+=ax; cx+=sx; side=0; }
    else if (ty<tz) { tc=ty; ty+=ay; cy+=sy; side=1; }
    else { tc=tz; tz+=az; cz+=sz; side=2; }
    if (cx<0||cy<0||cz<0||cx>3||cy>3||cz>3) return false;
  }
  return false;
}

function canStand(x,z,bodyTop,radius=.44) {
  if (x<1+radius || z<1+radius || x>X-1-radius || z>Z-1-radius) return false;
  for (let iy=1; iy<=Math.floor(bodyTop); iy++)
    for (let iz=Math.floor(z-radius); iz<=Math.floor(z+radius); iz++)
      for (let ix=Math.floor(x-radius); ix<=Math.floor(x+radius); ix++)
        if (tile(ix,iy,iz)) return false;
  return true;
}
function move(actor,dx,dz,top) {
  if (canStand(actor.x+dx,actor.z,top)) actor.x+=dx;
  if (canStand(actor.x,actor.z+dz,top)) actor.z+=dz;
}
function say(text) { notice=text; noticeTime=2.5; }
function tone(frequency,duration,volume,type="triangle",end=55,delay=0) {
  if (!audio || audio.state!=="running") return;
  const now=audio.currentTime+delay;
  const oscillator=audio.createOscillator(), gain=audio.createGain();
  oscillator.type=type;
  oscillator.frequency.setValueAtTime(frequency,now);
  oscillator.frequency.exponentialRampToValueAtTime(end,now+duration);
  gain.gain.setValueAtTime(volume,now);
  gain.gain.exponentialRampToValueAtTime(.001,now+duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(now); oscillator.stop(now+duration);
}
function direction() {
  return [Math.sin(player.yaw)*Math.cos(player.pitch),Math.sin(player.pitch),
    Math.cos(player.yaw)*Math.cos(player.pitch)];
}
function reloadRifle() {
  if (!reload && magazine<24 && reserve) {
    reload=1.15;
    tone(180,.13,.045,"square");
  }
}
const hit = {};
function shoot() {
  if (phase!=="playing" || cooldown || reload || charge?.plant > 0) return;
  if (!magazine) { reloadRifle(); return; }
  magazine--; cooldown=.21; flash=.075;
  tone(190,.14,.13,"sawtooth",33);
  makeNoise(player.x,player.z,NOISE.gun,"gun");
  const [dx,dy,dz]=direction();
  const material=trace(player.x,player.eye,player.z,dx,dy,dz,60,hit);
  let closest=hit.t, target;
  for (const guard of guards) {
    if (!guard.hp) continue;
    const gx=guard.x-player.x, gz=guard.z-player.z;
    const t=(gx*dx+gz*dz)/(dx*dx+dz*dz);
    const y=player.eye+t*dy;
    if (t>0 && t<closest && y>1 && y<4.25 && Math.hypot(gx-t*dx,gz-t*dz)<.54) {
      closest=t; target=guard;
    }
  }
  if (target) {
    target.hp--; target.impact=.19;
    say(target.hp ? "HIT" : "HOSTILE DOWN");
    if (target.hp) { target.yaw=Math.atan2(player.x-target.x,player.z-target.z); raiseTo(EVASION,player.x,player.z); }
  } else if (material===2 || material===7) {
    world[index(hit.x,hit.y,hit.z)]=0;
    if (material===2) run.blocks++;
    integrityTimer=integrityTimer||.05;
    const x=player.x+dx*(hit.t-.04), y=player.eye+dy*(hit.t-.04);
    const z=player.z+dz*(hit.t-.04);
    for (let n=0; n<10; n++) {
      particles.push({x,y,z,vx:(Math.random()-.5)*3-dx*2,
        vy:Math.random()*3,vz:(Math.random()-.5)*3-dz*2,life:.18+Math.random()*.24,shade:Math.random()});
    }
  }
}

// Only concrete is excavated. Collision and line of sight read the same grid.
function carve(cx,cy,cz,radius,onRemove=()=>{}) {
  let removed=0;
  for (let y=Math.floor(cy-radius);y<=cy+radius;y++)
    for (let z=Math.floor(cz-radius);z<=cz+radius;z++)
      for (let x=Math.floor(cx-radius);x<=cx+radius;x++) {
        const m=tile(x,y,z);
        if (m!==2 && m!==7) continue;
        if ((x+.5-cx)**2+(y+.5-cy)**2+(z+.5-cz)**2>radius**2) continue;
        world[index(x,y,z)]=0;
        removed++; if (m===2) run.blocks++;
        onRemove(x+.5,y+.5,z+.5);
      }
  if (removed) integrityTimer=integrityTimer||.05;
  return removed;
}
function breach() {
  if (charge) return;
  if (!charges) { say("NO BREACH CHARGES"); return; }
  const [dx,dy,dz]=direction();
  if (trace(player.x,player.eye,player.z,dx,dy,dz,plantRange,hit)!==2) {
    say("MOVE CLOSE AND AIM AT CRACKED CONCRETE"); return;
  }
  const x=player.x+dx*hit.t, y=player.eye+dy*hit.t, z=player.z+dz*hit.t;
  charge={x,y,z,dx,dz,plant:plantTime,fuse:fuseTime};
  tone(145,.09,.055,"square",82);
}

function updateCharge(dt) {
  if (!charge) return;
  if (charge.plant>0) {
    if (Math.hypot(player.x-charge.x,player.z-charge.z)>plantRange+.35) {
      charge=null; say("PLANT CANCELLED"); return;
    }
    charge.plant=Math.max(0,charge.plant-dt);
    if (!charge.plant) {
      charges--;
      tone(840,.1,.09,"square",490);
    }
    return;
  }
  const previous=charge.fuse;
  charge.fuse-=dt;
  if (charge.fuse>0) {
    if (Math.ceil(previous*3)!==Math.ceil(charge.fuse*3)) tone(780,.07,.055,"square",630);
    return;
  }
  const {x,y,z,dx,dz}=charge;
  charge=null;
  const cx=x+dx*1.7, cy=y-.4, cz=z+dz*1.7;
  const removed=carve(cx,cy,cz,3.7,(x,y,z)=>{
    if (Math.random()<.28) particles.push({x,y,z,vx:(Math.random()-.5)*7,
      vy:Math.random()*5,vz:(Math.random()-.5)*7,life:.45+Math.random()*.5,shade:Math.random()});
  });
  blast={x,y,z,life:.42};
  shake=.55;
  // blast damage falls off over 8 voxels; a wall in between halves it
  const bx=cx, by=cy, bz=cz;
  const pd=Math.hypot(player.x-bx,(player.eye-1.4)-by,player.z-bz);
  if (pd<8) {
    let dmg=Math.round(110*(1-pd/8));
    const ddx=player.x-bx, ddy=(player.eye-1.4)-by, ddz=player.z-bz;
    if (trace(bx,by,bz,ddx/pd,ddy/pd,ddz/pd,pd-.3,hit)) dmg=Math.round(dmg*.5);
    if (dmg>0) {
      player.hp=Math.max(0,player.hp-dmg); hurt=.6;
      say("CAUGHT IN THE BLAST  -"+dmg);
      if (!player.hp) { finish(false,"The breach charge got you. Back off after planting."); return; }
    }
  }
  for (const g of guards) {
    if (!g.hp) continue;
    const gd=Math.hypot(g.x-bx,2.5-by,g.z-bz);
    if (gd<6) { g.hp=Math.max(0,g.hp-(gd<4?2:1)); g.impact=.25; }
  }
  makeNoise(bx,bz,NOISE.blast,"blast");
  for (let n=0; n<22; n++) {
    particles.push({x:x-dx*.35,y,z:z-dz*.35,vx:(Math.random()-.5)*3-dx*1.6,
      vy:Math.random()*1.8,vz:(Math.random()-.5)*3-dz*1.6,life:.95+Math.random()*.65,dust:true});
  }

  tone(95,.45,.25,"sawtooth",24);
  say(removed+" CONCRETE CELLS CLEARED");
}

// ===== Scoring =====
// Time is king: a fast extraction is worth far more than anything else.
// Damage taken shaves 1% off the subtotal per HP lost.
const SCORE={extract:5000, timeBase:480, perSecond:100, guard:750, block:5};
function scoreRun(won) {
  const downed=guards.filter(g=>!g.hp).length;
  const damage=100-player.hp;
  const lines=[];
  if (won) {
    lines.push(["Extraction", "", SCORE.extract]);
    lines.push(["Time bonus", fmtTime(run.time), Math.max(0,Math.round((SCORE.timeBase-run.time)*SCORE.perSecond))]);
  } else {
    lines.push(["Extraction", "failed", 0]);
    lines.push(["Time bonus", "no extraction", 0]);
  }
  lines.push(["Soldiers downed", downed+" × "+SCORE.guard, downed*SCORE.guard]);
  lines.push(["Concrete destroyed", run.blocks+" × "+SCORE.block, run.blocks*SCORE.block]);
  const subtotal=lines.reduce((a,l)=>a+l[2],0);
  const penalty=Math.round(subtotal*Math.min(100,damage)/100);
  return {lines,subtotal,damage,penalty,total:Math.max(0,subtotal-penalty),time:run.time,won};
}
function fmtTime(t) { const m=Math.floor(t/60), s=t-m*60; return m+":"+(s<10?"0":"")+s.toFixed(2); }

function finish(won,why) {
  phase=won?"won":"lost"; keys.clear();
  touchFire=false; touchMove.x=touchMove.y=0; touchLayer.hidden=true;
  overlay.hidden=false;
  title.textContent=won?"EXTRACTED":"MISSION FAILED";
  brief.textContent=won?"Intel secured in "+fmtTime(run.time)+".":(why||"You were hit before reaching extraction.");
  deploy.textContent="REDEPLOY";
  if (document.pointerLockElement===screen) document.exitPointerLock();
  showResults(scoreRun(won));
}

// ===== Global leaderboard (shared JSON bin, same setup as the other games) =====
// Entries: [initials, score, seconds, won(1/0)]. Ranked by score.
const LB_URL = "https://json.extendsclass.com/bin/26db85ce0e56";
const LB_SIZE = 10;
let board = [], lbOnline = false, lastResult = null, justAdded = null;
const resultsEl=document.querySelector("#results"), entryEl=document.querySelector("#entry"),
  initialsEl=document.querySelector("#initials"), boardEl=document.querySelector("#board");
function cleanBoard(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(r=>Array.isArray(r) && typeof r[0]==="string" && Number.isFinite(r[1]))
    .map(r=>[r[0].toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,3)||"???",Math.max(0,Math.round(r[1])),+r[2]||0,r[3]?1:0])
    .sort((a,b)=>b[1]-a[1]).slice(0,LB_SIZE);
}
async function lbRequest(opts) {
  const ctl=new AbortController(), t=setTimeout(()=>ctl.abort(),6000);
  try {
    const res=await fetch(LB_URL,{...opts,signal:ctl.signal,cache:"no-store"});
    if (!res.ok) throw new Error(res.status);
    return res;
  } finally { clearTimeout(t); }
}
async function fetchBoard() {
  try { board=cleanBoard(await (await lbRequest({})).json()); lbOnline=true; }
  catch { lbOnline=false; }
}
const qualifies=score=>score>0 && (board.length<LB_SIZE || score>board[board.length-1][1]);
function renderBoard() {
  const rows=[];
  for (let i=0;i<LB_SIZE;i++) {
    const r=board[i];
    const mine=r && justAdded && r[0]===justAdded[0] && r[1]===justAdded[1] && r[2]===justAdded[2];
    rows.push(`<li${mine?' class="mine"':""}><span>${String(i+1).padStart(2," ")}.</span><b>${r?r[0]:"---"}</b>`+
      `<em>${r?(r[3]?fmtTime(r[2]):"KIA"):""}</em><strong>${r?r[1].toLocaleString():""}</strong></li>`);
  }
  boardEl.innerHTML=`<div class="eyebrow">GLOBAL TOP ${LB_SIZE}${lbOnline?"":" · offline, showing last known"}</div><ol>${rows.join("")}</ol>`;
  boardEl.hidden=false;
}
async function showResults(r) {
  lastResult=r; justAdded=null;
  const row=(a,b,c,cls="")=>`<tr class="${cls}"><td>${a}</td><td>${b}</td><td>${c}</td></tr>`;
  resultsEl.innerHTML=`<table>`+
    r.lines.map(l=>row(l[0],l[1],l[2].toLocaleString())).join("")+
    row("Subtotal","",r.subtotal.toLocaleString(),"sub")+
    row("Damage taken",r.damage+" HP → −"+Math.min(100,r.damage)+"%",(r.penalty?"−":"")+r.penalty.toLocaleString(),r.penalty?"pen":"")+
    row("FINAL SCORE","",r.total.toLocaleString(),"total")+`</table>`;
  resultsEl.hidden=false; entryEl.hidden=true; overlay.querySelector("article").classList.add("scored");
  boardEl.hidden=false; boardEl.innerHTML=`<div class="eyebrow">GLOBAL TOP ${LB_SIZE} · loading…</div>`;
  await fetchBoard();
  if (lastResult!==r) return;
  renderBoard();
  if (qualifies(r.total)) {
    entryEl.hidden=false; initialsEl.value=""; 
    if (!touchDevice) initialsEl.focus();
  }
}
async function submitInitials() {
  const r=lastResult; if (!r || entryEl.hidden) return;
  const name=initialsEl.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,3);
  if (!name) { initialsEl.focus(); return; }
  entryEl.hidden=true;
  const entry=[name,r.total,Math.round(r.time*100)/100,r.won?1:0];
  await fetchBoard();                       // merge with the freshest list right before writing
  board=cleanBoard(board.concat([entry])); justAdded=entry;
  if (lbOnline) {
    try { await lbRequest({method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(board)}); }
    catch { lbOnline=false; }
  }
  renderBoard();
}
document.querySelector("#entry-save").addEventListener("click",submitInitials);
initialsEl.addEventListener("keydown",e=>{ e.stopPropagation(); if (e.key==="Enter") submitInitials(); });
initialsEl.addEventListener("input",()=>{ initialsEl.value=initialsEl.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,3); });

function update(dt,clock) {
  run.time+=dt;
  cooldown=Math.max(0,cooldown-dt); flash=Math.max(0,flash-dt);
  hurt=Math.max(0,hurt-dt);
  noticeTime=Math.max(0,noticeTime-dt);
  if (reload) {
    reload=Math.max(0,reload-dt);
    if (!reload) {
      const rounds=Math.min(24-magazine,reserve);
      magazine+=rounds; reserve-=rounds;
    }
  }
  if (blast) {
    blast.life-=dt;
    if (blast.life<=0) blast=null;
  }
  if (touchFire) shoot();
  const crouched=keys.has("KeyC") || touchCrouch || !canStand(player.x,player.z,4.4);
  const eyeTarget=crouched?2.65:4.15;
  player.eye=crouched?eyeTarget:player.eye+(eyeTarget-player.eye)*Math.min(1,dt*18);
  const forward=Number(keys.has("KeyW"))-Number(keys.has("KeyS"))-touchMove.y;
  const strafe=Number(keys.has("KeyD"))-Number(keys.has("KeyA"))+touchMove.x;
  const speed=(crouched?3:6)*dt/Math.max(1,Math.hypot(forward,strafe));   // analog stick: partial tilt = slower
  const sin=Math.sin(player.yaw), cos=Math.cos(player.yaw);
  const oldX=player.x, oldZ=player.z;
  const mx=(sin*forward+cos*strafe)*speed, mz=(cos*forward-sin*strafe)*speed;
  if (mx||mz) kickRubble(player.x+mx/speed*.55*Math.sign(speed),player.z+mz/speed*.55*Math.sign(speed));
  move(player,mx,mz,crouched?2.9:4.4);

  const travel=Math.hypot(player.x-oldX,player.z-oldZ);
  stridePhase+=travel*2.8;
  sway+=(Math.min(1,travel/(dt*5||1))-sway)*Math.min(1,dt*12);
  updateCharge(dt);
  updateAlert(dt,travel,crouched);
  for (const guard of guards) {
    if (!guard.hp) { guard.fall=Math.min(1,guard.fall+dt*3.4); continue; }
    guard.impact=Math.max(0,guard.impact-dt);
    const oldX=guard.x, oldZ=guard.z;
    const dx=player.x-guard.x,dz=player.z-guard.z,dist=Math.hypot(dx,dz);
    const heading=Math.atan2(dx,dz);
    const sees=canSee(guard,dx,dz,dist,crouched);
    guard.spot=Math.max(0,guard.spot-dt);
    guard.query=Math.max(0,guard.query-dt);
    if (sees) {
      if (!guard.saw) {
        // spotted: "!" over the head, two-note sting, and a beat before the first shot
        guard.spot=1.1;
        guard.shot=Math.max(guard.shot,.45);
        const v=Math.max(.02,.07-dist*.0018);
        tone(620,.08,v,"square",620); tone(930,.13,v,"square",930,.09);
      }
      spottedBy(guard);
    }
    guard.saw=sees;
    thinkGuard(guard,dt,sees,heading,dist);
    const stepDistance=Math.hypot(guard.x-oldX,guard.z-oldZ);
    guard.gait+=stepDistance*7;
    guard.pace+=(Math.min(1,stepDistance/(dt||1))-guard.pace)*Math.min(1,dt*12);
    guard.muzzle=Math.max(0,(guard.muzzle||0)-dt);
    guard.shot=Math.max(0,guard.shot-dt);
    if (guard.aim>0) {
      guard.yaw=heading;
      guard.aim=Math.max(0,guard.aim-dt);
      if (!guard.aim) {
        guard.shot=1.2+Math.random()*.55;
        if (sees) fireBullet(guard,dist,crouched);
      }
    } else if (sees && !guard.shot) {
      guard.aim=windup;   // raise rifle, sight glints, then fire
      const v=Math.max(.015,.05-dist*.0015);
      tone(1500,.025,v,"square",1300); tone(980,.04,v,"square",760,.11);
    }
  }

  if (!hasIntel && Math.hypot(player.x-intel.x,player.z-intel.z)<1.9) {
    hasIntel=true;
    say("INTEL SECURED. RETURN TO THE GREEN PAD.");
    tone(500,.24,.1,"triangle",780);
  }
  if (hasIntel && Math.hypot(player.x-extraction.x,player.z-extraction.z)<2.6) finish(true);
  for (const p of particles) {
    p.x+=p.vx*dt; p.y+=p.vy*dt; p.z+=p.vz*dt; p.vy-=(p.dust?.25:12)*dt; p.life-=dt;
  }
  particles=particles.filter(p=>p.life>0 && p.y>1);
  for (const b of bullets) {
    const steps=3;
    for (let k=0;k<steps && b.life>0;k++) {
      b.x+=b.vx*dt/steps; b.y+=b.vy*dt/steps; b.z+=b.vz*dt/steps;
      if (Math.hypot(b.x-player.x,b.z-player.z)<.55 && b.y>1 && b.y<player.eye+.35) {
        b.life=0;
        player.hp=Math.max(0,player.hp-12); hurt=.26;
        tone(220,.12,.06,"sawtooth",90);
        if (!player.hp) { finish(false); return; }
      } else if (tile(Math.floor(b.x),Math.floor(b.y),Math.floor(b.z))) {
        b.life=0;
        for (let n=0;n<6;n++) particles.push({x:b.x-b.vx*.01,y:b.y,z:b.z-b.vz*.01,
          vx:(Math.random()-.5)*4-b.vx*.08,vy:Math.random()*3,vz:(Math.random()-.5)*4-b.vz*.08,
          life:.12+Math.random()*.18,shade:Math.random(),spark:true});
      }
    }
    b.life-=dt;
  }
  bullets=bullets.filter(b=>b.life>0);
  updateStructure(dt);
}

// ===== Structural integrity =====
// Concrete (2) and rubble (7) are "dynamic". Floor (1), outer walls (3) and crates (6) are anchors.
// Support distance: resting on an anchor = 0; resting on a dynamic voxel inherits its distance;
// each step sideways (or hanging from above) costs 1. Anything farther than SPAN from support
// is overstressed and collapses after a short creak. Recomputed only when the grid changes.
const isDyn=m=>m===2||m===7, isAnchor=m=>m===1||m===3||m===6;
let support=null;
function checkIntegrity() {
  if (!support) support=new Int16Array(X*Y*Z);
  support.fill(32767);
  const layer=X*Z;
  let frontier=[];
  for (let y=1;y<Y;y++) for (let z=0;z<Z;z++) for (let x=0;x<X;x++) {
    const i=index(x,y,z);
    if (isDyn(world[i]) && isAnchor(world[i-layer])) { support[i]=0; frontier.push(i); }
  }
  for (let d=0; d<=SPAN && frontier.length; d++) {
    const next=[], stack=frontier;
    while (stack.length) {
      const i=stack.pop();
      if (support[i]!==d) continue;
      const x=i%X, z=Math.floor(i/X)%Z, y=Math.floor(i/layer);
      const up=i+layer;
      if (y+1<Y && isDyn(world[up]) && support[up]>d) { support[up]=d; stack.push(up); }
      const side=[x>0?i-1:-1, x<X-1?i+1:-1, z>0?i-X:-1, z<Z-1?i+X:-1, y>1?i-layer:-1];
      for (const n of side) if (n>=0 && isDyn(world[n]) && support[n]>d+1) { support[n]=d+1; next.push(n); }
    }
    frontier=next;
  }
  let fresh=0;
  for (let i=0;i<world.length;i++) {
    if (isDyn(world[i]) && support[i]>SPAN && !pending.has(i)) {
      // higher, farther-from-support voxels let go slightly later -> visible progressive failure
      pending.set(i,.08+Math.random()*.32+Math.floor(i/layer)*.015); fresh++;
    }
  }
  if (fresh && rumbleCD<=0) { tone(70,.6,.09,"sawtooth",38); tone(140,.25,.03,"square",60,.1); rumbleCD=.5; shake=Math.max(shake,.18); }
}

function updateStructure(dt) {
  rumbleCD-=dt; thudCD-=dt; crushCD-=dt;
  shake=Math.max(0,shake-dt);
  if (integrityTimer>0) { integrityTimer-=dt; if (integrityTimer<=0) { integrityTimer=0; checkIntegrity(); } }
  let dropped=0;
  for (const [i,t] of pending) {
    if (t-dt>0) { pending.set(i,t-dt); continue; }
    pending.delete(i);
    if (!isDyn(world[i])) continue;
    const m=world[i]; world[i]=0; dropped++;
    if (m===2) run.blocks++;
    const x=i%X, z=Math.floor(i/X)%Z, y=Math.floor(i/(X*Z));
    fallers.push({x:x+.5,y:y+.5,z:z+.5,vx:(Math.random()-.5)*.6,vy:-Math.random()*.5,vz:(Math.random()-.5)*.6,m,tint:.8+Math.random()*.35,spin:(Math.random()-.5)*8});
  }
  if (dropped) integrityTimer=integrityTimer||.06;   // removal may stress the next row -> chain reaction
  for (const f of fallers) {
    f.vy-=24*dt; f.y+=f.vy*dt; f.x+=f.vx*dt; f.z+=f.vz*dt;
    // debris landing on you or a guard
    if (f.vy<-3 && f.y>1 && f.y<player.eye+.4 && Math.abs(f.x-player.x)<.75 && Math.abs(f.z-player.z)<.75) {
      f.dead=true; burst(f.x,f.y,f.z,5);
      if (crushCD<=0) {
        player.hp=Math.max(0,player.hp-8); hurt=.3; crushCD=.25; say("FALLING DEBRIS");
        if (!player.hp) { finish(false,"Crushed under falling concrete."); return; }
      }
      continue;
    }
    for (const g of guards) if (g.hp && f.vy<-3 && f.y<4.3 && Math.abs(f.x-g.x)<.7 && Math.abs(f.z-g.z)<.7) {
      f.dead=true; g.hp--; g.impact=.2; burst(f.x,f.y,f.z,5); break;
    }
    if (f.dead) continue;
    const fx=Math.floor(f.x), fz=Math.floor(f.z), below=Math.floor(f.y-.5);
    if (tile(fx,below,fz) || f.y<1.5) {
      f.dead=true;
      const cell=below+1;
      const clear=Math.hypot(f.x-player.x,f.z-player.z)>1.1 && guards.every(g=>!g.hp || Math.hypot(f.x-g.x,f.z-g.z)>1);
      if (Math.random()<.45 && clear && !tile(fx,cell,fz) && cell<Y) { world[index(fx,cell,fz)]=7; integrityTimer=integrityTimer||.06; }
      burst(fx+.5,cell,fz+.5,3);
      if (thudCD<=0) { tone(90+Math.random()*40,.12,.06,"triangle",40); thudCD=.07; }
    }
  }
  if (fallers.some(f=>f.dead)) fallers=fallers.filter(f=>!f.dead);
}
function burst(x,y,z,n) {
  for (let k=0;k<n;k++) particles.push({x,y,z,vx:(Math.random()-.5)*4,vy:Math.random()*3,vz:(Math.random()-.5)*4,life:.25+Math.random()*.3,shade:Math.random()});
  particles.push({x,y:y+.3,z,vx:0,vy:.4,vz:0,life:.9,dust:true});
}
// walking into knee-high loose rubble shoves it aside instead of blocking you
function kickRubble(x,z) {
  let k=0;
  for (let iz=Math.floor(z-.45);iz<=Math.floor(z+.45);iz++)
    for (let ix=Math.floor(x-.45);ix<=Math.floor(x+.45);ix++)
      for (let iy=1;iy<=2;iy++) if (tile(ix,iy,iz)===7) { world[index(ix,iy,iz)]=0; k++; burst(ix+.5,iy+.5,iz+.5,2); }
  if (k) integrityTimer=integrityTimer||.05;
}

// ===== Pathing: breadth-first "flow fields" over the floor grid =====
// A field stores walking distance (in voxels) from a target to every reachable cell, so any number
// of guards can follow it downhill to the target. One BFS over the whole base is ~4k cells.
function walkable(x,z) { return x>0 && z>0 && x<X-1 && z<Z-1 && !tile(x,1,z) && !tile(x,2,z) && !tile(x,3,z) && !tile(x,4,z); }
function flowField(x,z,radius=9999) {
  const field=new Int16Array(X*Z).fill(-1);
  const sx=Math.floor(x), sz=Math.floor(z);
  const queue=[];
  // the target cell itself might be solid (a blast inside a wall); seed from the nearest open cells
  for (let r=0;r<4 && !queue.length;r++)
    for (let dz=-r;dz<=r;dz++) for (let dx=-r;dx<=r;dx++)
      if (walkable(sx+dx,sz+dz) && field[(sz+dz)*X+sx+dx]<0) { field[(sz+dz)*X+sx+dx]=0; queue.push((sz+dz)*X+sx+dx); }
  for (let q=0;q<queue.length;q++) {
    const c=queue[q], cx=c%X, cz=(c/X)|0, d=field[c];
    if (d>=radius) continue;
    for (const [nx,nz] of [[cx+1,cz],[cx-1,cz],[cx,cz+1],[cx,cz-1]])
      if (walkable(nx,nz) && field[nz*X+nx]<0) { field[nz*X+nx]=d+1; queue.push(nz*X+nx); }
  }
  return field;
}
const fieldAt=(f,x,z)=>f[Math.floor(z)*X+Math.floor(x)];
// Walk one step down a field. Returns true once the guard has arrived (or can't reach it).
function followField(g,f,speed,dt,arrive=2) {
  const cx=Math.floor(g.x), cz=Math.floor(g.z), here=f[cz*X+cx];
  if (here<0 || here<=arrive) return true;
  let best=null, bd=here;
  for (const [nx,nz] of [[cx+1,cz],[cx-1,cz],[cx,cz+1],[cx,cz-1]]) {
    const d=f[nz*X+nx];
    if (d>=0 && d<bd) { bd=d; best=[nx+.5,nz+.5]; }
  }
  if (!best) return true;
  const tx=best[0]-g.x, tz=best[1]-g.z, tl=Math.hypot(tx,tz)||1;
  const want=Math.atan2(tx,tz);
  g.yaw+=Math.atan2(Math.sin(want-g.yaw),Math.cos(want-g.yaw))*Math.min(1,dt*8);
  move(g,tx/tl*dt*speed,tz/tl*dt*speed,4.3);
  return false;
}

// ===== Alert phases (tactical espionage style) =====
// 0 UNDETECTED: lazy patrols.  1 CAUTION: a gunshot/blast was heard; listeners converge on it.
// 2 EVASION: they know you're here but not where; they split up and sweep the base, ears open.
// 3 ALERT: you've been seen; everyone closes on you and reinforcements arrive at the edges.
const UNDETECTED=0, CAUTION=1, EVASION=2, ALERT=3;
const PHASE=[
  {name:"UNDETECTED", speed:1.15, range:15, fov:.55, hear:4, time:0},
  {name:"CAUTION",    speed:1.9,  range:19, fov:.35, hear:6, time:25},
  {name:"EVASION",    speed:2.6,  range:23, fov:.15, hear:10, time:30},
  {name:"ALERT",      speed:3.1,  range:26, fov:-.3, hear:14, time:12},
];
const NOISE={gun:24, blast:46};
const GARRISON=9, REINFORCEMENTS=5, MAX_GUARDS=20;
let alertLevel=0, alertTimer=0, lastKnown=null, reinforced=false, chaseField=null, chaseTimer=0, stepTimer=0;
const alertEl=document.querySelector("#alertbar");

function makeGuard(x,z,cell,yaw) {
  return {x,z,cell,yaw,hp:2,gait:0,pace:0,impact:0,fall:0,shot:1.5,aim:0,spot:0,muzzle:0,query:0,saw:false,
    task:"idle",wait:1+Math.random()*3,goal:null,field:null};
}
function canSee(g,dx,dz,dist,crouched) {
  const P=PHASE[alertLevel];
  const range=P.range*(crouched && alertLevel<ALERT?.62:1);
  if (dist>range || dist<.01) return false;
  const facing=Math.cos(Math.atan2(dx,dz)-g.yaw);
  if (facing<P.fov && dist>2.2) return false;
  return !trace(g.x,3.75,g.z,dx/dist,(player.eye-3.75)/dist,dz/dist,dist-.12,hit);
}
function setPhase(level) {
  if (level===alertLevel) { alertTimer=PHASE[level].time; return; }
  const rising=level>alertLevel;
  alertLevel=level; alertTimer=PHASE[level].time;
  for (const g of guards) if (g.hp) { g.task="idle"; g.wait=rising?0:.5+Math.random(); g.goal=null; }
  if (level===ALERT) {
    say("!! ALERT !!  REINFORCEMENTS INBOUND");
    for (let k=0;k<3;k++) { tone(880,.16,.06,"square",880,k*.36); tone(660,.16,.06,"square",660,k*.36+.18); }
    if (!reinforced) { reinforced=true; spawnReinforcements(); }
  } else if (level===EVASION) say(rising?"EVASION · THEY KNOW YOU'RE HERE":"EVASION · THEY LOST YOU");
  else if (level===CAUTION) say(rising?"CAUTION · SOMETHING WAS HEARD":"CAUTION · STAND DOWN SOON");
  else { say("UNDETECTED"); reinforced=false; }
}
function raiseTo(level,x,z) {
  if (x!==undefined) lastKnown={x,z};
  if (level>=alertLevel) setPhase(level);
}
function spottedBy(g) {
  lastKnown={x:player.x,z:player.z};
  if (alertLevel<ALERT) setPhase(ALERT); else alertTimer=PHASE[ALERT].time;
}
// Reinforcements enter from rooms on the outer ring that the player can't see and isn't near.
function spawnReinforcements() {
  const living=guards.filter(g=>g.hp).length;
  let count=Math.min(REINFORCEMENTS,MAX_GUARDS-living);
  const pf=flowField(player.x,player.z);
  const ring=[];
  for (let cell=0;cell<columns*rows;cell++) {
    const col=cell%columns, row=Math.floor(cell/columns);
    if (col!==0 && col!==columns-1 && row!==0 && row!==rows-1) continue;
    const c=cellCenter(cell), d=fieldAt(pf,c.x,c.z);
    const dx=c.x-player.x, dz=c.z-player.z, dl=Math.hypot(dx,dz);
    const visible=!trace(player.x,player.eye,player.z,dx/dl,(3-player.eye)/dl,dz/dl,dl-.3,hit);
    if (d<0 || visible) continue;
    ring.push({cell,c,d});
  }
  ring.sort((a,b)=>b.d-a.d);                 // farthest-walk rooms first, then shuffle the top picks
  const pool=ring.filter(r=>r.d>=28); const picks=(pool.length>=count?pool:ring).slice(0,count*2);
  for (let i=picks.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [picks[i],picks[j]]=[picks[j],picks[i]]; }
  for (const r of picks.slice(0,count)) {
    const g=makeGuard(r.c.x+(Math.random()-.5),r.c.z+(Math.random()-.5),r.cell,0);
    g.wait=0; g.shot=2; guards.push(g);
  }
}
// Noise: a gunshot or blast pulls listeners in; footsteps only matter to guards close by.
function makeNoise(x,z,radius,kind) {
  const f=flowField(x,z,radius);
  const listeners=guards.filter(g=>g.hp && fieldAt(f,g.x,g.z)>=0);
  if (!listeners.length) return;
  // escalate first (a phase change re-tasks everyone), then send the listeners to the sound
  if (kind==="step") {
    if (alertLevel===EVASION) { lastKnown={x,z}; alertTimer=PHASE[EVASION].time; }
  } else {
    tone(440,.09,.03,"square",520,.25);
    if (alertLevel===ALERT) lastKnown={x,z};
    else raiseTo(alertLevel===EVASION?EVASION:CAUTION,x,z);
  }
  if (alertLevel<ALERT) for (const g of listeners) {
    g.task="investigate"; g.field=f; g.goal={x,z}; g.wait=0;
    if (!g.saw) g.query=1.4;
  }
}
function updateAlert(dt,travel,crouched) {
  // footsteps: running is loud, crouch-walking is silent
  stepTimer-=dt;
  if (travel>dt*2 && !crouched && stepTimer<=0) {
    stepTimer=.45;
    const r=PHASE[alertLevel].hear;
    if (guards.some(g=>g.hp && Math.abs(g.x-player.x)<r+2 && Math.abs(g.z-player.z)<r+2)) makeNoise(player.x,player.z,r,"step");
  }
  if (alertLevel===ALERT) {
    chaseTimer-=dt;
    if (chaseTimer<=0 && lastKnown) { chaseTimer=.5; chaseField=flowField(lastKnown.x,lastKnown.z); }
  }
  if (alertLevel>UNDETECTED) {
    const seen=guards.some(g=>g.hp && g.saw);
    if (!(alertLevel===ALERT && seen)) alertTimer-=dt;
    if (alertTimer<=0) setPhase(alertLevel-1);
  }
  // HUD readout
  if (alertLevel===UNDETECTED) alertEl.hidden=true;
  else {
    alertEl.hidden=false;
    alertEl.dataset.level=alertLevel;
    alertEl.querySelector("b").textContent=PHASE[alertLevel].name;
    alertEl.querySelector("span").textContent=alertTimer.toFixed(1);
    alertEl.querySelector("i").style.width=Math.max(0,alertTimer/PHASE[alertLevel].time*100)+"%";
  }
}
// pick a room for a patrol (near home) or a sweep (spread out, biased toward the last known spot)
function pickRoom(g,mode) {
  if (mode==="patrol") {
    const col=g.cell%columns, row=Math.floor(g.cell/columns);
    const c=Math.max(0,Math.min(columns-1,col+Math.floor(Math.random()*5)-2));
    const r=Math.max(0,Math.min(rows-1,row+Math.floor(Math.random()*5)-2));
    return cellCenter(r*columns+c);
  }
  const claimed=guards.filter(o=>o!==g && o.goal).map(o=>o.goal);
  let best=null, bestScore=-1e9;
  for (let k=0;k<12;k++) {
    const c=cellCenter(Math.floor(Math.random()*columns*rows));
    const near=lastKnown?Math.hypot(c.x-lastKnown.x,c.z-lastKnown.z):0;
    const spread=claimed.reduce((m,o)=>Math.min(m,Math.hypot(c.x-o.x,c.z-o.z)),99);
    const score=Math.min(spread,24)*1.2-near*.6+Math.random()*6;
    if (score>bestScore) { bestScore=score; best=c; }
  }
  return best;
}
function thinkGuard(g,dt,sees,heading,dist) {
  const P=PHASE[alertLevel];
  if (alertLevel===ALERT) {
    if (sees) { g.yaw=heading; if (dist>9) move(g,Math.sin(heading)*dt*P.speed*.6,Math.cos(heading)*dt*P.speed*.6,4.3); return; }
    if (chaseField && !followField(g,chaseField,P.speed,dt,1)) return;
    g.yaw+=dt*2.2;   // reached the last known spot: scan
    return;
  }
  if (g.task==="investigate" && g.field) {
    if (!followField(g,g.field,P.speed+.6,dt)) return;
    g.task="search"; g.wait=alertLevel===EVASION?2:4+Math.random()*2; g.field=null;
  }
  if (g.task==="walk" && g.field) {
    if (!followField(g,g.field,P.speed,dt)) return;
    g.task="search"; g.wait=alertLevel===EVASION?1.5+Math.random():2+Math.random()*3; g.field=null;
  }
  // idle / searching: look around, then pick the next room
  g.wait-=dt;
  g.yaw+=dt*(alertLevel===UNDETECTED?.5:1.6)*Math.sin(g.wait*1.7+g.x);
  if (g.wait>0) return;
  const target=pickRoom(g,alertLevel===EVASION?"sweep":"patrol");
  const f=flowField(target.x,target.z);
  if (fieldAt(f,g.x,g.z)<0) { g.wait=1; return; }
  g.goal=target; g.field=f; g.task="walk";
}

function fireBullet(guard,dist,crouched) {
  guard.muzzle=.12;
  tone(118,.09,.045,"square",38);
  const sx=guard.x+Math.sin(guard.yaw)*.7, sz=guard.z+Math.cos(guard.yaw)*.7, sy=3.25;
  let tx=player.x, tz=player.z, ty=player.eye-.7;
  // same odds as before if you stand still; moving sideways can now dodge the round
  if (Math.random()>(crouched?.37:.64)) {
    const side=Math.random()<.5?-1:1, off=.9+Math.random()*.7;
    tx+=Math.cos(guard.yaw)*off*side; tz-=Math.sin(guard.yaw)*off*side; ty+=(Math.random()-.3)*.8;
  }
  const dx=tx-sx, dy=ty-sy, dz=tz-sz, d=Math.hypot(dx,dy,dz)||1;
  bullets.push({x:sx,y:sy,z:sz,vx:dx/d*bulletSpeed,vy:dy/d*bulletSpeed,vz:dz/d*bulletSpeed,life:3});
}

const depth = new Float32Array(width*height);
const ray = {};
const focal = height*145/126;   // tied to height so wide screens see more, not zoom in
const faceLight = [.72,1,.87];
const dustColor=[156,130,101], rubbleColor=[190,152,104];
const groundFog=[54,69,71];
let textures;
const textureSize = 64;

// Generate repeating material maps once. Coordinates are tied to world faces.
function buildTextures() { return colors.map((base,id)=>{
  const data = new Uint8Array(textureSize*textureSize*3);
  for (let y=0; y<64; y++) {
    for (let x=0; x<64; x++) {
      const grit=((Math.imul(x+17,73856093)^Math.imul(y+41,19349663))>>>3)&31;
      const seam=x===0 || y===0;
      const mottling=((Math.imul((x>>3)+19,362827313)^Math.imul((y>>3)+47,1376312589))>>>11)&15;
      let tint=base, shade=(grit-15)*.65+mottling-7;
      if (id===2) {
        // A stepped fracture with a branching hairline and chipped lip.
        const fracture=34-y*.2+[0,4,1,6,3,-2,0,4][y>>3];
        const crack=x-fracture;
        const branch=y>24 && y<52 && Math.abs(x-(fracture+(y-24)*.68))<1;
        if (Math.abs(crack)<1.6 || branch) shade-=76;
        else if (crack>=1.6 && crack<3) shade+=27;
        if (y>54 && y<63) {
          tint=((x+y)>>3)&1?palette.stripe:palette.stripeDark;
          shade*=.65;
        }
        if (x<2 || y<2) shade-=24;
        if (x===2 || y===2) shade+=13;
        if (grit<4) shade-=14;
      } else if (id===3) {
        if (x<3 || y<3) shade-=24;
        if (x===3 || y===3) shade+=20;
        if ((x<9 || x>55) && (y<9 || y>55) && (x+y)%5<2) shade+=23;
      } else if (id===7) {
        // crushed concrete grain; the chunk shapes come from the sub-voxel heap
        shade=(grit-15)*1.1+mottling*.6-6;
        if (grit<5) shade-=26;
        if (((x*7+y*13)&31)===0) tint=base.map(c=>c*1.25);
      } else if (id===6) {
        // Steel-banded supply crate, one panel per voxel face.
        const lx=x&15, ly=y&15;
        tint=[72,80,62];
        shade=(grit-15)*.35+((ly>>1)%2?-4:3);
        if (lx<2 || lx>13 || ly<2 || ly>13) { tint=[118,122,104]; shade+=lx===0||ly===0?-30:8; }
        else if (Math.abs(lx-ly)<1.2 || Math.abs(lx-(15-ly))<1.2) shade+=14;
        if (ly>5 && ly<9 && lx>4 && lx<11) tint=[214,170,72];
      } else if (id===1) {
        if (seam) shade-=19;
        if (grit<3) shade-=15;
      } else if (id===4) {
        tint=x<5 || x>58 || y<5 || y>58?[111,217,151]:[36,114,83];
        if ((x+y)%12<2) shade+=13;
      } else if (id===5) {
        if (x<5 || y<5 || x>58 || y>58) shade-=48;
        if (y>17 && y<25 && (x<13 || x>50)) tint=[56,58,46];
      }
      const offset=(y*64+x)*3;
      for (let c=0;c<3;c++) data[offset+c]=Math.min(255,Math.max(0,tint[c]+shade));
    }
  }
  return data;
}); }

function guardView(guard) {
  const bearing=Math.atan2(player.x-guard.x,player.z-guard.z);
  const angle=guard.yaw-bearing;
  const facing=Math.cos(angle);
  if (facing>.72) return "front";
  if (facing<-.72) return "back";
  return Math.sin(angle)>0?"left":"right";
}

// ---------- Guard sprite: helmet, goggles, plate carrier, rifle, knee pads ----------
const G={helmet:[84,94,68],helmetHi:[118,128,92],strap:[38,40,34],skin:[190,140,100],skinDk:[150,104,72],
  mask:[50,54,48],lens:[28,58,66],lensHi:[150,215,220],shirt:[98,106,78],shirtDk:[76,83,60],vest:[64,72,54],
  pouch:[78,86,64],pouchDk:[44,50,38],belt:[42,40,34],buckle:[150,146,120],pants:[86,92,68],pantsDk:[66,72,52],
  pad:[44,48,40],boot:[34,32,28],gun:[30,33,32],gunHi:[70,76,74],flash:[255,224,130]};
function ellipse(u,v,cu,cv,ru,rv){return ((u-cu)/ru)**2+((v-cv)/rv)**2<1;}
function guardPixel(view,u,v,firing,step,aim=0) {
  if (u<0 || u>1 || v<0 || v>1) return;
  const side=view==="left" || view==="right";
  const h=view==="left"?1-u:u;   // in side view h grows toward where the guard faces
  const c=Math.abs(u-.5);
  // legs (with stride)
  if (v>.56) {
    const swing=step*(v-.56)*.55;
    const legs=side?[.47-swing,.5+swing]:[.4+swing*.3,.6-swing*.3];
    for (let k=0;k<2;k++) {
      const d=Math.abs(h-legs[k]);
      if (d<(v>.9?.085:.072)) {
        if (v>.91) return v>.975?[20,19,17]:G.boot;
        if (v>.71 && v<.77) return G.pad;
        const dk=side?k===0:k===1;
        return d>.05?G.pantsDk:dk?G.pantsDk:G.pants;
      }
    }
    if (v<.6 && (side?Math.abs(h-.48)<.12:c<.17)) return G.pants;
    return;
  }
  if (side) {
    // rifle held forward
    const rv=aim>0?.31:.405+(h-.55)*.04;
    if (h>.42 && h<.97 && Math.abs(v-rv)<.022) {
      return v<rv-.01?G.gunHi:G.gun;
    }
    if (h>.5 && h<.6 && v>rv && v<rv+.08) return G.gun; // magazine
    // arm
    if (aim>0 ? (h>.47 && h<.66 && v>.24 && v<.34) : (h>.47 && h<.64 && v>.24 && v<.43 && (v-.24)*.9>(h-.5)*.6-.02)) return h<.52?G.shirtDk:G.shirt;
    if (v<.1 && ellipse(h,v,.53,.075,.12,.072)) return v<.04?G.helmetHi:G.helmet;
    if (v>=.095 && v<.108 && h>.42 && h<.67) return G.strap;
    if (v>=.108 && v<.205 && h>.44 && h<.63+(v>.14 && v<.165?.02:0)) {   // profile with nose
      if (h<.49) return G.skinDk;
      if (h>.54 && h<.57 && v<.142 && v>.118) return v<.125?[58,42,30]:(aim>0||firing?[150,20,16]:[26,24,22]);
      if (h>.58 && v>.176 && v<.184) return [104,52,44];
      return h>.6?[206,156,116]:G.skin;
    }
    if (v>.2 && v<.56) {
      if (h>.3 && h<.4 && v>.23 && v<.48) return h<.33?G.pouchDk:G.pouch; // pack
      if (h>.38 && h<.62) {
        if (v>.52) return v<.535?G.buckle:G.belt;
        if (h>.55 && v>.33 && v<.45) return G.pouchDk;
        return h<.44?G.vest:G.pouch;
      }
    }
    return;
  }
  // front / back
  if (v<.1 && ellipse(u,v,.5,.075,.14,.07)) {
    if (view==="front" && v>.045 && v<.075 && c<.1) // goggles pushed up on the helmet
      return c<.012?G.strap:c<.085?(v<.053 && c>.03 && c<.05?G.lensHi:G.lens):G.strap;
    if (v<.035 && c<.08) return G.helmetHi;
    return G.helmet;
  }
  if (v>=.095 && v<.108 && c<.13) return G.strap;  // brim
  const jaw=.088-Math.max(0,v-.17)*1.4;
  if (v>=.108 && v<.205 && c<jaw) {
    if (view==="back") return v<.13?G.strap:G.skinDk;
    if (c>jaw-.012) return v<.16?G.strap:G.skinDk;        // chin strap / cheek shadow
    const angry=aim>0 || firing;
    if (v>.118 && v<.128 && c>.016 && c<.068 && (!angry || v-.118>(.068-c)*.18)) return [58,42,30]; // brows
    if (v>.13 && v<.146 && c>.022 && c<.064) {                // eyes
      if (c>.036 && c<.05) return angry?[150,20,16]:[26,24,22];
      return [232,226,212];
    }
    if (v>.14 && v<.168 && c<.011) return v>.16?G.skinDk:[206,156,116]; // nose
    if (v>.176 && v<.184 && c<.032) return [104,52,44];       // mouth
    if (v>.186 && c<.05) return [172,124,88];                 // chin
    return c>.06?G.skinDk:G.skin;
  }
  if (v>.195 && v<.22 && c<.06) return G.mask;
  // shoulders + torso
  const shoulder=v<.26?.27-(.26-v)*1.6:.27;
  if (v>.2 && v<.56 && c<shoulder) {
    const arm=c>.19;
    if (view==="front" && aim>0) {
      const du=u-.6, dvv=v-.3;
      if (du*du/.0036+dvv*dvv/.0025<1) return du*du/.0009+dvv*dvv/.0006<1?[8,8,8]:G.gun; // muzzle at you
      if (u>.55 && u<.72 && v>.27 && v<.36) return G.gun;
      if (arm) return v<.36?(u<.5?G.shirt:G.shirtDk):(u<.5?G.shirt:G.shirtDk);
      if (u>.36 && u<.56 && v>.28 && v<.34) return G.skinDk;   // support hand
    }
    if (view==="front") {
      // rifle across chest
      const rv=.42+(u-.5)*.12;
      if (!aim && u>.16 && u<.86 && Math.abs(v-rv)<.022) {
        return v<rv-.01?G.gunHi:G.gun;
      }
      if (arm) {
        if (v>.38 && v<.46) return G.skinDk; // gloves near weapon
        return u<.5?G.shirt:G.shirtDk;
      }
      if (v>.525) return c<.03?G.buckle:G.belt;
      if (c<.19 && v>.23 && v<.52) {
        if (v>.44 && v<.51 && Math.abs((c%.065)-.032)<.026) return v<.452?G.pouchDk:G.pouch;
        if (v>.25 && v<.29 && c<.05) return [40,46,36];
        return c>.165?G.pouchDk:G.vest;
      }
      return G.shirt;
    }
    // back: backpack
    if (arm) return v>.5?G.skinDk:(u<.5?G.shirt:G.shirtDk);
    if (v>.525) return G.belt;
    if (c<.15 && v>.24 && v<.5) {
      if (v<.27 || Math.abs(c-.1)<.012) return G.pouchDk;
      return v>.4?G.pouchDk:G.pouch;
    }
    return G.vest;
  }
}

// downed guard lying on his side: helmet left, boots right, rifle dropped beside him
function corpsePixel(u,v) {
  if (u<0||u>1||v<0||v>1) return;
  if (v>.82 && u>.18 && u<.86 && Math.abs(v-.9)<.04) return u<.3?G.gunHi:G.gun;       // dropped rifle
  if (ellipse(u,v,.09,.55,.075,.3)) return v<.4?G.helmetHi:G.helmet;
  if (u>.13 && u<.2 && v>.42 && v<.82) return v>.5&&v<.6?G.skin:G.skinDk;               // face/neck
  if (u>=.18 && u<.55 && v>.3 && v<.86) {
    if (u>.5) return G.belt;
    if (v<.42 && u>.24 && u<.48) return G.pouchDk;
    return v<.5?G.vest:G.pouch;
  }
  if (u>=.55 && u<.92 && v>.38 && v<.84) {
    if (u>.86) return G.boot;
    if (u>.68 && u<.73) return G.pad;
    return v<.6?G.pants:G.pantsDk;
  }
  if (u>.22 && u<.44 && v>.78 && v<.92) return G.shirtDk;                                // arm
}

// ---------- Intel case sprite ----------
function intelPixel(u,v,turn) {
  if (u<0 || u>1 || v<0 || v>1) return;
  const edgeOn=Math.abs(turn)<.3;
  if (v<.2) { // carry handle
    if (u>.36 && u<.64 && (v<.07 || u<.42 || u>.58)) return v<.04?[60,62,58]:[22,24,22];
    return;
  }
  const bu=Math.min(u,1-u), bv=Math.min(v-.2,1-v);
  if (bu<.05 && bv<.05 && (.05-bu)**2+(.05-bv)**2>.0025) return; // rounded corners
  if (edgeOn) return bu<.12?[150,78,22]:v<.6?[236,140,48]:[200,108,34];
  if (bu<.04 || bv<.04) return [146,72,20];
  if (bu<.07 || bv<.07) return [252,170,80];
  if (v>.62 && v<.74) return ((u*14+v*10)|0)%2?[30,30,26]:[244,196,52];
  if (v>.27 && v<.37 && (Math.abs(u-.22)<.07 || Math.abs(u-.78)<.07)) return v<.3?[230,232,224]:[150,154,150];
  if (v>.43 && v<.56 && u>.36 && u<.64) return v>.47 && v<.52 && u>.4 && u<.6 && ((u*40)|0)%3?[40,40,36]:[236,234,222];
  const ridge=((v*22)|0)%3===0;
  return ridge?[214,118,36]:[238,140,46];
}

function render(clock) {
  const [fx,fy,fz]=direction();
  const rx=Math.cos(player.yaw), rz=-Math.sin(player.yaw);
  const ux=-Math.sin(player.yaw)*fy, uy=Math.cos(player.pitch);
  const uz=-Math.cos(player.yaw)*fy;
  const flashStrength=flash/.075;
  const blastStrength=blast?Math.min(.66,blast.life*2):0;
  for (let row=0;row<height;row++) {
    const v=(height/2-row-.5)/focal;
    const bx=fx+ux*v, by=fy+uy*v, bz=fz+uz*v;
    for (let col=0;col<width;col++) {
      const u=(col+.5-width/2)/focal;
      const dx=bx+rx*u, dz=bz+rz*u;
      const id=trace(player.x,player.eye,player.z,dx,by,dz,68,ray);
      const i=row*width+col, j=i*4;
      depth[i]=ray.t;
      if (!id) {
        const altitude=Math.max(0,Math.min(1,by*1.8));
        const sunlight=Math.max(0,1-((dx+.25)**2+(by-.39)**2+(dz-.82)**2)*9);
        const glow=sunlight**4*93;
        const lo=palette.skyLo, hi=palette.skyHi;
        pixels[j]=lo[0]+(hi[0]-lo[0])*altitude+glow;
        pixels[j+1]=lo[1]+(hi[1]-lo[1])*altitude+glow*.82;
        pixels[j+2]=lo[2]+(hi[2]-lo[2])*altitude+glow*.53;
      } else {
        const px=player.x+dx*ray.t, py=player.eye+by*ray.t, pz=player.z+dz*ray.t;
        const u=ray.side===0?pz:px;
        const v=ray.side===1?pz:-py;
        const texel=(((Math.floor(v*16)&63)*64)+(Math.floor(u*16)&63))*3;
        const tex=textures[id];
        const floorShade=(ray.side===1?.88:Math.min(1.13,.66+(py-1)*.085))*(id===7?ray.tint:1);
        const haze=Math.min(.68,ray.t*.014);
        const muzzle=flashStrength*Math.max(0,1-ray.t*.15)*.38;
        const glow=blastStrength?blastStrength*Math.max(0,1-((px-blast.x)**2+(py-blast.y)**2+(pz-blast.z)**2)/34):0;
        // warm pool of light around the intel case, green around the pad once it's live
        const ix=px-intel.x, iz=pz-intel.z;
        const intelGlow=hasIntel?0:Math.max(0,1-(ix*ix+(py-2.4)**2+iz*iz)/9)*(.22+.06*Math.sin(clock*4));
        const ex=px-extraction.x, ez=pz-extraction.z;
        const padGlow=hasIntel?Math.max(0,1-(ex*ex+(py-1)**2+ez*ez)/16)*(.3+.1*Math.sin(clock*5)):0;
        const light=faceLight[ray.side]*floorShade*(1-haze);
        const warmth=muzzle+glow+intelGlow;
        pixels[j]=tex[texel]*light+10+groundFog[0]*haze+warmth*116+padGlow*20;
        pixels[j+1]=tex[texel+1]*light+14+groundFog[1]*haze+warmth*76+padGlow*120;
        pixels[j+2]=tex[texel+2]*light+15+groundFog[2]*haze+warmth*32+padGlow*70;
      }
      pixels[j+3]=255;
    }
  }
  function project(x,y,z) {
    const dx=x-player.x, dy=y-player.eye, dz=z-player.z;
    const distance=dx*fx+dy*fy+dz*fz;
    if (distance<=.18) return null;
    return {x:width/2+(dx*rx+dz*rz)*focal/distance,
      y:height/2-(dx*ux+dy*uy+dz*uz)*focal/distance,distance};
  }
  // colorAt(u,v,du,dv) returns [r,g,b] (opaque, depth-written) or [r,g,b,a] (additive glow).
  function sprite(x,y,z,w,h,colorAt,opacity=1,outline=false) {
    const p=project(x,y,z);
    if (!p) return;
    const sw=focal*w/p.distance, sh=focal*h/p.distance;
    const left=p.x-sw/2, top=p.y-sh/2;
    const du=1/sw, dv=1/sh;
    const haze=Math.min(.68,p.distance*.014);
    for (let row=Math.max(0,Math.floor(top));row<Math.min(height,top+sh);row++) {
      for (let col=Math.max(0,Math.floor(left));col<Math.min(width,left+sw);col++) {
        const i=row*width+col;
        if (p.distance>=depth[i]) continue;
        const u=(col+.5-left)/sw, v=(row+.5-top)/sh;
        if (u>1 || v>1) continue;          // edge rows can land just past 1 and poison glow math
        const c=colorAt(u,v,du,dv);
        if (!c) continue;
        const j=i*4;
        if (c.length===4) {
          const a=c[3]*opacity*(1-haze);
          pixels[j]+=c[0]*a; pixels[j+1]+=c[1]*a; pixels[j+2]+=c[2]*a;
        } else if (opacity===1) {
          let k=1;
          if (outline && (!colorAt(u-du,v,du,dv) || !colorAt(u+du,v,du,dv) || !colorAt(u,v-dv,du,dv) || !colorAt(u,v+dv,du,dv))) k=.48;
          const shade=k*(1.12-Math.abs(u-.42)*.5-v*.12)*(1-haze);
          depth[i]=p.distance;
          pixels[j]=c[0]*shade+groundFog[0]*haze;
          pixels[j+1]=c[1]*shade+groundFog[1]*haze;
          pixels[j+2]=c[2]*shade+groundFog[2]*haze;
        } else {
          const alpha=opacity*Math.max(0,1-4*((u-.5)**2+(v-.5)**2));
          for (let channel=0;channel<3;channel++)
            pixels[j+channel]+=(c[channel]-pixels[j+channel])*alpha;
        }
      }
    }
  }
  const glowAt=(r,g,b,a=1)=>(u,v)=>{
    const d=(u-.5)**2+(v-.5)**2;
    return d<.25?[r,g,b,a*(1-d*4)**2]:null;
  };
  const shaftAt=(r,g,b,a)=>(u,v)=>{
    const s=1-Math.abs(u-.5)*2;
    return s>0 && v<1?[r,g,b,a*s*s*(1-v)**.7*(.8+.2*Math.sin(v*40-clock*6))]:null;
  };
  for (const g of guards) {
    const view=guardView(g);
    const fall=g.fall||0;
    const step=Math.sin(g.gait)*g.pace;
    if (fall>=.55) {
      const lie=Math.min(1,(fall-.55)/.45);
      sprite(g.x,1+.32,g.z,2.9,.64,(u,v)=>corpsePixel(u,v/lie-(1/lie-1)),1,true);
      continue;
    }
    const height=3.26-2.8*fall;
    const hitOffset=g.impact*1.2;
    sprite(g.x,1+height/2+Math.abs(step)*.06,g.z,1.76+fall*.56,height,(u,v)=>{
      const color=guardPixel(view,u-hitOffset*(1-v),v,g.muzzle>0,step,g.aim>0?1-g.aim/windup:0);
      return color && g.impact?[color[0]+60,color[1]+22,color[2]+10]:color;
    },1,true);
    const mk=view==="front"?.18:view==="right"?.82:view==="left"?-.82:0;   // muzzle offset across the sprite
    const my=3.27;
    if (g.muzzle>0) sprite(g.x+rx*mk,my,g.z+rz*mk,1.1,1.1,glowAt(255,190,90,.9));
    if (g.hp && g.aim>0) {
      const t=1-g.aim/windup, size=.25+t*.55;
      const towardX=(player.x-g.x), towardZ=(player.z-g.z), d=Math.hypot(towardX,towardZ)||1;
      sprite(g.x+rx*mk+towardX/d*.3,my,g.z+rz*mk+towardZ/d*.3,size,size,(u,v)=>{
        const a=glowAt(255,90,50,.6+t*.6+Math.sin(clock*60)*.15)(u,v);
        if (!a) return;
        const star=Math.abs(u-.5)<.025 || Math.abs(v-.5)<.025;   // lens-flare cross
        return star?[255,200,160,a[3]+.4*t]:a;
      });
    }
    if (g.hp && g.query>0 && !g.spot) {   // "?" heard something
      sprite(g.x,4.6,g.z,.42,.62,(u,v)=>{
        if (u<0||u>1||v<0||v>1) return;
        const px=(u*3)|0, py=(v*5)|0;   // 3x5 "?" glyph
        return ["111","001","011","000","010"][py][px]==="1"?[255,214,64]:null;
      },1,true);
    }
    if (g.hp && g.spot>0) {
      const pop=Math.min(1,(1.1-g.spot)*8);
      sprite(g.x,4.6+Math.sin(clock*10)*.05,g.z,.28*pop,.62*pop,(u,v)=>{
        if (u<0||u>1||v<0||v>1) return;
        if (Math.abs(u-.5)<.2 && (v<.62 || v>.76)) return [255,214,64];
      },1,true);
    }
  }
  if (!hasIntel) {
    const turn=Math.cos(clock*1.6);
    const bob=Math.sin(clock*2.4)*.12;
    const w=1.25*(.72+.28*turn);
    sprite(intel.x,1.2,intel.z,3.4,3.4,glowAt(255,150,50,.55+.15*Math.sin(clock*4)));
    sprite(intel.x,2.55+bob,intel.z,w,.95,(u,v)=>intelPixel(u,v,1),1,true);
    sprite(intel.x,7,intel.z,1.1,10,shaftAt(255,170,70,.32));
  } else {
    sprite(extraction.x,6,extraction.z,2.2,10,shaftAt(80,255,150,.4));
  }
  if (charge && !charge.plant) {
    const {x,y,z,dx,dz,fuse}=charge;
    const lit=Math.ceil(fuse*7)%2;
    sprite(x-dx*.16,y,z-dz*.16,.78,.6,(u,v)=>{
      if (u<0 || v<0 || u>1 || v>1) return;
      if (u>.55 && u<.86 && v>.18 && v<.56) {
        if (u>.62 && u<.74 && v>.26 && v<.4) return lit?[255,70,40]:[90,30,24];
        return v<.22?[80,86,82]:[30,34,32];
      }
      if (v<.12) return Math.abs(u-.3)<.03 || Math.abs(u-.4)<.03?(u<.35?[200,50,40]:[60,90,190]):null;
      if (u<.08 || u>.92) return;
      if (Math.abs(u-.2)<.05 || Math.abs(u-.45)<.05) return [82,90,62];
      return v>.7?[176,160,120]:[214,198,152];
    },1,true);
    if (lit) sprite(x-dx*.2,y+.05,z-dz*.2,1.4,1.4,glowAt(255,60,30,.9));
  }
  for (const f of fallers) {
    const base=textures[7], k=f.tint, seed=f.tint*40, spin=clock*f.spin;
    // each falling voxel breaks into a few tumbling, jagged chunks
    for (let c=0;c<3;c++) {
      const ox=Math.sin(seed+c*2.1)*.28, oz=Math.cos(seed+c*1.7)*.28, oy=(c-1)*.22;
      const size=.55-c*.1;
      sprite(f.x+ox,f.y+oy,f.z+oz,size,size,(u,v)=>{
        const du=u-.5, dv=v-.5, a=Math.atan2(dv,du)+spin+c;
        const r=.36+.1*Math.sin(a*3+seed)+.07*Math.sin(a*5-seed*.7);
        if (du*du+dv*dv>r*r) return;
        const t=(((v*24)|0)%64*64+((u*24+c*9)|0)%64)*3;
        const e=(.85-dv*.5-du*.3)*k;   // lit from the upper left
        return [base[t]*e,base[t+1]*e,base[t+2]*e];
      },1,true);
    }
  }
  for (const b of bullets) {
    for (let k=0;k<4;k++) {
      const back=k*.012;
      sprite(b.x-b.vx*back,b.y-b.vy*back,b.z-b.vz*back,.3-k*.05,.3-k*.05,glowAt(255,180-k*25,80,.8-k*.18));
    }
    sprite(b.x,b.y,b.z,.08,.08,()=>[255,245,210]);
  }
  for (const p of particles) {
    if (p.spark) { sprite(p.x,p.y,p.z,.18,.18,glowAt(255,200,110,p.life*5)); continue; }
    if (p.dust) continue;
    const k=.7+p.shade*.5;
    sprite(p.x,p.y,p.z,.11+p.shade*.08,.11+p.shade*.08,()=>[rubbleColor[0]*k,rubbleColor[1]*k,rubbleColor[2]*k]);
  }
  if (blast) {
    const t=(.42-blast.life)/.42;
    const burst=1.5+t*7;
    sprite(blast.x,blast.y,blast.z,burst,burst,(u,v)=>{
      const d=Math.sqrt((u-.5)**2+(v-.5)**2)*2;
      if (d>1) return;
      const n=Math.sin(Math.atan2(v-.5,u-.5)*7+clock*20)*.08;
      const r=d+n;
      const a=(1-t)*(1-r)**1.2*1.6;
      if (a<=0) return;
      return r<.35?[255,250,220,a]:r<.65?[255,170,60,a]:[200,70,30,a*.8];
    });
    if (t>.2) sprite(blast.x,blast.y,blast.z,burst*1.6,burst*1.6,(u,v)=>{
      const d=Math.sqrt((u-.5)**2+(v-.5)**2)*2;
      return Math.abs(d-.85)<.07?[255,220,170,(1-t)*.5]:null;
    });
  }
  for (const p of particles) {
    if (!p.dust) continue;
    const size=1.4+(1.6-p.life)*1.4;
    sprite(p.x,p.y,p.z,size,size,()=>dustColor,Math.min(.22,p.life*.25));
  }
  ctx.putImageData(image,0,0);

  vm.clearRect(0,0,VW,VH);
  drawRifle(clock);
  if (charge?.plant>0) drawPlant(1-charge.plant/plantTime);
  if (hurt) {
    const edge=vm.createRadialGradient(VW/2,VH/2,VH*.25,VW/2,VH/2,VW*.51);
    edge.addColorStop(0,"rgba(115,28,17,0)");
    edge.addColorStop(1,`rgba(135,29,17,${hurt*1.6})`);
    vm.fillStyle=edge;
    vm.fillRect(0,0,VW,VH);
  }
}

// ---------- First-person carbine (drawn at 4x on the viewmodel canvas) ----------
function lg(x0,y0,x1,y1,...stops) {
  const g=vm.createLinearGradient(x0,y0,x1,y1);
  stops.forEach((c,i)=>g.addColorStop(i/(stops.length-1),c));
  return g;
}
function poly(fill,points,edge) {
  vm.fillStyle=fill;
  vm.beginPath();
  for (const [x,y] of points) vm.lineTo(x,y);
  vm.closePath();
  vm.fill();
  if (edge) { vm.strokeStyle=edge; vm.lineWidth=.45; vm.stroke(); }
}
function line(color,w,points) {
  vm.strokeStyle=color; vm.lineWidth=w; vm.lineCap="round"; vm.lineJoin="round";
  vm.beginPath();
  for (const [x,y] of points) vm.lineTo(x,y);
  vm.stroke();
}
// point along the handguard/barrel axis: t=0 receiver front, t=1 muzzle
const axis=t=>[30-t*2.6,-17-t*29];

function drawRifle(clock) {
  const recoil=cooldown>.08?Math.sin((.21-cooldown)/.13*Math.PI)*5:0;
  const dip=reload?Math.sin(reload/1.15*Math.PI):0;
  const plant=charge?.plant>0?Math.min(1,(1-charge.plant/plantTime)*5):0;
  const idle=Math.sin(clock*2.2)*.55;
  vm.save();
  vm.translate(VS*(width-121.6+Math.sin(stridePhase)*4*sway+dip*15),
    VS*(height+3+Math.abs(Math.cos(stridePhase))*3*sway+idle+dip*29+plant*height*.34+recoil));
  vm.scale(VS*320/224,VS*320/224);
  vm.rotate(-.42+dip*.27-recoil*.014);   // cant the carbine so the barrel converges on the reticle

  // right sleeve + stock heel (closest to camera)
  poly(lg(50,10,80,40,"#4a5240","#2c3226"),[[44,44],[48,18],[64,8],[92,14],[94,44]]);
  line("#5e6750",.8,[[50,22],[66,13],[88,17]]);
  poly(lg(52,0,72,20,"#2a2f2d","#121515"),[[50,4],[62,-4],[76,6],[70,22],[56,20]],"#3d4442");

  // magazine (drops during reload)
  const lift=reload && reload<.82 && reload>.22?Math.sin((reload-.22)/.6*Math.PI):0;
  vm.save(); vm.translate(lift*4,lift*26);
  poly(lg(22,14,40,40,"#3a403b","#181c1b"),[[22,12],[36,10],[40,24],[40,40],[26,44],[22,28]],"#4c5450");
  for (let k=0;k<4;k++) line("#121615",.5,[[24,18+k*6],[38,16+k*6.2]]);
  vm.restore();

  // lower receiver + magwell
  poly(lg(14,-6,50,20,"#343a37","#151918"),[[12,8],[17,-6],[46,-8],[58,4],[52,16],[36,12],[22,16]],"#4a524e");
  poly("#202523",[[20,6],[24,-2],[40,-3],[44,6],[36,10],[24,12]]);
  // upper receiver: side + lit top
  poly(lg(16,-16,48,-4,"#5d6863","#2c3431"),[[14,-6],[19,-15],[46,-13],[50,-4],[44,-6],[24,-7]]);
  poly(lg(20,-22,46,-12,"#9aa6a0","#5a6560"),[[19,-15],[25,-21],[41,-19.5],[46,-13]]);
  line("#c9d2cc",.35,[[25,-21],[41,-19.5]]);
  // charging handle + ejection port
  poly("#1c2120",[[40,-12],[47,-11],[48,-8],[41,-8.5]]);
  poly("#0e1111",[[30,-12],[39,-11.5],[38,-9],[30,-9.6]]);

  // handguard: tapers toward the muzzle, top rail with slots
  poly(lg(19,0,37,0,"#232a28","#4a5652","#2a3230"),[[20,-16],[25.5,-38],[30.8,-38.6],[38,-17]],"#56625d");
  for (let k=0;k<6;k++) {
    const [ax,ay]=axis(.1+k*.1);
    const s=1-k*.065;
    poly("#121615",[[ax-2.2*s,ay],[ax+2.2*s,ay],[ax+2*s,ay-1.1*s],[ax-2*s,ay-1.1*s]]);
  }
  for (let k=0;k<3;k++) {
    const [ax,ay]=axis(.2+k*.25);
    poly("#151a19",[[ax+3.4-k*.4,ay+1],[ax+4.6-k*.5,ay+1],[ax+4.2-k*.5,ay-2.4],[ax+3.1-k*.4,ay-2.4]]);
  }

  // holographic sight (sits low on the receiver)
  vm.save(); vm.translate(33,-20); vm.scale(.82,.82); vm.translate(-33,20); vm.translate(0,4);
  poly("#1a1f1e",[[26,-19.5],[39,-18],[40,-21.5],[27,-23]]);
  poly(lg(24,-34,40,-20,"#2f3735","#121615"),[[25,-21.5],[24.8,-31],[27.5,-34.5],[37.5,-33.8],[40.5,-30],[40.5,-20.5]],"#59645f");
  poly(lg(27,-32,38,-23,"rgba(80,150,160,.85)","rgba(20,46,52,.9)","rgba(60,110,120,.85)"),
    [[27.4,-23.2],[27.3,-30],[29,-32.2],[36.4,-31.7],[38.2,-29.3],[38.2,-23]]);
  line("rgba(220,250,255,.55)",.6,[[29.4,-30.8],[33.8,-24.5]]);
  const dot=vm.createRadialGradient(32.6,-27.6,0,32.6,-27.6,1.8);
  dot.addColorStop(0,"rgba(255,90,70,1)"); dot.addColorStop(.35,"rgba(255,40,30,.7)"); dot.addColorStop(1,"rgba(255,40,30,0)");
  vm.fillStyle=dot; vm.beginPath(); vm.arc(32.6,-27.6,1.8,0,7); vm.fill();
  poly("#0f1312",[[39.5,-28],[42,-27.5],[42,-24],[39.6,-24.3]]); // brightness knob

  vm.restore();
  // right glove on the pistol grip + trigger finger
  poly(lg(36,4,58,30,"#3c3f39","#1d1f1b"),[[37,6],[50,2],[58,12],[60,28],[46,34],[36,22]],"#575b52");
  for (let k=0;k<3;k++) line("#5a5e55",.5,[[40+k*3,10+k*5],[50+k*2.5,8+k*5]]);
  poly("#33362f",[[29,5],[38,3.5],[39,7],[30,8.5]]);

  // muzzle flash: randomised star + bloom
  if (flash) {
    const k=flash/.075;
    vm.save(); vm.translate(28.2,-41.5); vm.rotate(Math.random()*6.28);
    const bloom=vm.createRadialGradient(0,0,0,0,0,16);
    bloom.addColorStop(0,`rgba(255,240,190,${.9*k})`); bloom.addColorStop(.25,`rgba(255,170,70,${.55*k})`); bloom.addColorStop(1,"rgba(255,120,40,0)");
    vm.fillStyle=bloom; vm.beginPath(); vm.arc(0,0,16,0,7); vm.fill();
    const pts=[]; for (let n=0;n<14;n++) { const a=n/14*6.283, r=n%2?2.2:5+Math.random()*5; pts.push([Math.cos(a)*r,Math.sin(a)*r*1.3]); }
    poly("#ffb24a",pts);
    poly("#fff6d0",pts.map(([x,y])=>[x*.45,y*.45]));
    vm.restore();
    // warm light on the gun itself
    vm.globalCompositeOperation="source-atop";
    const warm=vm.createRadialGradient(28,-40,2,28,-40,60);
    warm.addColorStop(0,`rgba(255,180,90,${.55*k})`); warm.addColorStop(1,"rgba(255,140,60,0)");
    vm.fillStyle=warm; vm.fillRect(-20,-80,120,140);
    vm.globalCompositeOperation="source-over";
  }
  vm.restore();
}

function drawPlant(progress) {
  const rise=Math.sin(progress*Math.PI/2);
  const x=VS*(width/2-12+progress*10), y=VS*(height+6-rise*height*.49);
  vm.save(); vm.translate(x,y); vm.scale(VS,VS);
  poly(lg(-8,8,26,60,"#4f5844","#2b3125"),[[-10,10],[28,8],[30,80],[-12,80]]);
  poly(lg(0,0,24,14,"#e2cf9e","#b8a272"),[[0,0],[24,0],[24,14],[0,14]],"#8a7a52");
  poly("#525c40",[[4,0],[7,0],[7,14],[4,14]]); poly("#525c40",[[16,0],[19,0],[19,14],[16,14]]);
  poly("#22272a",[[13,-3],[22,-3],[22,5],[13,5]],"#4a5256");
  vm.fillStyle=Math.sin(progress*30)>0?"#ff4a2a":"#5a1e16"; vm.fillRect(15,-1.5,3,2.5);
  line("#c03a2a",.6,[[14,-3],[10,-7],[6,-5]]); line("#3a5ac0",.6,[[20,-3],[22,-8],[26,-7]]);
  poly(lg(-6,4,12,20,"#3c3f39","#1d1f1b"),[[-6,4],[6,2],[12,10],[8,20],[-6,18]]);
  vm.restore();
}

// ===== Touch controls (phones/tablets): stick to move, drag to aim, on-screen buttons =====
const isTouch=touchDevice;
const touchMove={x:0,y:0};
let touchFire=false, touchCrouch=false;
document.querySelector("#version").textContent="BUNKER BUSTER "+VERSION;
const touchLayer=document.querySelector("#touch");
if (isTouch) {
  document.querySelector("main").classList.add("touch");
  document.querySelector(".controls").hidden=true;
  document.querySelector("#touch-help").hidden=false;
  const stick=document.querySelector("#stick"), nub=document.querySelector("#nub");
  let stickId=null, lookId=null, lastX=0, lastY=0;
  const setStick=e=>{
    const r=stick.getBoundingClientRect(), R=r.width/2;
    let dx=(e.clientX-r.left-R)/R, dy=(e.clientY-r.top-R)/R;
    const m=Math.hypot(dx,dy); if (m>1) { dx/=m; dy/=m; }
    const dead=m<.12?0:1;
    touchMove.x=dx*dead; touchMove.y=dy*dead;
    nub.style.transform=`translate(calc(-50% + ${dx*R*.62}px),calc(-50% + ${dy*R*.62}px))`;
  };
  const endStick=()=>{ stickId=null; touchMove.x=touchMove.y=0; nub.style.transform="translate(-50%,-50%)"; };
  stick.addEventListener("pointerdown",e=>{ e.preventDefault(); stickId=e.pointerId; try { stick.setPointerCapture(e.pointerId); } catch {} setStick(e); });
  stick.addEventListener("pointermove",e=>{ if (e.pointerId===stickId) setStick(e); });
  stick.addEventListener("pointerup",endStick); stick.addEventListener("pointercancel",endStick);
  const look=document.querySelector("#look");
  look.addEventListener("pointerdown",e=>{ e.preventDefault(); lookId=e.pointerId; lastX=e.clientX; lastY=e.clientY; try { look.setPointerCapture(e.pointerId); } catch {} });
  look.addEventListener("pointermove",e=>{
    if (e.pointerId!==lookId || phase!=="playing") return;
    const k=1.55*320/screen.getBoundingClientRect().width*.0105;   // same feel on any screen size
    player.yaw+=(e.clientX-lastX)*k;
    player.pitch=Math.max(-1.12,Math.min(1.12,player.pitch-(e.clientY-lastY)*k));
    lastX=e.clientX; lastY=e.clientY;
  });
  const endLook=e=>{ if (e.pointerId===lookId) lookId=null; };
  look.addEventListener("pointerup",endLook); look.addEventListener("pointercancel",endLook);
  const button=(id,down,up)=>{
    const el=document.querySelector(id);
    el.addEventListener("pointerdown",e=>{ e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch {} if (phase==="playing") down(el); });
    if (up) { el.addEventListener("pointerup",()=>up(el)); el.addEventListener("pointercancel",()=>up(el)); }
  };
  button("#t-fire",el=>{ touchFire=true; el.classList.add("on"); },el=>{ touchFire=false; el.classList.remove("on"); });
  button("#t-plant",()=>breach());
  button("#t-reload",()=>reloadRifle());
  button("#t-crouch",el=>{ touchCrouch=!touchCrouch; el.classList.toggle("on",touchCrouch); });
  button("#t-pause",()=>pauseTouch());
  touchLayer.addEventListener("contextmenu",e=>e.preventDefault());
}
function pauseTouch() {
  phase="paused"; touchFire=false; touchMove.x=touchMove.y=0;
  touchLayer.hidden=true; overlay.hidden=false;
  title.textContent="PAUSED"; brief.textContent="Tap resume to return to the operation.";
  deploy.textContent="RESUME";
}

deploy.addEventListener("click",()=>{
  if (phase==="won" || phase==="lost") { reset(); resultsEl.hidden=entryEl.hidden=boardEl.hidden=true; lastResult=null; overlay.querySelector("article").classList.remove("scored"); }
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (Audio) {
    audio ??= new Audio();
    audio.resume().catch(()=>{});
  }
  if (isTouch) {
    try { document.documentElement.requestFullscreen?.({navigationUI:"hide"})?.catch(()=>{}); } catch {}
    try { window.screen.orientation?.lock?.("landscape")?.catch(()=>{}); } catch {}
    phase="playing"; overlay.hidden=true; touchLayer.hidden=false;
    return;
  }
  try {
    const request=screen.requestPointerLock();
    request?.catch(()=>say("CLICK DEPLOY TO CAPTURE THE MOUSE"));
  } catch {
    brief.textContent="Mouse capture is unavailable. Open index.html in a desktop browser.";
  }
});
document.addEventListener("pointerlockchange",()=>{
  if (document.pointerLockElement===screen) { phase="playing"; overlay.hidden=true; }
  else if (phase==="playing") {
    phase="paused"; keys.clear(); overlay.hidden=false;
    title.textContent="PAUSED"; brief.textContent="Click resume to return to the operation.";
    deploy.textContent="RESUME";
  }
});
document.addEventListener("pointerlockerror",()=>{
  brief.textContent="The browser blocked mouse capture. Open index.html directly and click again.";
});
document.addEventListener("mousemove",e=>{
  if (phase!=="playing") return;
  player.yaw+=e.movementX*.0027;
  player.pitch=Math.max(-1.12,Math.min(1.12,player.pitch-e.movementY*.0027));
});
screen.addEventListener("mousedown",e=>{ if (e.button===0) shoot(); });
document.addEventListener("keydown",e=>{
  if (phase!=="playing") return;
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code==="KeyQ") breach();
  if (e.code==="KeyR") reloadRifle();
});
document.addEventListener("keyup",e=>keys.delete(e.code));
window.addEventListener("blur",()=>keys.clear());

reset();
let last=0;
function frame(ms) {
  const dt=Math.min(.04,(ms-last)/1000);
  last=ms;
  if (phase==="playing") update(dt,ms/1000);
  render(ms/1000);
  const target=hasIntel?extraction:intel;
  const dx=target.x-player.x, dz=target.z-player.z;
  const heading=((player.yaw*180/Math.PI)%360+360)%360;
  const cardinal=["N","NE","E","SE","S","SW","W","NW"][Math.round(heading/45)%8];
  bearing.textContent=cardinal+" / "+String(Math.floor(heading)).padStart(3,"0")+"°";
  signal.textContent=(hasIntel?"EXTRACT ":"INTEL ")+Math.round(Math.hypot(dx,dz)/2)+" M";
  signal.style.setProperty("--bearing",(Math.atan2(dx,dz)-player.yaw)+"rad");
  objective.textContent=hasIntel?"02 · RETURN TO EXTRACTION":"01 · RECOVER INTEL";
  health.textContent=String(player.hp).padStart(2,"0");
  healthFill.style.width=player.hp+"%";
  healthFill.classList.toggle("low",player.hp<=36);
  ammo.textContent=(reload?"RELOAD":String(magazine).padStart(2,"0")+"/"+reserve)+"  ·  "+charges+" CHG";
  message.textContent=charge?(charge.plant>0
    ? "PLANTING CHARGE"
    : "CHARGE ARMED  "+charge.fuse.toFixed(1)+" S")
    : noticeTime?notice:"";
  chargeFill.hidden=!charge;
  if (charge) chargeFill.style.setProperty("--progress",charge.plant>0
    ? 1-charge.plant/plantTime : charge.fuse/fuseTime);
  const [fx,fy,fz]=direction();
  prompt.hidden=phase!=="playing" || !!charge || !charges ||
    trace(player.x,player.eye,player.z,fx,fy,fz,plantRange,hit)!==2;
  const sh=shake*shake*14;
  document.querySelector("main").style.transform=sh>.05?`translate(${(Math.random()-.5)*sh}px,${(Math.random()-.5)*sh}px)`:"";
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);




