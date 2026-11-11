"use strict";

// Bump on every public build; index.html's script tag carries the same ?v= so browsers drop stale copies.
const VERSION = "v13";
const screen = document.querySelector("#screen");
const ctx = screen.getContext("2d");
// Phones: the render buffer keeps a fixed height and matches the view's shape, so wide screens see more.
// Portrait puts a 4:3 view on top with a control deck underneath; landscape fills the screen.
const touchDevice=matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints>0 && !matchMedia("(pointer: fine)").matches;
const isPortrait=()=>innerHeight>innerWidth;
const touchAspect=()=>isPortrait()?4/3:Math.max(16/9,Math.min(2.4,innerWidth/(innerHeight||1)));
if (touchDevice) {
  const aspect=touchAspect();
  screen.width=Math.round(180*aspect/2)*2;
  document.querySelector("#viewmodel").width=Math.round(720*aspect);
}
let width = screen.width;
const height = screen.height;
let image = ctx.createImageData(width, height);
let pixels = image.data;
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
let VW = document.querySelector("#viewmodel").width;
const VH = 720, VS = VH/180;

const columns=7, rows=10, room=5, stride=8, wallTop=9;   // ~2x the original 5x7 rooms
const X=(columns-1)*stride+room+2, Y=12, Z=(rows-1)*stride+room+2;
const midCol=Math.floor(columns/2);
const firstCell=midCol, lastCell=(rows-1)*columns+midCol;
const world = new Uint8Array(X * Y * Z);
let colors = [[0,0,0], [96,98,94], [150,148,142], [96,72,58],
  [43,160,106], [229,143,47], [86,94,62], [124,121,116],
  [150,132,96], [86,98,60], [104,110,116], [62,58,54], [58,60,60], [92,98,66], [34,36,38], [158,34,26]];
// Per-deploy look: a time of day and weather (sky, sun, ambient light, lamp colour) plus the paint on the
// base. Kept within believable ranges so it reads as a real place. Intel (orange) and extraction pad (green)
// never change so objectives always read the same.
let palette = {stripe:[214,176,40], stripeDark:[34,32,28], skyLo:[150,160,166], skyHi:[70,92,112],
  sun:[1,.94,.82], amb:[.5,.54,.6], lamp:[1,.72,.42], lampK:.8, cloud:[200,200,204], clouds:.5, glare:1,
  sunDir:[.36,.78,.51], fog:[120,128,134]};
function hsl(h,s,l) {
  h=((h%360)+360)%360/360;
  const f=n=>{ const k=(n+h*12)%12, a=s*Math.min(l,1-l); return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))); };
  return [f(0),f(8),f(4)];
}
const MOODS={
  //        sky low (horizon)   sky high          sun colour        sun  amb   lamps elev(deg)  clouds
  dusk:    {lo:[22,.55,.62], hi:[222,.35,.3],  sun:[1,.66,.4],   k:1.05, a:.48, l:1.1, el:[22,34], c:.55},
  day:     {lo:[200,.3,.74], hi:[212,.5,.46],  sun:[1,.96,.88],  k:1.1,  a:.58, l:.5,  el:[48,68], c:.45},
  overcast:{lo:[205,.06,.66],hi:[210,.08,.47], sun:[.86,.88,.9], k:.42,  a:.72, l:.8,  el:[45,65], c:.95},
  smog:    {lo:[50,.28,.6],  hi:[70,.12,.36],  sun:[1,.84,.58],  k:.85,  a:.52, l:.9,  el:[30,48], c:.7},
  night:   {lo:[222,.28,.34],hi:[230,.36,.16], sun:[.5,.58,.78],  k:.55,  a:.95, l:1.6, el:[35,60], c:.35},
};
function rollPalette(random=Math.random) {
  const r=(a,b)=>a+random()*(b-a), pick=a=>a[Math.floor(random()*a.length)];
  const T=(typeof theme!=="undefined" && theme.paint) || {};
  const hue=T.hue?r(...T.hue):r(0,360);
  const concrete=hsl(hue,T.sat?r(...T.sat):r(.03,.1),T.light?r(...T.light):r(.52,.62));
  const floor=T.floor?hsl(...T.floor.map((v,i)=>i?v*r(.95,1.05):v+r(-8,8))):hsl(hue+r(-25,25),r(.03,.08),r(.38,.46));
  const [oh,os,ol]=pick([[22,.42,.32],[28,.3,.3],[80,.16,.3],[205,.12,.34],[0,0,.3]]);
  const outer=hsl(oh+r(-6,6),os,ol);
  const reinforcedCol=hsl(hue+r(160,200),r(.03,.08),r(.42,.5));
  const yard=T.yard?hsl(...T.yard.map((v,i)=>i?v*r(.95,1.05):v+r(-8,8))):hsl(hue,r(.02,.05),r(.24,.3));
  const [th,ts,tl]=pick([[75,.25,.3],[40,.3,.42],[200,.1,.36],[110,.2,.26]]);
  const truck=hsl(th+r(-5,5),ts,tl);
  const drum=pick([[80,.3,.3],[210,.35,.32],[0,.45,.34],[45,.55,.4]]);
  // hazard paint: mostly yellow, sometimes red/white or blue; never the intel's orange or the pad's green
  const accentHue=(T.accent??pick([52,50,46,0,210,280]))+r(-4,4);
  const moods=(typeof theme!=="undefined" && theme.moods) || ["dusk","day","day","overcast","overcast","smog","night"];
  const mood=MOODS[pick(moods)];
  const sky=(h,s,l)=>hsl(h+r(-12,12),s*r(.8,1.2),l*r(.92,1.06));
  const skyLo=sky(...mood.lo), skyHi=sky(...mood.hi);
  const el=r(...mood.el)*Math.PI/180, az=r(0,Math.PI*2);
  const sunDir=[Math.cos(el)*Math.sin(az),Math.sin(el),Math.cos(el)*Math.cos(az)];
  const amb=[0,1,2].map(c=>mood.a*(.6*skyLo[c]+.4*skyHi[c])/150);
  const lamp=random()<.6?[1,.7,.4]:[.82,.95,1];
  palette={
    stripe:hsl(accentHue,r(.6,.8),r(.45,.55)), stripeDark:hsl(accentHue+180,.08,.14),
    skyLo, skyHi, sunDir, sun:mood.sun.map(c=>c*mood.k), amb, lamp, lampK:mood.l,
    clouds:mood.c, cloud:hsl(skyLo[0],.05,.5).map((c,i)=>(c+skyLo[i])/2), glare:mood.k,
    fog:[0,1,2].map(c=>skyLo[c]*.62+skyHi[c]*.18),
  };
  colors=[[0,0,0], floor, concrete, outer, [43,160,106], [229,143,47], [86,94,62],
    concrete.map(c=>c*.86), [150,132,96], hsl(...drum), reinforcedCol, [62,58,54], yard, truck, [32,34,36], [158,34,26]];
  for (let c=0;c<3;c++) {
    groundFog[c]=palette.fog[c];
    dustColor[c]=concrete[c]*.95; rubbleColor[c]=Math.min(255,concrete[c]*1.1);
  }
  textures=buildTextures();
  sunVis.fill(255);
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

// ===== MAP PLAN (pure: room-grid layout only, no voxels; mirrored by godot/scripts/MapPlan.cs) =====
// planLayout(random) decides the whole level on the 7x10 room grid: the maze, loops, the spawn foyer,
// merged spaces (courtyards, an atrium, a long hall), reinforced walls, barred gates, crawl vents,
// guard posts and room dressing. reset() then stamps the plan into voxels.
// Random calls happen in a fixed order so a seeded generator reproduces the same plan in C#.
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
const MIN_REACH=21;          // fewest room-steps from the foyer to the intel once merges and vents are added
const pairKey=(a,b)=>a<b?a*1000+b:b*1000+a;
// opts (all optional, set by the level's theme): yards (fixed courtyard count), reinforced (chance a solid
// wall is reinforced), windows (chance a solid wall gets a window), vents (max crawl vents), gates (chance a
// loop passage is barred), fuel (chance a drum pair is explosive).
const PLAN_DEFAULTS={yards:0, reinforced:.22, windows:.14, vents:3, gates:.5, fuel:.35};
function planLayout(random,opts={}) {
  const o={...PLAN_DEFAULTS,...opts};
  let best=null;
  for (let attempt=0; attempt<20; attempt++) {
    const plan=planOnce(random,o);
    if (plan.reach>=MIN_REACH) return plan;
    if (!best || plan.reach>best.reach) best=plan;
  }
  return best;
}
function planOnce(random,o) {
  const cellOf=(c,r)=>r*columns+c;
  const passages=generateMaze(random);
  const treeCount=passages.length;
  // a few extra openings turn the perfect maze into loops, so sweeps and flanking routes exist
  for (let k=0;k<Math.round(columns*rows*.08);k++) {
    const cell=Math.floor(random()*columns*rows), right=random()<.5;
    const col=cell%columns, row=Math.floor(cell/columns);
    if (right && col<columns-1) passages.push([cell,cell+1]);
    else if (!right && row<rows-1) passages.push([cell,cell+columns]);
  }
  const treeKeys=new Set(passages.map(([a,b])=>pairKey(a,b)));
  const extras=passages.slice(treeCount).filter(([a,b])=>!treeKeys.has(pairKey(a,b)));
  const owner=new Int16Array(columns*rows).fill(-1);      // which merged space a room belongs to
  const spaces=[];
  const free=(c,r,w,h)=>{
    if (c<0 || r<0 || c+w>columns || r+h>rows) return false;
    for (let y=r;y<r+h;y++) for (let x=c;x<c+w;x++) if (owner[cellOf(x,y)]>=0 || cellOf(x,y)===lastCell) return false;
    return true;
  };
  const claim=(c,r,w,h,kind)=>{
    for (let y=r;y<r+h;y++) for (let x=c;x<c+w;x++) owner[cellOf(x,y)]=spaces.length;
    spaces.push({kind,col:c,row:r,w,h});
  };
  // Spawn foyer: a clear 3x2-room hall against the far wall with four ways out, all visible from the pad.
  claim(midCol-1,0,3,2,"foyer");
  const leftRow=random()<.5?0:1, rightRow=random()<.5?0:1;
  passages.push([cellOf(midCol-1,1),cellOf(midCol-1,2)],[cellOf(midCol,1),cellOf(midCol,2)],[cellOf(midCol+1,1),cellOf(midCol+1,2)],
    [cellOf(midCol-2,leftRow),cellOf(midCol-1,leftRow)],[cellOf(midCol+1,rightRow),cellOf(midCol+2,rightRow)]);
  // Central atrium with reinforced pillars.
  if (random()<.6 && free(midCol-1,4,3,2)) claim(midCol-1,4,3,2,"atrium");
  // Courtyards: open yards with vehicles and low cover.
  const yardCount=o.yards || 1+(random()<.5?1:0);
  for (let y=0;y<yardCount;y++) {
    for (let t=0;t<12;t++) {
      const [w,h]=[[2,2],[3,2],[2,3]][Math.floor(random()*3)];
      const c=Math.floor(random()*(columns-w+1)), r=3+Math.floor(random()*(rows-4-h));
      if (free(c,r,w,h)) { claim(c,r,w,h,"yard"); break; }
    }
  }
  // A long hall: four rooms in a row knocked through.
  if (random()<.5) for (let t=0;t<10;t++) {
    const r=3+Math.floor(random()*5), c=Math.floor(random()*(columns-3));
    if (free(c,r,4,1)) { claim(c,r,4,1,"hall"); break; }
  }
  const linked=new Set(passages.map(([a,b])=>pairKey(a,b)));
  const sameSpace=(a,b)=>owner[a]>=0 && owner[a]===owner[b];
  const open=(a,b)=>linked.has(pairKey(a,b)) || sameSpace(a,b);
  // every pair of side-by-side rooms, in a fixed order
  const pairs=[];
  for (let cell=0;cell<columns*rows;cell++) {
    const col=cell%columns, row=Math.floor(cell/columns);
    if (col<columns-1) pairs.push([cell,cell+1]);
    if (row<rows-1) pairs.push([cell,cell+columns]);
  }
  // Barred gates on loop passages (never on the maze's own spanning tree, so guards can always walk round).
  const barred=[];
  for (const [a,b] of extras) if (!sameSpace(a,b) && owner[a]<0 && owner[b]<0 && random()<o.gates) barred.push([a,b]);
  // Crawl vents: knee-high gaps through a solid wall. Crouch to fit; guards can't follow.
  const vents=[], ventKeys=new Set();
  for (let t=0;t<40 && vents.length<o.vents;t++) {
    const [a,b]=pairs[Math.floor(random()*pairs.length)];
    if (open(a,b) || ventKeys.has(pairKey(a,b)) || owner[a]===0 || owner[b]===0) continue;
    vents.push([a,b]); ventKeys.add(pairKey(a,b));
  }
  // Reinforced walls: take two charges and stop bullets. The intel room is a vault.
  // Windows: a slot at head height through a solid wall (some barred), so you and the guards can see across.
  const reinforced=[], windows=[];
  for (const [a,b] of pairs) {
    if (open(a,b) || ventKeys.has(pairKey(a,b))) continue;
    const r=random(), w=random(), bars=random()<.5;
    if (a===lastCell || b===lastCell || r<o.reinforced) reinforced.push([a,b]);
    if (w<o.windows && owner[a]!==0 && owner[b]!==0) windows.push([a,b,bars]);
  }
  // Guard posts: a sandbag nest with a sentry. One always watches the way in from just past the foyer.
  const posts=[{cell:cellOf(midCol,2),facing:0}];
  for (let t=0;t<30 && posts.length<3;t++) {
    const cell=Math.floor(random()*columns*rows), facing=Math.floor(random()*4);
    if (Math.floor(cell/columns)<3 || owner[cell]>=0 || cell===lastCell || posts.some(p=>p.cell===cell)) continue;
    posts.push({cell,facing});
  }
  // Room dressing: wall lamps and clutter in corners. Sides: 0 +z, 1 +x, 2 -z, 3 -x. Corners 0..3.
  const props=[];
  for (let cell=0;cell<columns*rows;cell++) {
    const lamp=random(), side=Math.floor(random()*4), clutter=random(), corner=Math.floor(random()*4), fuel=random();
    if (owner[cell]===0 || posts.some(p=>p.cell===cell)) continue;
    if (lamp<.45) props.push({type:"lamp",cell,side});
    if (cell===lastCell) continue;
    if (clutter<.3) props.push({type:"crates",cell,corner});
    else if (clutter<.5) props.push({type:"barrels",cell,corner,fuel:fuel<o.fuel});
    else if (clutter<.6) props.push({type:"sandbags",cell,side});
  }
  // Yards: one parked truck and some low cover each.
  for (const s of spaces) if (s.kind==="yard") {
    s.truck={along:random()<.5?"x":"z", shift:random()};
    s.cover=1+Math.floor(random()*3);
  }
  // How far is the intel from the foyer once merges and vents are counted? (gates stay shut)
  const shut=new Set(barred.map(([a,b])=>pairKey(a,b)));
  const dist=new Int16Array(columns*rows).fill(-1), queue=[firstCell];
  dist[firstCell]=0;
  for (let q=0;q<queue.length;q++) {
    const a=queue[q], col=a%columns, row=Math.floor(a/columns);
    for (const b of [col>0?a-1:-1, col<columns-1?a+1:-1, row>0?a-columns:-1, row<rows-1?a+columns:-1]) {
      if (b<0 || dist[b]>=0) continue;
      const k=pairKey(a,b);
      if (!((open(a,b) && !shut.has(k)) || ventKeys.has(k))) continue;
      dist[b]=dist[a]+1; queue.push(b);
    }
  }
  return {passages,spaces,owner,barred,vents,reinforced,windows,posts,props,reach:dist[lastCell]};
}
// ===== END MAP PLAN =====

// ===== Stamping the plan into voxels =====
// Materials: 0 air, 1 floor, 2 concrete, 3 outer wall, 4 pad, 6 crate, 7 rubble, 8 sandbags, 9 drum,
// 10 reinforced concrete, 11 steel bars, 12 yard asphalt, 13 truck body, 14 truck chassis/glass.
let plan=null, lamps=[], foyerBox=null, yardBoxes=[], trucks=[];
function roomBox(cell) {
  const {x,z}=cellCenter(cell);
  return {x0:x-room/2, z0:z-room/2, x1:x+room/2, z1:z+room/2};
}
function spaceBox(s) {
  const a=roomBox(s.row*columns+s.col), b=roomBox((s.row+s.h-1)*columns+s.col+s.w-1);
  return {x0:a.x0, z0:a.z0, x1:b.x1, z1:b.z1};
}
// the 3-voxel wall slab between two side-by-side rooms
function slab(a,b) {
  const A=roomBox(Math.min(a,b)), B=roomBox(Math.max(a,b));
  return Math.abs(a-b)===1 ? {x0:A.x1, x1:B.x0, z0:A.z0, z1:A.z1, axis:"x"}
    : {x0:A.x0, x1:A.x1, z0:A.z1, z1:B.z0, axis:"z"};
}
function swap(x0,y0,z0,x1,y1,z1,from,to) {
  for (let y=y0;y<y1;y++) for (let z=z0;z<z1;z++) for (let x=x0;x<x1;x++)
    if (world[index(x,y,z)]===from) world[index(x,y,z)]=to;
}
function put(x,y0,z,y1,m) { if (inside(x,y0,z) && !tile(x,y0,z)) box(x,y0,z,x+1,y1,z+1,m); }
function addLamp(x,y,z,nx,nz,r=7,power=1) {
  lamps.push({x,y,z,nx,nz,r,power,ax:Math.floor(x-nx*.5),ay:Math.floor(y),az:Math.floor(z-nz*.5),dead:false});
}
// a wall lamp in the middle of one side of a room, only if there is wall behind it
function roomLamp(cell,side) {
  const b=roomBox(cell), cx=(b.x0+b.x1)/2, cz=(b.z0+b.z1)/2;
  const spot=[[cx,b.z1-.06,0,-1],[b.x1-.06,cz,-1,0],[cx,b.z0+.06,0,1],[b.x0+.06,cz,1,0]][side];
  const [x,z,nx,nz]=spot;
  if (!tile(Math.floor(x-nx*.5),7,Math.floor(z-nz*.5))) return;
  addLamp(x,6.7,z,nx,nz);
}
function stampTruck(b,along,shift) {
  // a canvas-backed cargo truck: dark chassis and wheels, cab with windows, tall covered bed
  const len=6, wid=3, spanX=along==="x"?len:wid, spanZ=along==="x"?wid:len;
  const x0=b.x0+2+Math.floor(shift*(b.x1-b.x0-4-spanX+1)), z0=b.z0+2+Math.floor((1-shift)*(b.z1-b.z0-4-spanZ+1));
  for (let i=0;i<len;i++) for (let j=0;j<wid;j++) {
    const x=along==="x"?x0+i:x0+j, z=along==="x"?z0+j:z0+i;
    box(x,1,z,x+1,2,z+1,14);
    if (i<2) { box(x,2,z,x+1,3,z+1,13); box(x,3,z,x+1,4,z+1,14); }
    else box(x,2,z,x+1,5,z+1,13);
  }
  const t={x0,z0,x1:x0+spanX,z1:z0+spanZ,along};
  trucks.push(t);
  return t;
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
  plan=planLayout(random,theme.plan);
  for (const [from,to] of plan.passages) {
    const a=cellCenter(from), b=cellCenter(to);
    box(Math.min(a.x,b.x)-room/2,1,Math.min(a.z,b.z)-room/2,
      Math.max(a.x,b.x)+room/2,wallTop,Math.max(a.z,b.z)+room/2,0);
  }
  yardBoxes=[]; foyerBox=null; trucks=[];
  for (const s of plan.spaces) {
    const b=spaceBox(s);
    box(b.x0,1,b.z0,b.x1,wallTop,b.z1,0);
    if (s.kind==="foyer") foyerBox=b;
    if (s.kind==="atrium") {
      // the wall crossings between the merged rooms stay up as reinforced pillars
      for (let i=0;i<s.w-1;i++) for (let j=0;j<s.h-1;j++) {
        const r=roomBox((s.row+j)*columns+s.col+i);
        box(r.x1,1,r.z1,r.x1+3,wallTop,r.z1+3,10);
      }
    }
    if (s.kind==="yard") { box(b.x0,0,b.z0,b.x1,1,b.z1,12); yardBoxes.push(b); }
  }
  for (const [a,b] of plan.reinforced) { const s=slab(a,b); swap(s.x0,1,s.z0,s.x1,wallTop,s.z1,2,10); }
  for (const [a,b] of plan.barred) {
    // a gate of steel bars in the middle of the doorway, with a concrete lintel above it
    const s=slab(a,b);
    if (s.axis==="x") { box(s.x0+1,1,s.z0,s.x0+2,5,s.z1,11); box(s.x0+1,5,s.z0,s.x0+2,wallTop,s.z1,2); }
    else { box(s.x0,1,s.z0+1,s.x1,5,s.z0+2,11); box(s.x0,5,s.z0+1,s.x1,wallTop,s.z0+2,2); }
  }
  for (const [a,b,bars] of plan.windows) {
    // a slot from head height up, two cells tall, three wide; bars down the middle of some
    const s=slab(a,b);
    if (s.axis==="x") { box(s.x0,3,s.z0+1,s.x1,5,s.z1-1,0); if (bars) box(s.x0+1,3,s.z0+1,s.x0+2,5,s.z1-1,11); }
    else { box(s.x0+1,3,s.z0,s.x1-1,5,s.z1,0); if (bars) box(s.x0+1,3,s.z0+1,s.x1-1,5,s.z0+2,11); }
  }
  for (const [a,b] of plan.vents) {
    const s=slab(a,b);
    if (s.axis==="x") box(s.x0,1,s.z0+2,s.x1,3,s.z0+4,0);
    else box(s.x0+2,1,s.z0,s.x0+4,3,s.z1,0);
  }

  const padX=Math.floor(extraction.x), padZ=Math.floor(extraction.z);
  box(padX-2,0,padZ-2,padX+3,1,padZ+3,4);
  box(intelX,1,intelZ,intelX+1,2,intelZ+1,6);

  // Foyer dressing: sandbag nests either side, crates and drums against the walls, floodlights behind the pad.
  lamps=[];
  if (foyerBox) {
    const {x0,z0,x1,z1}=foyerBox, cx=Math.floor((x0+x1)/2);
    for (const dir of [-1,1]) {
      const nx=dir<0?x0+3:x1-4;                      // inner corner of each L-shaped nest
      for (let k=0;k<4;k++) put(nx-dir*k,1,z0+7,3,8);
      for (let k=1;k<3;k++) put(nx,1,z0+7+k,3,8);
      const wallX=dir<0?x0:x1-1;
      put(wallX,1,z0,3,6); put(wallX-dir,1,z0,2,6); put(wallX,1,z0+1,2,6);
      put(wallX,1,z0+5,3,9); put(wallX,1,z0+6,3,9);
      addLamp(cx+dir*6.5,7.2,z0+.06,0,1,15,1.5);
    }
  }
  for (const s of plan.spaces) if (s.kind==="yard") {
    const b=spaceBox(s), t=stampTruck(b,s.truck.along,s.truck.shift);
    for (let n=0;n<s.cover;n++) {
      // short sandbag lines and drum pairs, kept clear of the truck
      const h=h3(b.x0+n,b.z0,n+7), x=b.x0+1+h%(b.x1-b.x0-4), z=b.z0+1+(h>>8)%(b.z1-b.z0-3);
      if (x+3>t.x0-1 && x<t.x1+1 && z>t.z0-2 && z<t.z1+1) continue;
      for (let k=0;k<3;k++) put(x+k,1,z,(h>>4)&1?3:2,8);
      put(x,1,z+1,3,9);
    }
    addLamp((b.x0+b.x1)/2,7.4,b.z0+.06,0,1,10,1.1);
  }
  for (const p of plan.props) {
    const b=roomBox(p.cell);
    if (p.type==="lamp") { roomLamp(p.cell,p.side); continue; }
    if (p.type==="sandbags") {
      const cx=Math.floor((b.x0+b.x1)/2), cz=Math.floor((b.z0+b.z1)/2);
      const [ex,ez,ox,oz]=[[cx,b.z1-1,1,0],[b.x1-1,cz,0,1],[cx,b.z0,1,0],[b.x0,cz,0,1]][p.side];
      if (!tile(ex+(oz?(p.side===1?1:-1):0),2,ez+(ox?(p.side===0?1:-1):0))) continue;  // only against a wall
      for (let k=-1;k<=1;k++) put(ex+ox*k,1,ez+oz*k,3,8);
      continue;
    }
    const x=p.corner&1?b.x1-1:b.x0, z=p.corner&2?b.z1-1:b.z0, inx=p.corner&1?-1:1;
    if (p.type==="crates") { put(x,1,z,(h3(x,z,1)&1)?3:2,6); put(x+inx,1,z,2,6); }
    else { const m=p.fuel?15:9; put(x,1,z,3,m); put(x+inx,1,z,3,m); }
  }
  // Guard posts: a horseshoe of sandbags open toward where the sentry looks.
  const sentries=[];
  for (const p of plan.posts) {
    const b=roomBox(p.cell), cx=b.x0+2, cz=b.z0+2;
    const [fx,fz]=[[0,1],[1,0],[0,-1],[-1,0]][p.facing];
    for (let dz=-1;dz<=1;dz++) for (let dx=-1;dx<=1;dx++) {
      if (!dx && !dz || dx===fx && fx || dz===fz && fz) continue;
      put(cx+dx,1,cz+dz,3,8);
    }
    sentries.push({x:cx+.5,z:cz+.5,cell:p.cell,yaw:Math.atan2(fx,fz)});
  }
  buildLampField();
  Object.assign(player,{...extraction,eye:4.15,yaw:0,pitch:0,hp:100});
  // Starting garrison: sentries at their posts, the rest spread through the base, never near the foyer.
  const taken=new Set(sentries.map(s=>s.cell));
  guards=sentries.map(s=>{ const g=makeGuard(s.x,s.z,s.cell,s.yaw); g.post={x:s.x,z:s.z,yaw:s.yaw}; g.task="post"; return g; });
  const garrison=GARRISON+sentries.length-1+rule("garrison",0)+levelGarrison();
  for (let tries=0; guards.length<garrison && tries<400; tries++) {
    const cell=Math.floor(random()*columns*rows);
    const col=cell%columns, row=Math.floor(cell/columns);
    if (taken.has(cell) || row<3 && Math.abs(col-midCol)<3) continue;
    let {x,z}=cellCenter(cell);
    for (let k=0;k<8 && !canStand(x,z,4.4);k++) { x+=(h3(cell,k,1)%5)-2; z+=(h3(cell,k,2)%5)-2; }
    if (!canStand(x,z,4.4)) continue;
    taken.add(cell);
    guards.push(makeGuard(x,z,cell,random()*6.28));
  }
  alertLevel=0; alertTimer=0; lastKnown=null; reinforced=false; report=null; chaseField=null; chaseTimer=0; stepTimer=0;
  charges=rule("charges",10); reserve=144; magazine=24; reload=0; cooldown=0;
  flash=0; hurt=0; phase="ready"; hasIntel=false;
  notice=""; noticeTime=0; particles=[]; bullets=[];
  fallers=[]; pending.clear(); integrityTimer=0; shake=0; noise=null; charge=null; blast=null; stridePhase=0; sway=0;
  decals.length=0; decalCount.fill(0); scorches.length=0;
  grenades=[]; grenadeCount=GRENADES; pendingBlasts=[]; throwCool=0;
  if (rule("caution",false)) { alertLevel=CAUTION; alertTimer=60; }
  document.querySelector("#location").textContent=theme.name;
  document.querySelector("main").classList.toggle("nvg",!!theme.nvg);
  document.querySelector("#level-label").textContent="LEVEL "+campaign.level;
  markDirty(0,0,0); markDirty(X-1,Y-1,Z-1);
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
    if (material && (!SHAPE[material] || shapeTrace(material,ix,iy,iz,x,y,z,dx,dy,dz,t,side,out))) {
      out.x=ix; out.y=iy; out.z=iz;
      if (!SHAPE[material]) { out.t=t; out.side=side; out.tint=1; }
      return material;
    }
    if (tx<ty && tx<tz) { t=tx; tx+=ax; ix+=sx; side=0; }
    else if (ty<tz) { t=ty; ty+=ay; iy+=sy; side=1; }
    else { t=tz; tz+=az; iz+=sz; side=2; }
  }
  out.t=Infinity;
  return 0;
}

// Some cells are drawn as a block of N x N x N sub-voxels instead of a solid cube: rubble heaps,
// stacked sandbags, oil drums and steel bars. Collision still uses the whole cell; only what you see
// (and what bullets and eyes hit) is the shape.
function h3(a,b,c) { return (Math.imul(a,73856093)^Math.imul(b,19349663)^Math.imul(c,83492791))>>>0; }
const SHAPE=[0,0,0,0,0,0,0,4,8,8,0,4,0,0,0,8];
function rubbleOcc(ix,iy,iz,sx,sy,sz) {
  const h=h3(ix*4+sx,iy*4+sy,iz*4+sz);
  const above=tile(ix,iy+1,iz);
  if (above===7 || above===2) return (h%9)!==0;          // buried rubble is packed solid
  let top=3.7-Math.hypot(sx-1.5,sz-1.5)*1.05+((h3(ix*4+sx,0,iz*4+sz)&7)-3.5)*.32;
  if ((sx===3 && tile(ix+1,iy,iz)===7) || (sx===0 && tile(ix-1,iy,iz)===7) ||
      (sz===3 && tile(ix,iy,iz+1)===7) || (sz===0 && tile(ix,iy,iz-1)===7)) top+=1.3;  // heaps merge
  return sy<top && (sy===0 || (h&15)!==0);
}
// sandbags (8 sub-voxels per cell): courses half a cell high, bags 3/4 of a cell long, laid staggered,
// each one pinched at the ends and rounded along the top
function sandbagRun(ix,iy,iz) { return tile(ix-1,iy,iz)===8 || tile(ix+1,iy,iz)===8 || !(tile(ix,iy,iz-1)===8 || tile(ix,iy,iz+1)===8); }
function sandbagOcc(ix,iy,iz,sx,sy,sz) {
  const runX=sandbagRun(ix,iy,iz);
  const along=runX?ix*8+sx:iz*8+sz, across=runX?sz:sx;
  const ly=iy*8+sy, cy=ly&3, e=(along+((ly>>2)&1)*3)%6, end=Math.min(e,5-e);
  const edge=across===0 || across===7;
  if (cy===3 && (end===0 || edge)) return false;
  if (end===0 && edge) return false;
  return true;
}
function drumOcc(ix,iy,iz,sx,sy,sz) {
  const r=(sx-3.5)**2+(sz-3.5)**2;
  if (r>14.5) return false;
  const top=tile(ix,iy+1,iz)!==tile(ix,iy,iz);
  return !(top && sy===7 && r<8);                         // recessed lid inside the rim
}
function barsOcc(ix,iy,iz,sx,sy,sz) {
  const runX=tile(ix-1,iy,iz)===11 || tile(ix+1,iy,iz)===11;
  const along=runX?sx:sz, across=runX?sz:sx;
  if (across!==1 && across!==2) return false;
  const ly=iy*4+sy;
  return along===1 || along===3 || ly===6 || ly===15;     // two bars per cell, two cross rails
}
function shapeOcc(m,ix,iy,iz,sx,sy,sz) {
  return m===7?rubbleOcc(ix,iy,iz,sx,sy,sz):m===8?sandbagOcc(ix,iy,iz,sx,sy,sz):m===11?barsOcc(ix,iy,iz,sx,sy,sz):drumOcc(ix,iy,iz,sx,sy,sz);
}
function shapeTint(m,ix,iy,iz,cx,cy,cz) {
  if (m===7) return .68+(h3(ix*4+cx,iy*4+cy,iz*4+cz)>>>4&15)/15*.5;       // each chunk its own shade
  if (m===8) {
    const runX=sandbagRun(ix,iy,iz);
    const ly=iy*8+cy, p=(runX?ix*8+cx:iz*8+cz)+((ly>>2)&1)*3, e=p%6, end=Math.min(e,5-e);
    // each bag its own shade, bellied out in the middle, tucked in at the seams, darker underneath
    return (.8+(h3(Math.floor(p/6),ly>>2,runX?iz:ix)&15)/15*.28)*[.72,.92,1.06,1.12][ly&3]*(end===0?.78:end===1?.95:1.05);
  }
  if (m===9 || m===15) return .82+(h3(ix,0,iz)&15)/15*.3;
  return 1;
}
function shapeTrace(m,ix,iy,iz,x,y,z,dx,dy,dz,t,side,out) {
  const N=SHAPE[m];
  const px=(x+dx*t-ix)*N, py=(y+dy*t-iy)*N, pz=(z+dz*t-iz)*N;
  let cx=Math.min(N-1,Math.max(0,Math.floor(px))), cy=Math.min(N-1,Math.max(0,Math.floor(py))), cz=Math.min(N-1,Math.max(0,Math.floor(pz)));
  const sx=dx<0?-1:1, sy=dy<0?-1:1, sz=dz<0?-1:1, s=1/N;
  const ax=dx===0?Infinity:Math.abs(s/dx), ay=dy===0?Infinity:Math.abs(s/dy), az=dz===0?Infinity:Math.abs(s/dz);
  let tx=dx===0?Infinity:t+(sx>0?cx+1-px:px-cx)*ax;
  let ty=dy===0?Infinity:t+(sy>0?cy+1-py:py-cy)*ay;
  let tz=dz===0?Infinity:t+(sz>0?cz+1-pz:pz-cz)*az;
  let tc=t;
  for (let n=0;n<3*N;n++) {
    if (shapeOcc(m,ix,iy,iz,cx,cy,cz)) {
      out.t=tc; out.side=side; out.tint=shapeTint(m,ix,iy,iz,cx,cy,cz);
      return true;
    }
    if (tx<ty && tx<tz) { tc=tx; tx+=ax; cx+=sx; side=0; }
    else if (ty<tz) { tc=ty; ty+=ay; cy+=sy; side=1; }
    else { tc=tz; tz+=az; cz+=sz; side=2; }
    if (cx<0||cy<0||cz<0||cx>=N||cy>=N||cz>=N) return false;
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
  vmSmoke.push({born:lastClock+.05,x:28,dx:(Math.random()-.5)*1.2}); if (vmSmoke.length>8) vmSmoke.shift();
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
    world[index(hit.x,hit.y,hit.z)]=0; markDirty(hit.x,hit.y,hit.z);
    if (material===2) run.blocks++;
    integrityTimer=integrityTimer||.05;
    const x=player.x+dx*(hit.t-.04), y=player.eye+dy*(hit.t-.04);
    const z=player.z+dz*(hit.t-.04);
    for (let n=0; n<10; n++) {
      particles.push({x,y,z,vx:(Math.random()-.5)*3-dx*2,
        vy:Math.random()*3,vz:(Math.random()-.5)*3-dz*2,life:.18+Math.random()*.24,shade:Math.random()});
    }
    impactFx(x,y,z,dx,dy,dz,3,true);
  } else if (material===15) {
    detonateDrum(hit.x,hit.z,.04);
    impactFx(player.x+dx*hit.t,player.eye+dy*hit.t,player.z+dz*hit.t,dx,dy,dz,6,false);
  } else if (material) {
    // steel, reinforced concrete, crates, drums, sandbags: the round stops and leaves a mark
    const x=player.x+dx*hit.t, y=player.eye+dy*hit.t, z=player.z+dz*hit.t;
    addDecal(hit.x,hit.y,hit.z,x,y,z,.075);
    impactFx(x-dx*.04,y-dy*.04,z-dz*.04,dx,dy,dz,material===8?0:5,material!==8);
  }
}
// sparks off hard surfaces, and a puff of grit
function impactFx(x,y,z,dx,dy,dz,sparks,grit) {
  for (let n=0;n<sparks;n++) particles.push({x,y,z,vx:(Math.random()-.5)*5-dx*3,vy:Math.random()*3.5,vz:(Math.random()-.5)*5-dz*3,
    life:.08+Math.random()*.16,shade:Math.random(),spark:true});
  if (grit) particles.push({x,y,z,vx:-dx*.6,vy:.25,vz:-dz*.6,life:.6,dust:true,size:.5});
}

const breachable=m=>m===2||m===10||m===11;
// Concrete, rubble, sandbags, drums and bars are blown out; reinforced concrete only cracks. Collision and line of sight read the same grid.
function carve(cx,cy,cz,radius,onRemove=()=>{}) {
  let removed=0;
  for (let y=Math.floor(cy-radius);y<=cy+radius;y++)
    for (let z=Math.floor(cz-radius);z<=cz+radius;z++)
      for (let x=Math.floor(cx-radius);x<=cx+radius;x++) {
        const m=tile(x,y,z);
        if (m!==2 && m!==7 && m!==8 && m!==9 && m!==10 && m!==11) continue;
        if ((x+.5-cx)**2+(y+.5-cy)**2+(z+.5-cz)**2>radius**2) continue;
        markDirty(x,y,z);
        if (m===10) { world[index(x,y,z)]=2; continue; }   // reinforced concrete cracks; a second charge finishes it
        world[index(x,y,z)]=0;
        removed++; if (m===2) run.blocks++;
        onRemove(x+.5,y+.5,z+.5);
      }
  if (removed) integrityTimer=integrityTimer||.05;
  return removed;
}
function countMaterial(m,cx,cy,cz,r) {
  let n=0;
  for (let y=Math.floor(cy-r);y<=cy+r;y++) for (let z=Math.floor(cz-r);z<=cz+r;z++) for (let x=Math.floor(cx-r);x<=cx+r;x++)
    if (tile(x,y,z)===m) n++;
  return n;
}
function breach() {
  if (charge) return;
  if (!charges) { say("NO BREACH CHARGES"); return; }
  const [dx,dy,dz]=direction();
  const m=trace(player.x,player.eye,player.z,dx,dy,dz,plantRange,hit);
  if (!breachable(m)) {
    say(m===3?"OUTER WALL IS TOO THICK · AIM AT AN INNER WALL":"MOVE CLOSE AND AIM AT A WALL OR GATE"); return;
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
  explode({x,y,z,dx,dz,cx:x+dx*1.7,cy:y-.4,cz:z+dz*1.7,carve:3.7,reach:8,damage:110,guardR:6,
    cause:"The breach charge got you. Back off after planting."});
}
// One explosion, whatever set it off: breach charge, grenade or fuel drum.
// (x,y,z) is where the flash and debris come from; (cx,cy,cz) is the centre of damage.
// carve: radius of wall it blows out (0 for none). reach/damage: hurts the player inside reach,
// halved through a wall. guardR: soldiers inside it go down (inner two-thirds) or are wounded.
let pendingBlasts=[];
function explode(e) {
  const {x,y,z,cx,cy,cz}=e, dx=e.dx||0, dz=e.dz||0;
  // fuel drums inside the blast go up a moment later
  armDrums(cx,cy,cz,Math.max(e.carve,e.guardR*.6));
  let removed=0, before=0;
  if (e.carve) {
    before=countMaterial(10,cx,cy,cz,e.carve);
    removed=carve(cx,cy,cz,e.carve,(x,y,z)=>{
      if (Math.random()<.28) particles.push({x,y,z,vx:(Math.random()-.5)*7,
        vy:Math.random()*5,vz:(Math.random()-.5)*7,life:.45+Math.random()*.5,shade:Math.random()});
    });
  }
  blast={x,y,z,life:.42};
  shake=Math.max(shake,e.carve?.55:.4*Math.max(0,1-Math.hypot(player.x-cx,player.z-cz)/30));
  const pd=Math.hypot(player.x-cx,(player.eye-1.4)-cy,player.z-cz);
  if (pd<e.reach) {
    let dmg=Math.round(e.damage*(1-pd/e.reach));
    const ddx=player.x-cx, ddy=(player.eye-1.4)-cy, ddz=player.z-cz;
    if (trace(cx,cy,cz,ddx/pd,ddy/pd,ddz/pd,pd-.3,hit)) dmg=Math.round(dmg*.5);
    if (dmg>0) {
      player.hp=Math.max(0,player.hp-dmg); hurt=.6;
      say("CAUGHT IN THE BLAST  -"+dmg);
      if (!player.hp) { finish(false,e.cause); return; }
    }
  }
  for (const g of guards) {
    if (!g.hp) continue;
    const gd=Math.hypot(g.x-cx,2.5-cy,g.z-cz);
    if (gd<e.guardR) { g.hp=Math.max(0,g.hp-(gd<e.guardR*.67?2:1)); g.impact=.25; }
  }
  makeNoise(cx,cz,NOISE.blast,"blast");
  for (let n=0; n<22; n++) {
    particles.push({x:x-dx*.35,y,z:z-dz*.35,vx:(Math.random()-.5)*3-dx*1.6,
      vy:Math.random()*1.8,vz:(Math.random()-.5)*3-dz*1.6,life:.95+Math.random()*.65,dust:true});
  }
  // a dark column of smoke that hangs around and drifts up, and a scorch mark on everything nearby
  for (let n=0; n<14; n++) {
    const life=3+Math.random()*3;
    particles.push({x:x-dx*(.6+Math.random()),y:y+Math.random(),z:z-dz*(.6+Math.random()),
      vx:(Math.random()-.5)*.9-dx*.5,vy:.35+Math.random()*.5,vz:(Math.random()-.5)*.9-dz*.5,life,max:life,smoke:true,shade:Math.random()});
  }
  for (let n=0; n<16; n++) particles.push({x:x-dx*.3,y,z:z-dz*.3,vx:(Math.random()-.5)*9-dx*3,vy:Math.random()*6,
    vz:(Math.random()-.5)*9-dz*3,life:.2+Math.random()*.35,shade:Math.random(),spark:true});
  scorches.push({x:cx-dx*1.2,y:cy,z:cz-dz*1.2,r:e.carve?3.4:2.4});
  if (scorches.length>12) scorches.shift();
  const near=Math.max(.25,1-Math.hypot(player.x-cx,player.z-cz)/40);
  tone(95,.45,.25*near,"sawtooth",24);
  if (e.carve===3.7) {
    const cracked=before-countMaterial(10,cx,cy,cz,e.carve);
    say(cracked && !removed?"REINFORCED WALL CRACKED · ONE MORE CHARGE":removed+" CONCRETE CELLS CLEARED");
  }
}
// Fuel drums (material 15) caught in a blast or shot go off themselves, a beat later, and can chain.
function armDrums(cx,cy,cz,r) {
  for (let z=Math.floor(cz-r);z<=cz+r;z++) for (let x=Math.floor(cx-r);x<=cx+r;x++) {
    if (tile(x,1,z)!==15 || (x+.5-cx)**2+(z+.5-cz)**2>r*r) continue;
    detonateDrum(x,z,.12+Math.random()*.18);
  }
}
function detonateDrum(x,z,delay=0) {
  if (pendingBlasts.some(b=>b.x===x && b.z===z)) return;
  pendingBlasts.push({x,z,t:delay});
}
function updateBlasts(dt) {
  for (const b of pendingBlasts) b.t-=dt;
  const due=pendingBlasts.filter(b=>b.t<=0);
  pendingBlasts=pendingBlasts.filter(b=>b.t>0);
  for (const b of due) {
    if (tile(b.x,1,b.z)!==15) continue;
    for (let y=1;y<Y && tile(b.x,y,b.z)===15;y++) { world[index(b.x,y,b.z)]=0; markDirty(b.x,y,b.z); }
    integrityTimer=integrityTimer||.05;
    run.drums=(run.drums||0)+1;
    explode({x:b.x+.5,y:2,z:b.z+.5,cx:b.x+.5,cy:2,cz:b.z+.5,carve:2.2,reach:7.5,damage:95,guardR:5.5,
      cause:"Too close to a fuel drum when it went up."});
    if (phase!=="playing") return;
  }
}

// ===== Grenades: lobbed in a low arc, bounce, and go off after a short fuse =====
const GRENADES=3, GRENADE_FUSE=2.2, GRENADE_GRAVITY=16;
let grenades=[], grenadeCount=GRENADES, throwCool=0;
function throwGrenade() {
  if (phase!=="playing" || throwCool>0) return;
  if (!grenadeCount) { say("NO GRENADES LEFT"); return; }
  grenadeCount--; throwCool=.7;
  const [dx,dy,dz]=direction();
  // a soft underhand lob: modest speed plus a little lift, so it carries about a room or two
  const sx=player.x+dx*.5, sz=player.z+dz*.5, sy=player.eye-.35;
  grenades.push({x:canStand(sx,sz,player.eye)?sx:player.x,y:sy,z:canStand(sx,sz,player.eye)?sz:player.z,
    vx:dx*12.5,vy:dy*12.5+4,vz:dz*12.5,fuse:GRENADE_FUSE,spin:0});
  tone(260,.08,.05,"triangle",180);
  say("GRENADE OUT");
}
function updateGrenades(dt) {
  throwCool=Math.max(0,throwCool-dt);
  for (const g of grenades) {
    g.fuse-=dt; g.spin+=dt*12;
    const steps=4, h=dt/steps;
    for (let k=0;k<steps;k++) {
      g.vy-=GRENADE_GRAVITY*h;
      // move one axis at a time and bounce off whatever face it hits, losing energy
      const nx=g.x+g.vx*h;
      if (tile(Math.floor(nx),Math.floor(g.y),Math.floor(g.z))) { g.vx*=-.45; g.vz*=.8; clink(g); } else g.x=nx;
      const nz=g.z+g.vz*h;
      if (tile(Math.floor(g.x),Math.floor(g.y),Math.floor(nz))) { g.vz*=-.45; g.vx*=.8; clink(g); } else g.z=nz;
      const ny=g.y+g.vy*h;
      if (tile(Math.floor(g.x),Math.floor(ny),Math.floor(g.z))) {
        if (g.vy<0) { g.vx*=.62; g.vz*=.62; }
        g.vy=Math.abs(g.vy)>1.5?-g.vy*.38:0; clink(g);
      } else g.y=ny;
    }
    if (g.fuse<=0) {
      g.dead=true;
      explode({x:g.x,y:g.y+.3,z:g.z,cx:g.x,cy:g.y+.3,cz:g.z,carve:0,reach:6.5,damage:85,guardR:4.6,
        cause:"Your own grenade got you. Throw it further."});
      if (phase!=="playing") return;
    }
  }
  grenades=grenades.filter(g=>!g.dead);
}
function clink(g) {
  const speed=Math.hypot(g.vx,g.vy,g.vz);
  if (speed<1.2 || g.lastClink>0) return;
  g.lastClink=.12;
  const v=Math.max(.01,.05*Math.max(0,1-Math.hypot(player.x-g.x,player.z-g.z)/30));
  tone(1400+Math.random()*300,.04,v,"square",900);
  setTimeout(()=>g.lastClink=0,120);
}

// ===== Campaign: an endless run of fresh procedural bases, one after another =====
// Every extraction moves you to a new base with its own theme: look, weather and a twist on the rules.
// Bases also get a little tougher each level (more soldiers, sharper eyes).
// paint: concrete hue/sat/light ranges and floor/yard [h,s,l]. plan: options for planLayout.
// rules: sight/hear multiply guard senses, garrison adds soldiers, charges sets the breach kit,
// caution starts the base on CAUTION, moss grows on the walls.
const THEMES=[
  {id:"relay", name:"RELAY STATION", brief:"A standard concrete relay post. Find the intel, get it back to the pad.",
    moods:["day","overcast","dusk"], plan:{}, rules:{}},
  {id:"arctic", name:"ARCTIC OUTPOST", brief:"Snow on every floor. Your footsteps crunch, so guards hear you from further off. Crouch more.",
    moods:["overcast","day","night"], paint:{hue:[195,220],sat:[.04,.1],light:[.6,.7],floor:[205,.12,.8],yard:[205,.1,.84],accent:0},
    plan:{yards:2}, rules:{hear:1.6}},
  {id:"desert", name:"DESERT DEPOT", brief:"Sun-baked yards and wide windows. Long sight lines work both ways: guards see further here.",
    moods:["day","smog"], paint:{hue:[28,42],sat:[.14,.24],light:[.56,.66],floor:[36,.22,.5],yard:[38,.3,.58]},
    plan:{yards:2, windows:.3}, rules:{sight:1.15}},
  {id:"night", name:"NIGHT RAID", brief:"Lights out, goggles on. Guards can't see as far in the dark, but there are more of them on shift.",
    moods:["night"], nvg:true, plan:{windows:.2}, rules:{sight:.72, garrison:3}},
  {id:"vault", name:"DEEP VAULT", brief:"A hardened bunker: reinforced walls everywhere, each needing two charges. You get extra charges.",
    moods:["overcast","smog","night"], paint:{sat:[.02,.05],light:[.44,.52]}, plan:{reinforced:.5, windows:.06, vents:5}, rules:{charges:14}},
  {id:"lockdown", name:"LOCKDOWN", brief:"They already know something's up: the base starts on CAUTION and the fuel drums are everywhere.",
    moods:["dusk","smog","night"], paint:{accent:0}, plan:{fuel:.8}, rules:{caution:true}},
  {id:"overgrown", name:"OVERGROWN DEPOT", brief:"Abandoned and half reclaimed by moss. Barred gates, windows and crawl vents all over.",
    moods:["dusk","overcast","day","smog"], paint:{hue:[70,110],sat:[.05,.12]}, plan:{vents:6, gates:.85, windows:.28}, rules:{moss:true}},
];
let theme=THEMES[0];
let campaign={level:1,total:0,time:0,cleared:0};
function pickTheme() {
  if (campaign.level===1) return THEMES[0];
  const pool=THEMES.filter(t=>t!==theme);
  return pool[Math.floor(Math.random()*pool.length)];
}
const rule=(k,d)=>theme.rules[k]??d;
// difficulty that builds level by level, on top of the theme
const levelSight=()=>1+Math.min(.2,(campaign.level-1)*.025);
const levelGarrison=()=>Math.min(6,Math.floor((campaign.level-1)/2));
function showBriefing() {
  document.querySelector("#op-line").textContent="LEVEL "+campaign.level+" / "+theme.name;
  title.textContent=campaign.level===1?"BUNKER BUSTER":theme.name;
  brief.textContent=campaign.level===1?brief.dataset.intro:theme.brief+(campaign.total?"  Run total so far: "+campaign.total.toLocaleString()+".":"");
  deploy.textContent="DEPLOY";
  endRunBtn.hidden=true;
}
const endRunBtn=document.querySelector("#endrun");
brief.dataset.intro=brief.textContent;

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
  const r=scoreRun(won);
  campaign.time+=run.time;
  if (won) { campaign.total+=r.total; campaign.cleared++; }
  document.querySelector("#op-line").textContent="LEVEL "+campaign.level+" / "+theme.name;
  if (won) {
    title.textContent="LEVEL "+campaign.level+" CLEAR";
    brief.textContent="Intel secured in "+fmtTime(run.time)+". Push on to a new base, or end the run here and post your total.";
    deploy.textContent="NEXT LEVEL ›";
    endRunBtn.hidden=false;
  } else {
    title.textContent="MISSION FAILED";
    brief.textContent=(why||"You were hit before reaching extraction.")+" Run over: "+campaign.cleared+" level"+(campaign.cleared===1?"":"s")+" cleared.";
    deploy.textContent="NEW RUN";
    endRunBtn.hidden=true;
  }
  if (document.pointerLockElement===screen) document.exitPointerLock();
  showResults(r,!won);
}
// Ending a run on your own terms after a win: the run total goes to the board.
function endRun() {
  if (phase!=="won") return;
  phase="ended";
  title.textContent="RUN COMPLETE";
  brief.textContent=campaign.cleared+" level"+(campaign.cleared===1?"":"s")+" cleared in "+fmtTime(campaign.time)+".";
  deploy.textContent="NEW RUN"; endRunBtn.hidden=true;
  showResults(lastResult,true);
}

// ===== Global leaderboard (shared JSON bin, same setup as the other games) =====
// Entries: [initials, run total, seconds played, levels cleared]. Ranked by score.
// (Older single-mission entries stored won as 1/0, which reads the same: 1 level or KIA.)
const LB_URL = "https://json.extendsclass.com/bin/26db85ce0e56";
const LB_SIZE = 10;
let board = [], lbOnline = false, lastResult = null, justAdded = null;
const resultsEl=document.querySelector("#results"), entryEl=document.querySelector("#entry"),
  initialsEl=document.querySelector("#initials"), boardEl=document.querySelector("#board");
function cleanBoard(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(r=>Array.isArray(r) && typeof r[0]==="string" && Number.isFinite(r[1]))
    .map(r=>[r[0].toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,3)||"???",Math.max(0,Math.round(r[1])),+r[2]||0,Math.max(0,Math.min(999,Math.round(+r[3]||0)))])
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
  // The bin host sometimes tacks a web page onto the end of the reply, so read only the JSON part.
  try {
    const text=await (await lbRequest({})).text(), cut=text.indexOf("<");
    board=cleanBoard(JSON.parse(cut<0?text:text.slice(0,cut))); lbOnline=true;
  }
  catch { lbOnline=false; }
}
const qualifies=score=>score>0 && (board.length<LB_SIZE || score>board[board.length-1][1]);
function renderBoard() {
  const rows=[];
  for (let i=0;i<LB_SIZE;i++) {
    const r=board[i];
    const mine=r && justAdded && r[0]===justAdded[0] && r[1]===justAdded[1] && r[2]===justAdded[2];
    rows.push(`<li${mine?' class="mine"':""}><span>${String(i+1).padStart(2," ")}.</span><b>${r?r[0]:"---"}</b>`+
      `<em>${r?(r[3]?r[3]+" LVL · "+fmtTime(r[2]):"KIA"):""}</em><strong>${r?r[1].toLocaleString():""}</strong></li>`);
  }
  boardEl.innerHTML=`<div class="eyebrow">GLOBAL TOP ${LB_SIZE}${lbOnline?"":" · offline, showing last known"}</div><ol>${rows.join("")}</ol>`;
  boardEl.hidden=false;
}
async function showResults(r,final) {
  lastResult=r; justAdded=null;
  const row=(a,b,c,cls="")=>`<tr class="${cls}"><td>${a}</td><td>${b}</td><td>${c}</td></tr>`;
  resultsEl.innerHTML=`<table>`+
    r.lines.map(l=>row(l[0],l[1],l[2].toLocaleString())).join("")+
    row("Subtotal","",r.subtotal.toLocaleString(),"sub")+
    row("Damage taken",r.damage+" HP → −"+Math.min(100,r.damage)+"%",(r.penalty?"−":"")+r.penalty.toLocaleString(),r.penalty?"pen":"")+
    row("Level "+campaign.level+" score","",r.total.toLocaleString(),"sub")+
    row("RUN TOTAL",campaign.cleared+" level"+(campaign.cleared===1?"":"s"),campaign.total.toLocaleString(),"total")+`</table>`;
  resultsEl.hidden=false; entryEl.hidden=true; overlay.querySelector("article").classList.add("scored");
  boardEl.hidden=false; boardEl.innerHTML=`<div class="eyebrow">GLOBAL TOP ${LB_SIZE} · loading…</div>`;
  await fetchBoard();
  if (lastResult!==r) return;
  renderBoard();
  if (final && qualifies(campaign.total)) {
    entryEl.hidden=false; initialsEl.value=""; 
    if (!touchDevice) initialsEl.focus();
  }
}
async function submitInitials() {
  const r=lastResult; if (!r || entryEl.hidden) return;
  const name=initialsEl.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,3);
  if (!name) { initialsEl.focus(); return; }
  entryEl.hidden=true;
  const entry=[name,campaign.total,Math.round(campaign.time*100)/100,campaign.cleared];
  await fetchBoard();                       // merge with the freshest list right before writing
  board=cleanBoard(board.concat([entry])); justAdded=entry;
  if (lbOnline) {
    try { await lbRequest({method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(board)}); }
    catch { lbOnline=false; }
  }
  renderBoard();
}
document.querySelector("#entry-save").addEventListener("click",submitInitials);
document.querySelector("#endrun").addEventListener("click",endRun);
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
  touchLookStep(dt);
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
  if (phase!=="playing") return;
  updateGrenades(dt);
  if (phase!=="playing") return;
  updateBlasts(dt);
  if (phase!=="playing") return;
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

  separateGuards();
  updateReport(dt);
  if (!hasIntel && Math.hypot(player.x-intel.x,player.z-intel.z)<1.9) {
    hasIntel=true;
    say("INTEL SECURED. RETURN TO THE GREEN PAD.");
    tone(500,.24,.1,"triangle",780);
  }
  if (hasIntel && Math.hypot(player.x-extraction.x,player.z-extraction.z)<2.6) finish(true);
  for (const p of particles) {
    p.x+=p.vx*dt; p.y+=p.vy*dt; p.z+=p.vz*dt; p.life-=dt;
    if (p.smoke) { p.vx*=1-dt*.6; p.vz*=1-dt*.6; p.vy=Math.max(.15,p.vy-dt*.05); }
    else p.vy-=(p.dust?.25:12)*dt;
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
        const m=tile(Math.floor(b.x),Math.floor(b.y),Math.floor(b.z));
        if (!SHAPE[m]) addDecal(Math.floor(b.x),Math.floor(b.y),Math.floor(b.z),b.x,b.y,b.z,.07);
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
const isDyn=m=>m===2||m===7, isAnchor=m=>m===1||m===3||m===6||m>=8;
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
    markDirty(i%X,Math.floor(i/(X*Z)),Math.floor(i/X)%Z);
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
      if (Math.random()<.45 && clear && !tile(fx,cell,fz) && cell<Y) { world[index(fx,cell,fz)]=7; markDirty(fx,cell,fz); integrityTimer=integrityTimer||.06; }
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
      for (let iy=1;iy<=2;iy++) if (tile(ix,iy,iz)===7) { world[index(ix,iy,iz)]=0; markDirty(ix,iy,iz); k++; burst(ix+.5,iy+.5,iz+.5,2); }
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
// Reporting window: a guard who spots you needs REPORT_TIME to get the alert out. Kill everyone who saw you
// inside that window and the alert is called off, as if it never happened. Reinforcements wait for the report.
const REPORT_TIME=1;
let report=null;   // {timer, reporters:Set, level, timer0, noise}
const alertEl=document.querySelector("#alertbar");

function makeGuard(x,z,cell,yaw) {
  return {x,z,cell,yaw,hp:2,gait:0,pace:0,impact:0,fall:0,shot:1.5,aim:0,spot:0,muzzle:0,query:0,saw:false,
    task:"idle",wait:1+Math.random()*3,goal:null,field:null,look:Math.random()};
}
function canSee(g,dx,dz,dist,crouched) {
  const P=PHASE[alertLevel];
  // sentries at a post watch a long sight line; crouching still helps
  const range=P.range*(crouched && alertLevel<ALERT?.62:1)*(g.post && g.task==="post"?1.3:1)*rule("sight",1)*levelSight();
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
    if (!report) {
      say("!! ALERT !!  REINFORCEMENTS INBOUND");
      for (let k=0;k<3;k++) { tone(880,.16,.06,"square",880,k*.36); tone(660,.16,.06,"square",660,k*.36+.18); }
      if (!reinforced) { reinforced=true; spawnReinforcements(); }
    } else say("SPOTTED · SILENCE HIM BEFORE HE REPORTS");
  } else if (level===EVASION) say(rising?"EVASION · THEY KNOW YOU'RE HERE":"EVASION · THEY LOST YOU");
  else if (level===CAUTION) say(rising?"CAUTION · SOMETHING WAS HEARD":"CAUTION · STAND DOWN SOON");
  else { say("UNDETECTED"); reinforced=false; }
}
function raiseTo(level,x,z) {
  if (x!==undefined) lastKnown={x,z};
  if (level>=alertLevel) setPhase(level);
}
function spottedBy(g) {
  if (alertLevel<ALERT) {
    report={timer:REPORT_TIME, reporters:new Set([g]), level:alertLevel, timer0:alertTimer, lastKnown, noise:null};
    lastKnown={x:player.x,z:player.z};
    setPhase(ALERT);
    return;
  }
  lastKnown={x:player.x,z:player.z};
  alertTimer=PHASE[ALERT].time;
  if (report) report.reporters.add(g);       // anyone else who sees you in the window is a witness too
}
function updateReport(dt) {
  if (!report) return;
  if (![...report.reporters].some(g=>g.hp)) {
    // every witness died before the word got out: back to how things were
    const r=report; report=null;
    alertLevel=r.level; alertTimer=r.level?r.timer0:0; lastKnown=r.lastKnown;
    for (const g of guards) if (g.hp) { g.task="idle"; g.wait=.4+Math.random(); g.goal=null; g.saw=false; }
    say("REPORTER SILENCED · ALERT CALLED OFF");
    tone(300,.18,.05,"triangle",180);
    if (r.noise) makeNoise(r.noise.x,r.noise.z,r.noise.radius,r.noise.kind);   // shots fired still get heard
    return;
  }
  report.timer-=dt;
  if (report.timer<=0) {
    report=null;
    say("!! ALERT !!  REINFORCEMENTS INBOUND");
    for (let k=0;k<3;k++) { tone(880,.16,.06,"square",880,k*.36); tone(660,.16,.06,"square",660,k*.36+.18); }
    if (!reinforced) { reinforced=true; spawnReinforcements(); }
  }
}
// Guards keep a body's width apart so a group never collapses into one sprite.
const GUARD_SPACING=1.15;
function separateGuards() {
  const live=guards.filter(g=>g.hp);
  for (let i=0;i<live.length;i++) for (let j=i+1;j<live.length;j++) {
    const a=live[i], b=live[j];
    let dx=b.x-a.x, dz=b.z-a.z, d=Math.hypot(dx,dz);
    if (d>=GUARD_SPACING) continue;
    if (d<1e-3) { const t=Math.random()*Math.PI*2; dx=Math.sin(t); dz=Math.cos(t); d=1; }
    else { dx/=d; dz/=d; }
    const push=(GUARD_SPACING-Math.min(d,GUARD_SPACING))*.5;
    move(a,-dx*push,-dz*push,4.3);
    move(b,dx*push,dz*push,4.3);
  }
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
  if (report && kind!=="step") report.noise={x,z,radius,kind};
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
    const r=PHASE[alertLevel].hear*rule("hear",1);
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
  if (g.post && alertLevel===UNDETECTED) {
    // sentry: walk back to the post if pulled away, then slowly sweep the arc in front of it
    if (Math.hypot(g.x-g.post.x,g.z-g.post.z)>1) {
      g.postField??=flowField(g.post.x,g.post.z);
      if (!followField(g,g.postField,P.speed,dt,0)) return;
    }
    g.task="post"; g.scan=(g.scan||0)+dt;
    g.yaw=g.post.yaw+Math.sin(g.scan*.45)*.85;
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

let depth = new Float32Array(width*height);
const ray = {};
const focal = height*145/126;   // tied to height so wide screens see more, not zoom in
const dustColor=[156,130,101], rubbleColor=[190,152,104];
const groundFog=[54,69,71];
let textures;
const textureSize = 64;

// ===== TEXTURES (pure; godot/tools/asset-export.js runs this block on its own) =====
// 64x64 material maps, 16 texels per voxel, so each tile spans 4x4 voxels. Large-scale detail
// (stains, seams, cracks, stripes, pipes) is added in world space while rendering, so walls don't repeat.
function buildTextures() {
  const hash=(x,y,s)=>((Math.imul(x+s*31,73856093)^Math.imul(y+s*17,19349663)^Math.imul(s,83492791))>>>0)/4294967296;
  // tileable value noise: cell size c texels, wraps at 64
  const vnoise=(x,y,c,s)=>{
    const n=64/c, gx=x/c, gy=y/c, x0=Math.floor(gx), y0=Math.floor(gy), fx=gx-x0, fy=gy-y0;
    const sx=fx*fx*(3-2*fx), sy=fy*fy*(3-2*fy);
    const v=(i,j)=>hash(((i%n)+n)%n,((j%n)+n)%n,s+c);
    return (v(x0,y0)*(1-sx)+v(x0+1,y0)*sx)*(1-sy)+(v(x0,y0+1)*(1-sx)+v(x0+1,y0+1)*sx)*sy;
  };
  const fbm=(x,y,s)=>vnoise(x,y,32,s)*.45+vnoise(x,y,16,s)*.3+vnoise(x,y,8,s)*.15+vnoise(x,y,4,s)*.1;
  const mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
  const rust=[118,64,38], rustDk=[72,40,26];
  return colors.map((base,id)=>{
    const data=new Uint8Array(textureSize*textureSize*3);
    for (let y=0;y<64;y++) for (let x=0;x<64;x++) {
      const n=fbm(x,y,id), fine=hash(x,y,id+50), k0=.82+.3*n;
      let c=base.map(v=>v*k0);
      if (id===1) {
        // poured slab: trowel swirl, pits, a saw-cut joint every 4 voxels, scuffs
        c=base.map(v=>v*(.86+.24*n+(fine-.5)*.1));
        if (fine<.05) c=c.map(v=>v*.72);
        if (x===0 || y===0) c=c.map(v=>v*.62); else if (x===1 || y===1) c=c.map(v=>v*1.06);
        if (Math.abs(((x*.7+y*.3+vnoise(x,y,16,9)*20)%23)-11)<.6 && vnoise(x,y,8,5)>.55) c=c.map(v=>v*.88);
      } else if (id===2 || id===7) {
        // cast concrete: cloudy curing marks, air pockets, aggregate speckle
        const blot=vnoise(x,y,8,31)*.5+vnoise(x,y,4,32)*.5;
        c=base.map(v=>v*(.84+.2*n+(blot-.5)*.08+(fine-.5)*.1));
        if (fine<.035) c=c.map(v=>v*.58); else if (fine>.97) c=c.map(v=>v*1.13);
        if (id===7) { c=c.map(v=>v*(.85+fine*.3)); if (fine<.12) c=c.map(v=>v*.7); }
      } else if (id===3) {
        // corrugated steel cladding with rust blooms
        const wave=Math.sin(x/8*Math.PI*2);
        c=base.map(v=>v*(.78+.18*wave+.12*n));
        const r=vnoise(x,y,16,21)*.7+vnoise(x,y,4,22)*.3;
        if (r>.56) c=mix(c,r>.66?rustDk:rust,Math.min(1,(r-.56)*5)*.85);
        if (wave>.92) c=c.map(v=>v*1.12);
        if (x===0 && (y&15)===8) c=[200,196,180];
      } else if (id===4) {
        // non-slip green deck paint, worn to grey at the grit
        c=[36,114,83].map(v=>v*(.84+.26*n));
        if (fine<.12) c=mix(c,[120,124,110],.5);
      } else if (id===6) {
        // olive ammo crate: planks, darker frame, rope handle, stencilled band
        const lx=x&15, ly=y&15;
        c=base.map(v=>v*(.88+.15*n+(hash(lx>>2,y>>4,4)-.5)*.1));
        if ((ly&3)===0) c=c.map(v=>v*.82);
        if (lx<2 || lx>13 || ly<2 || ly>13) c=base.map(v=>v*(lx===0||ly===0?.55:.75));
        if (ly>=6 && ly<=8 && lx>=4 && lx<=11 && ((lx+ly*3)%4!==0)) c=[196,168,74];
        if (ly===11 && lx>5 && lx<10) c=[120,100,66];
        if (fine<.06) c=c.map(v=>v*.8);
      } else if (id===8) {
        // burlap weave
        const weave=((x+(y>>1))&1)?1.06:.92;
        c=base.map(v=>v*weave*(.85+.25*n));
        if (fine<.08) c=c.map(v=>v*.82);
      } else if (id===9 || id===15) {
        // painted steel drum: two rolling hoops, chipped paint, rust at the rims
        const ly=y&31, hoop=ly===7||ly===8||ly===23||ly===24;
        c=base.map(v=>v*(.86+.2*n)*(hoop?(ly&1?.7:1.2):1));
        if (ly<2 || ly>29) c=mix(c,rust,.6);
        if (vnoise(x,y,8,40)>.7) c=mix(c,rust,.7);
        if (id===9 && ly>12 && ly<19 && (x&15)>3 && (x&15)<12) c=palette.stripe.map(v=>v*.85);
        if (id===15 && ly>10 && ly<21) {
          // fuel drum: white band with a black flame diamond
          const lx=x&15, dd=Math.abs(lx-7.5)+Math.abs(ly-15.5);
          c=dd<4.2?(dd<3.2?[34,30,28]:[220,214,200]):[214,206,190];
        }
      } else if (id===10) {
        // reinforced concrete: smooth panels, steel edge bands and anchor bolts
        const lx=x&31, ly=y&31;
        c=base.map(v=>v*(.9+.14*n+(fine-.5)*.05));
        if (lx===0 || ly===0) c=c.map(v=>v*.6); else if (lx===1 || ly===1) c=c.map(v=>v*1.1);
        const bx=Math.min(Math.abs(lx-4),Math.abs(lx-27)), by=Math.min(Math.abs(ly-4),Math.abs(ly-27));
        if (bx<=1 && by<=1) c=bx+by===0?[176,178,180]:[70,72,74];
        else if (bx===0 && ly>5 && ly<10 && vnoise(x,y,4,12)>.6) c=mix(c,rust,.2);
      } else if (id===11) {
        c=base.map(v=>v*(.8+.4*n));
        if (vnoise(x,y,8,60)>.6) c=mix(c,rust,.6);
      } else if (id===12) {
        // asphalt with gravel showing through, patched in places
        c=base.map(v=>v*(.85+.22*n));
        if (fine>.9) c=c.map(v=>v*1.45); else if (fine<.1) c=c.map(v=>v*.75);
        if (vnoise(x,y,32,70)>.68) c=c.map(v=>v*.85);
      } else if (id===13) {
        // painted truck panels: seams, rivets, faded paint
        const lx=x&15, ly=y&15;
        c=base.map(v=>v*(.86+.2*n));
        if (lx===0) c=c.map(v=>v*.6);
        if (ly===2 && (lx&3)===2) c=c.map(v=>v*1.3);
        if (fine<.05) c=c.map(v=>v*.82);
      } else if (id===14) {
        c=base.map(v=>v*(.75+.4*n));
        if (fine>.97) c=[90,96,100];
      }
      const o=(y*64+x)*3;
      for (let i=0;i<3;i++) data[o+i]=Math.min(255,Math.max(0,c[i]));
    }
    return data;
  });
}
// ===== END TEXTURES =====
// Crack overlay: a few jagged fractures drawn once, then scattered over wall blocks in world space.
// 0 = clean, 1 = crack, 2 = chipped lip beside it.
const crackMask=(()=>{
  const m=new Uint8Array(64*64);
  let s=7;
  const rnd=()=>{ s=(Math.imul(s,1103515245)+12345)>>>0; return s/4294967296; };
  const walk=(x,y,dx,dy,len,branch)=>{
    for (let i=0;i<len;i++) {
      x+=dx+(rnd()-.5)*1.4; y+=dy+(rnd()-.5)*.6;
      const ix=Math.round(x), iy=Math.round(y);
      if (ix<1 || iy<1 || ix>62 || iy>62) return;
      m[iy*64+ix]=1;
      if (rnd()<.5) m[iy*64+ix+1]=1;
      if (!m[iy*64+ix-1]) m[iy*64+ix-1]=2;
      if (branch && rnd()<.06) walk(x,y,dx*.4+(rnd()<.5?-.8:.8),dy,8+rnd()*14,false);
    }
  };
  walk(30,2,.15,1,60,true); walk(10,40,.9,.5,26,true); walk(52,20,-.3,1,26,false);
  return m;
})();

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
  pad:[44,48,40],boot:[78,64,46],bootHi:[104,86,62],webbing:[48,54,40],gun:[30,33,32],gunHi:[70,76,74],flash:[255,224,130]};
function ellipse(u,v,cu,cv,ru,rv){return ((u-cu)/ru)**2+((v-cv)/rv)**2<1;}
// fabric: a four-colour woodland-style camouflage with fold shading; skin tones vary per soldier
const CAMO=[[104,106,78],[80,86,60],[116,100,74],[52,56,42]];
function fab(u,v,look,k) {
  const a=Math.sin(u*31+look*9+Math.sin(v*17)*1.5)+Math.sin(v*23-u*7+look*5), b=Math.sin(u*13-v*29+look*3);
  const c=a>1.15?CAMO[3]:a>.4?CAMO[1]:b>.6?CAMO[2]:CAMO[0];
  const fold=1-.13*Math.max(0,Math.sin(v*64+u*14+look*4))**3;
  return [c[0]*k*fold,c[1]*k*fold,c[2]*k*fold];
}
const SKINS=[[198,150,110],[172,122,86],[134,92,62],[96,66,46]];
function skin(look,k) { const c=SKINS[Math.floor(look*4)%4]; return [c[0]*k,c[1]*k,c[2]*k]; }
function guardPixel(view,u,v,firing,step,aim=0,look=.5) {
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
        if (v>.91) return v>.972?[24,22,20]:v<.93?G.bootHi:G.boot;
        if (v>.71 && v<.77) return G.pad;
        const dk=side?k===0:k===1;
        return d>.05?fab(u,v+.37,look,.76):dk?fab(u,v+.37,look,.76):fab(u,v+.37,look,1);
      }
    }
    if (v<.6 && (side?Math.abs(h-.48)<.12:c<.17)) return fab(u,v+.37,look,1);
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
    if (aim>0 ? (h>.47 && h<.66 && v>.24 && v<.34) : (h>.47 && h<.64 && v>.24 && v<.43 && (v-.24)*.9>(h-.5)*.6-.02)) return h<.52?fab(u,v,look,.76):fab(u,v,look,1);
    if (v<.1 && ellipse(h,v,.53,.075,.12,.072)) return v<.04?G.helmetHi:fab(h,v,look,.82);
    if (v>=.095 && v<.108 && h>.42 && h<.67) return G.strap;
    if (v>=.108 && v<.205 && h>.44 && h<.63+(v>.14 && v<.165?.02:0)) {   // profile with nose
      if (h<.49) return skin(look,.8);
      if (h>.54 && h<.57 && v<.142 && v>.118) return v<.125?[58,42,30]:(aim>0||firing?[150,20,16]:[26,24,22]);
      if (h>.58 && v>.176 && v<.184) return [104,52,44];
      return h>.6?skin(look,1.1):skin(look,1);
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
    return fab(u,v,look,.82);   // cloth helmet cover
  }
  if (v>=.095 && v<.108 && c<.13) return G.strap;  // brim
  const jaw=.088-Math.max(0,v-.17)*1.4;
  if (v>=.108 && v<.205 && c<jaw) {
    if (view==="back") return v<.13?G.strap:skin(look,.8);
    if (c>jaw-.012) return v<.16?G.strap:skin(look,.8);        // chin strap / cheek shadow
    const angry=aim>0 || firing;
    if (v>.118 && v<.128 && c>.016 && c<.068 && (!angry || v-.118>(.068-c)*.18)) return [58,42,30]; // brows
    if (v>.13 && v<.146 && c>.022 && c<.064) {                // eyes
      if (c>.036 && c<.05) return angry?[150,20,16]:[26,24,22];
      return [232,226,212];
    }
    if (v>.14 && v<.168 && c<.011) return v>.16?skin(look,.8):skin(look,1.1); // nose
    if (v>.176 && v<.184 && c<.032) return [104,52,44];       // mouth
    if (v>.186 && c<.05) return skin(look,.9);                 // chin
    return c>.06?skin(look,.8):skin(look,1);
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
      if (arm) return v<.36?(u<.5?fab(u,v,look,1):fab(u,v,look,.76)):(u<.5?fab(u,v,look,1):fab(u,v,look,.76));
      if (u>.36 && u<.56 && v>.28 && v<.34) return skin(look,.8);   // support hand
    }
    if (view==="front") {
      // rifle across chest
      const rv=.42+(u-.5)*.12;
      if (!aim && u>.16 && u<.86 && Math.abs(v-rv)<(u<.27?.034:.022)) {      // stock end is thicker
        return v<rv-.01?G.gunHi:G.gun;
      }
      if (!aim && u>.47 && u<.54 && v>rv && v<rv+.075-(u-.47)*.4) return G.gun;      // magazine
      if (arm) {
        if (v>.38 && v<.46) return skin(look,.8); // gloves near weapon
        return u<.5?fab(u,v,look,1):fab(u,v,look,.76);
      }
      if (v>.525) return c<.03?G.buckle:G.belt;
      if (c<.19 && v>.23 && v<.52) {
        if (v>.44 && v<.51 && Math.abs((c%.065)-.032)<.026) return v<.452?G.pouchDk:G.pouch;
        if (v>.25 && v<.29 && c<.05) return [40,46,36];
        if (c>.165) return G.pouchDk;
        return ((v*110)|0)%3===0?G.webbing:G.vest;   // MOLLE webbing rows
      }
      return fab(u,v,look,1);
    }
    // back: backpack
    if (arm) return v>.5?skin(look,.8):(u<.5?fab(u,v,look,1):fab(u,v,look,.76));
    if (v>.525) return G.belt;
    if (c<.15 && v>.24 && v<.5) {
      if (v<.27 || Math.abs(c-.1)<.012) return G.pouchDk;
      return v>.4?G.pouchDk:G.pouch;
    }
    return G.vest;
  }
}

// downed guard lying on his side: helmet left, boots right, rifle dropped beside him
function corpsePixel(u,v,pose=0,look=.5) {
  if (u<0||u>1||v<0||v>1) return;
  if (pose===1) u=1-u;                                                                   // fell the other way
  if (pose===2) {                                                                        // face down, one arm flung past the head
    if (u>.0 && u<.2 && v>.06 && v<.2) return u<.05?skin(look,.8):fab(u,v,look,.76);
    if (u>.6 && v<.36 && v>.18 && u<.88) return u>.84?G.boot:fab(u,v+.37,look,.76);  // splayed leg
  }
  if (v>.82 && u>.18 && u<.86 && Math.abs(v-.9)<.04) return u<.3?G.gunHi:G.gun;       // dropped rifle
  if (ellipse(u,v,.09,.55,.075,.3)) return v<.4?G.helmetHi:G.helmet;
  if (u>.13 && u<.2 && v>.42 && v<.82) return v>.5&&v<.6?skin(look,1):skin(look,.8);               // face/neck
  if (u>=.18 && u<.55 && v>.3 && v<.86) {
    if (u>.5) return G.belt;
    if (v<.42 && u>.24 && u<.48) return G.pouchDk;
    return v<.5?G.vest:G.pouch;
  }
  if (u>=.55 && u<.92 && v>.38 && v<.84) {
    if (u>.86) return G.boot;
    if (u>.68 && u<.73) return G.pad;
    return v<.6?fab(u,v+.37,look,1):fab(u,v+.37,look,.76);
  }
  if (u>.22 && u<.44 && v>.78 && v<.92) return fab(u,v,look,.76);                                // arm
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

// ===== Light: sun with real shadows, sky ambient, wall lamps, ambient occlusion =====
// Sun visibility is cached per quarter-voxel and worked out lazily the first time a pixel needs it.
// Any change to the grid clears the cache over the region whose shadows it could affect.
const SQ=4, sunVis=new Uint8Array(X*SQ*Y*SQ*Z*SQ).fill(255);
const shadowRay={};
let dirty=null;
function markDirty(x,y,z) {
  if (!dirty) dirty={x0:x,y0:y,z0:z,x1:x,y1:y,z1:z};
  else { dirty.x0=Math.min(dirty.x0,x); dirty.y0=Math.min(dirty.y0,y); dirty.z0=Math.min(dirty.z0,z);
    dirty.x1=Math.max(dirty.x1,x); dirty.y1=Math.max(dirty.y1,y); dirty.z1=Math.max(dirty.z1,z); }
}
function applyDirty() {
  if (!dirty) return;
  const [sx,sy,sz]=palette.sunDir, reach=Y/Math.max(.2,sy);
  // a voxel shades points down-sun of it, so stretch the box away from the sun
  const x0=Math.max(0,Math.floor((dirty.x0+Math.min(0,-sx*reach)-1)*SQ)), x1=Math.min(X*SQ,Math.ceil((dirty.x1+1+Math.max(0,-sx*reach)+1)*SQ));
  const z0=Math.max(0,Math.floor((dirty.z0+Math.min(0,-sz*reach)-1)*SQ)), z1=Math.min(Z*SQ,Math.ceil((dirty.z1+1+Math.max(0,-sz*reach)+1)*SQ));
  const y1=Math.min(Y*SQ,(dirty.y1+2)*SQ), XS=X*SQ, ZS=Z*SQ;
  for (let y=0;y<y1;y++) for (let z=z0;z<z1;z++) { const row=(y*ZS+z)*XS; sunVis.fill(255,row+x0,row+x1); }
  dirty=null;
}
function sunlit(x,y,z) {
  const qx=Math.floor(x*SQ), qy=Math.floor(y*SQ), qz=Math.floor(z*SQ);
  if (qx<0 || qy<0 || qz<0 || qx>=X*SQ || qy>=Y*SQ || qz>=Z*SQ) return 1;
  const i=(qy*Z*SQ+qz)*X*SQ+qx;
  let v=sunVis[i];
  if (v===255) {
    const [sx,sy,sz]=palette.sunDir;
    v=sunVis[i]=trace(x,y,z,sx,sy,sz,40,shadowRay)?0:1;
  }
  return v;
}
// Lamps: each floor column keeps the short list of lamps that can reach it.
let lampField=[];
function buildLampField() {
  lampField=new Array(X*Z);
  lamps.forEach((L,n)=>{
    for (let z=Math.max(0,Math.floor(L.z-L.r));z<=Math.min(Z-1,L.z+L.r);z++)
      for (let x=Math.max(0,Math.floor(L.x-L.r));x<=Math.min(X-1,L.x+L.r);x++)
        (lampField[z*X+x]??=[]).push(n);
  });
}
let LR=0, LG=0, LB=0;
// light arriving at a point (sun + sky + lamps) -> LR, LG, LB
const XQ=X*SQ, YQ=Y*SQ, ZQ=Z*SQ;
function lightAt(px,py,pz,nx,ny,nz,ao,sun) {
  const S=palette.sunDir, A=palette.amb, C=palette.sun;
  const amb=(.64+.36*ny)*ao;
  const ndl=nx*S[0]+ny*S[1]+nz*S[2];
  let direct=0;
  if (ndl>0 && sun) {
    const x=px+nx*.04, y=py+ny*.04, z=pz+nz*.04;
    const qx=(x*SQ)|0, qy=(y*SQ)|0, qz=(z*SQ)|0;
    if (qx<0 || qy<0 || qz<0 || qx>=XQ || qy>=YQ || qz>=ZQ) direct=ndl;
    else {
      const i=(qy*ZQ+qz)*XQ+qx;
      let v=sunVis[i];
      if (v===255) v=sunVis[i]=trace(x,y,z,S[0],S[1],S[2],40,shadowRay)?0:1;
      direct=ndl*v;
    }
  }
  LR=A[0]*amb+C[0]*direct; LG=A[1]*amb+C[1]*direct; LB=A[2]*amb+C[2]*direct;
  const list=lampField[Math.floor(pz)*X+Math.floor(px)];
  if (list) {
    const K=palette.lamp, k=palette.lampK;
    for (const n of list) {
      const L=lamps[n];
      if (L.dead) continue;
      const lx=L.x-px, ly=L.y-py, lz=L.z-pz, d2=lx*lx+ly*ly+lz*lz, r2=L.r*L.r;
      if (d2>r2 || lx*L.nx+lz*L.nz>.25) continue;        // lamps only shine forward, never through their wall
      const d=Math.sqrt(d2)||1, f=(1-d2/r2), lam=Math.max(0,(nx*lx+ny*ly+nz*lz)/d);
      const e=f*f*(.25+.75*lam)*L.power*k*(ao*.5+.5);
      LR+=K[0]*e; LG+=K[1]*e; LB+=K[2]*e;
    }
  }
}
// Bullet holes (kept per voxel so a lookup only happens on marked voxels) and blast scorches.
const decals=[], decalCount=new Uint8Array(X*Y*Z), scorches=[];
function addDecal(vx,vy,vz,x,y,z,r) {
  if (!inside(vx,vy,vz)) return;
  if (decals.length>=220) { const d=decals.shift(); decalCount[d.i]--; }
  const i=index(vx,vy,vz);
  decals.push({i,x,y,z,r}); decalCount[i]++;
}

// World-space surface detail. Reads and writes the albedo in AR, AG, AB; returns ambient occlusion.
let AR=0, AG=0, AB=0;
const fract=v=>v-Math.floor(v);
function paint(c,t) { AR+=(c[0]-AR)*t; AG+=(c[1]-AG)*t; AB+=(c[2]-AB)*t; }
function surface(id,side,nx,ny,nz,vx,vy,vz,px,py,pz) {
  let k=1, ao=1;
  if (side!==1 && (id===2 || id===3 || id===10)) {
    const au=side===0?pz:px, fa=fract(au), plane=(side===0?vx:vz)*2+(nx+nz>0?1:0);
    const ax=vx+nx, az=vz+nz, iy=Math.floor(py);
    // corners: darker where this face meets another wall
    const lo=side===0?tile(ax,iy,vz-1):tile(vx-1,iy,az), hi=side===0?tile(ax,iy,vz+1):tile(vx+1,iy,az);
    if (lo) ao*=.55+.45*Math.min(1,fa*2.2);
    if (hi) ao*=.55+.45*Math.min(1,(1-fa)*2.2);
    ao*=.62+.38*Math.min(1,(py-1)/2.4);
    // water streaks from the top edge, grime splashed up from the floor
    const hs=h3(Math.floor(au*6),plane,3);
    if ((hs&7)===0) k*=1-.32*((hs>>3&7)/7)*Math.exp(-(wallTop-py)*.32);
    k*=1-.06*Math.max(0,py-(wallTop-.5))*2;
    if (py<2.1) { const g=(2.1-py)/1.1; k*=1-.22*g; AR*=1+.04*g; AB*=1-.08*g; }
    if (id===3) {
      // rust runs down from the cladding bolts
      const hr=h3(Math.floor(au*4),plane,11);
      if ((hr&3)===0) paint([110,58,34],Math.max(0,.55-fract(py/4.5)*.9)*((hr>>2&7)/7));
    } else {
      // painted hazard stripes on the edges of every opening
      const edgeLo=fa<.32 && !(side===0?tile(vx,iy,vz-1):tile(vx-1,iy,vz)) && !lo && !(side===0?tile(vx,1,vz-1):tile(vx-1,1,vz));
      const edgeHi=fa>.68 && !(side===0?tile(vx,iy,vz+1):tile(vx+1,iy,vz)) && !hi && !(side===0?tile(vx,1,vz+1):tile(vx+1,1,vz));
      if ((edgeLo || edgeHi) && py<5.6 && py>1.05) {
        const s=Math.floor((au+py)*2.6)&1?palette.stripe:palette.stripeDark;
        AR=s[0]; AG=s[1]; AB=s[2]; k*=.85+.15*fract(h3(Math.floor(au*12),Math.floor(py*12),5)/4096);
        if (id===10 && py<1.5) k*=.8;
      }
      else if (id===2) {
        // cast-in-place: lifts with their own tone, form-tie holes, panel joints, scattered cracks
        const lift=Math.floor((py-1)/2.5), lv=fract((py-1)/2.5)*2.5;
        k*=.93+.12*((h3(Math.floor(au/4),lift,plane)&15)/15);
        if (lv<.035) k*=.78;
        if (fract(au/4)<.025) k*=.75;
        const tu=fract(au/2)-.5, tv=lv-1.25, d2=tu*tu+tv*tv;
        if (d2<.0022) k*=.5; else if (d2<.006) k*=1.06;
        const hb=h3(Math.floor(au/4),Math.floor(py/4),plane+7);
        if (hb%3===0) {
          let cu=Math.floor(fract(au/4)*64), cv=Math.floor(fract(py/4)*64);
          if (hb&16) cu=63-cu;
          const c=crackMask[(63-cv)*64+cu];
          if (c===1) k*=.4; else if (c===2) k*=1.12;
        }
        // pipe runs along some walls, held on brackets
        if ((h3(Math.floor(au/7),plane,9)&3)===0 && py>5.8 && py<6.8) {
          if (py>6.25 && py<6.7) {
            const t=(py-6.25)/.45, sh=.42+.78*Math.sin(t*Math.PI)**.7+(t>.62&&t<.72?.25:0);
            AR=88*sh; AG=96*sh; AB=94*sh;
          } else if (py<6.0) { AR=48; AG=50; AB=50; }
          if (fract(au/2.5)<.05) { AR=40; AG=42; AB=42; }
        }
      } else if (id===10 && py<1.45) { const s=Math.floor((au+py)*2.6)&1?palette.stripe:palette.stripeDark; paint(s,.85); }
    }
  } else if (side===1 && ny>0 && (id===1 || id===12 || id===4)) {
    // floor: dark against the walls, oil stains, drains, painted markings
    const ix=Math.floor(px), iz=Math.floor(pz), fx=px-ix, fz=pz-iz;
    const w=index(ix,1,iz);
    if (world[w-1]) ao*=.5+.5*Math.min(1,fx*1.9);
    if (world[w+1]) ao*=.5+.5*Math.min(1,(1-fx)*1.9);
    if (world[w-X]) ao*=.5+.5*Math.min(1,fz*1.9);
    if (world[w+X]) ao*=.5+.5*Math.min(1,(1-fz)*1.9);
    if (id===4) {
      const lx=px-extraction.x, lz=pz-extraction.z, m=Math.max(Math.abs(lx),Math.abs(lz));
      if (Math.abs(m-2.15)<.13 || (Math.abs(Math.abs(lx)-.72)<.13 && Math.abs(lz)<1) || (Math.abs(lz)<.12 && Math.abs(lx)<.72)) paint([214,226,206],.85);
      return ao;
    }
    const hb=h3(Math.floor(px/3),Math.floor(pz/3),13);
    if ((hb&7)<2) {
      const ox=(hb>>4&15)/15*3, oz=(hb>>8&15)/15*3, r=.5+(hb>>12&7)/7;
      const ex=fract(px/3)*3-ox, ez=fract(pz/3)*3-oz, d2=(ex*ex+ez*ez)/(r*r);
      if (d2<1) k*=.72+.28*d2;
    }
    if (id===1) {
      const lx=(px-1)%stride, lz=(pz-1)%stride;
      if (Math.abs(lx-2.5)<.55 && Math.abs(lz-2.5)<.55 && !(foyerBox && px>=foyerBox.x0 && px<foyerBox.x1 && pz<foyerBox.z1)) {
        AR=58; AG=60; AB=60; if (Math.abs(lx-2.5)<.47 && Math.abs(lz-2.5)<.47 && Math.floor(lx*9)%2) { AR=14; AG=15; AB=15; }
      }
      if (foyerBox && px>=foyerBox.x0 && px<foyerBox.x1 && pz>=foyerBox.z0 && pz<foyerBox.z1) {
        // loading-bay lines around the pad and hatching in front of it, scuffed by traffic
        const bx=Math.abs(px-extraction.x), wear=.55+.45*fract(h3(Math.floor(px*5),Math.floor(pz*5),3)/9973);
        if ((Math.abs(bx-4)<.14 && pz<8.6) || (Math.abs(pz-8.6)<.14 && bx<4) ||
            (pz>8.6 && pz<9.8 && bx<4 && fract((px+pz)*.9)<.32)) paint(palette.stripe,.8*wear);
      }
    }
  } else if (id===13 || id===14) truckDetail(id,side,px,py,pz);
  if (theme.rules.moss && (id===2 || id===10 || id===1 || id===12)) {
    // moss creeping up from the floor and down from the wall tops, in clumps
    const m=(h3(Math.floor(px*1.3),Math.floor(py*1.3),Math.floor(pz*1.3)+77)&255)/255*.6+(h3(Math.floor(px*5),Math.floor(py*5),Math.floor(pz*5)+78)&255)/255*.4;
    const where=side===1?.75:Math.max(0,1-(py-1)/3)+Math.max(0,(py-(wallTop-1.6))/1.6);
    if (m*where>.32) paint([60,84,42],Math.min(.75,(m*where-.32)*1.8));
  }
  AR*=k; AG*=k; AB*=k;
  return ao;
}
// Truck: wheels and a dark undercarriage on the chassis row, windows and a grille on the cab,
// hoops showing through the canvas over the bed, mud splashed up the sides.
function truckDetail(id,side,px,py,pz) {
  const t=trucks.find(t=>px>t.x0-.05 && px<t.x1+.05 && pz>t.z0-.05 && pz<t.z1+.05);
  if (!t) return;
  const a=t.along==="x"?px-t.x0:pz-t.z0;                 // 0 at the front bumper, 6 at the tailgate
  const lengthwise=(t.along==="x")===(side===2);         // a long side of the truck rather than an end
  if (id===14 && py<2.02 && side!==1) {
    if (lengthwise) {
      let w=9;
      for (const c of [1.05,4.1,5.15]) w=Math.min(w,Math.hypot(a-c,py-1.48));
      if (w<.47) { const hub=w<.2; AR=hub?96:24; AG=hub?98:24; AB=hub?92:26; if (w>.4) { AR=36; AG=36; AB=38; } return; }
      AR=AR*(py<1.6?.35:.8); AG*=py<1.6?.35:.8; AB*=py<1.6?.35:.8;
      return;
    }
    if (a<.1 && py>1.5) { if (Math.floor(((t.along==="x"?pz:px)*6))%2) { AR*=.5; AG*=.5; AB*=.5; } return; }  // grille
    AR*=.4; AG*=.4; AB*=.4; return;
  }
  if (id===14) {                                          // cab glass: sky reflection fading down the pane
    const f=fract(py), b=colors[13], along=fract(side===0?pz:px);
    if (side===1 || along<.12 || along>.88 || f>.8) { AR=b[0]*.9; AG=b[1]*.9; AB=b[2]*.9; return; }   // roof and pillars
    const r=palette.skyLo;
    AR=r[0]*.45*f+20; AG=r[1]*.45*f+22; AB=r[2]*.45*f+26;
    if (f<.08 || f>.92) { AR=30; AG=32; AB=30; }
    return;
  }
  if (a>2 && lengthwise && fract((a-2)/1.33)<.06) { AR*=.8; AG*=.8; AB*=.8; }
  if (a>2) { AR*=1.04; AG*=1.06; AB*=.94; }               // canvas over the bed is a touch greener
  if (py<2.7) paint([88,72,52],Math.min(.6,(2.7-py)*.5));
}
// Night-vision goggles: the frame is turned to green phosphor and auto-exposed, so a dark base
// still reads clearly. Bright things bloom; a little grain and scanline keep the goggle feel.
let nvgGain=2.5;
function nightVision(clock) {
  let sum=0;
  for (let j=0;j<pixels.length;j+=16) sum+=pixels[j]*.3+pixels[j+1]*.59+pixels[j+2]*.11;
  const mean=sum/(pixels.length/16);
  nvgGain+=(Math.max(1.2,Math.min(5,120/Math.max(8,mean)))-nvgGain)*.15;
  const seed=Math.floor(clock*30)*7919;
  for (let i=0,j=0;j<pixels.length;i++,j+=4) {
    const row=(i/width)|0;
    let L=(pixels[j]*.3+pixels[j+1]*.59+pixels[j+2]*.11)*nvgGain;
    L=255*(1-Math.exp(-Math.max(0,L-38)/120));                    // deeper blacks, soft highlight roll-off
    L*=(row&1?.93:1)*(.94+(((i*2654435761+seed)>>>24)&15)/120);    // scanlines and grain
    pixels[j]=L*.38; pixels[j+1]=Math.min(255,L*1.02+6); pixels[j+2]=L*.46;
  }
}
function render(clock) {
  applyDirty();
  for (const L of lamps) if (!L.dead && !tile(L.ax,L.ay,L.az)) {
    L.dead=true;                                           // its wall is gone; the lamp drops
    for (let n=0;n<8;n++) particles.push({x:L.x,y:L.y,z:L.z,vx:(Math.random()-.5)*3,vy:Math.random()*2,vz:(Math.random()-.5)*3,life:.3+Math.random()*.3,shade:1,spark:true});
    buildLampField();
  }
  const [fx,fy,fz]=direction();
  const rx=Math.cos(player.yaw), rz=-Math.sin(player.yaw);
  const ux=-Math.sin(player.yaw)*fy, uy=Math.cos(player.pitch);
  const uz=-Math.cos(player.yaw)*fy;
  const flashStrength=flash/.075;
  const blastStrength=blast?Math.min(.66,blast.life*2):0;
  const S=palette.sunDir, SC=palette.sun, lo=palette.skyLo, hi=palette.skyHi, cl=palette.cloud, F=palette.fog;
  const drift=clock*.012;
  for (let row=0;row<height;row++) {
    const v=(height/2-row-.5)/focal;
    const bx=fx+ux*v, by=fy+uy*v, bz=fz+uz*v;
    for (let col=0;col<width;col++) {
      const u=(col+.5-width/2)/focal;
      const dx=bx+rx*u, dz=bz+rz*u;
      const id=trace(player.x,player.eye,player.z,dx,by,dz,68,ray);
      const i=row*width+col, j=i*4;
      depth[i]=ray.t;
      const inv=1/Math.sqrt(dx*dx+by*by+dz*dz), sd=(dx*S[0]+by*S[1]+dz*S[2])*inv;
      if (!id) {
        const ny=by*inv, altitude=Math.max(0,Math.min(1,ny*1.8));
        let r=lo[0]+(hi[0]-lo[0])*altitude, g=lo[1]+(hi[1]-lo[1])*altitude, b=lo[2]+(hi[2]-lo[2])*altitude;
        if (ny>.01) {
          // drifting cloud deck, lit from the sun side
          const cx=dx*inv/(ny+.12)*1.4+drift, cz=dz*inv/(ny+.12)*1.4;
          const n=.5+.22*(Math.sin(cx*1.7+Math.sin(cz*1.3))+Math.sin(cz*2.1+.7*Math.sin(cx*2.9)))+.1*Math.sin(cx*5.3+cz*4.1)+.05*Math.sin(cx*11.7-cz*9.3);
          const c=Math.max(0,Math.min(1,(n-1+palette.clouds)*2.6))*Math.min(1,ny*5);
          const lit=.72+.4*Math.max(0,sd);
          r+=(cl[0]*lit-r)*c; g+=(cl[1]*lit-g)*c; b+=(cl[2]*lit-b)*c;
        }
        if (sd>0) {
          const glow=(sd**28*70+sd**4*22)*palette.glare+(sd>.9994?160*palette.glare:0);
          r+=glow*SC[0]; g+=glow*SC[1]; b+=glow*SC[2];
        }
        pixels[j]=r; pixels[j+1]=g; pixels[j+2]=b;
      } else {
        const px=player.x+dx*ray.t, py=player.eye+by*ray.t, pz=player.z+dz*ray.t;
        const side=ray.side;
        const nx=side===0?(dx>0?-1:1):0, ny=side===1?(by>0?-1:1):0, nz=side===2?(dz>0?-1:1):0;
        const tu=side===0?pz:px, tv=side===1?pz:-py;
        const texel=(((Math.floor(tv*16)&63)*64)+(Math.floor(tu*16)&63))*3;
        const tex=textures[id], tint=ray.tint;
        AR=tex[texel]*tint; AG=tex[texel+1]*tint; AB=tex[texel+2]*tint;
        const ao=surface(id,side,nx,ny,nz,ray.x,ray.y,ray.z,px,py,pz);
        const vi=ray.x+X*(ray.z+Z*ray.y);
        if (decalCount[vi]) for (const d of decals) {
          if (d.i!==vi) continue;
          const a=side===0?pz-d.z:px-d.x, b=side===1?pz-d.z:py-d.y, q=(a*a+b*b)/(d.r*d.r);
          if (q<1) { AR*=.18; AG*=.18; AB*=.18; } else if (q<2.6) { const m=.62+.3*(q-1)/1.6; AR*=m; AG*=m; AB*=m; }
        }
        for (const s of scorches) {
          const q=((px-s.x)**2+(py-s.y)**2+(pz-s.z)**2)/(s.r*s.r);
          if (q<1) { const m=.3+.7*q**.7; AR*=m; AG*=m*.97; AB*=m*.94; }
        }
        lightAt(px,py,pz,nx,ny,nz,ao,true);
        const haze=Math.min(.72,ray.t*.0145);
        const keep=1-haze, glare=Math.max(0,sd)**6*.45*palette.glare;
        const muzzle=flashStrength*Math.max(0,1-ray.t*.15)*.38;
        const glow=blastStrength?blastStrength*Math.max(0,1-((px-blast.x)**2+(py-blast.y)**2+(pz-blast.z)**2)/34):0;
        // warm pool of light around the intel case, green around the pad once it's live
        const ix=px-intel.x, iz=pz-intel.z;
        const intelGlow=hasIntel?0:Math.max(0,1-(ix*ix+(py-2.4)**2+iz*iz)/9)*(.22+.06*Math.sin(clock*4));
        const ex=px-extraction.x, ez=pz-extraction.z;
        const padGlow=hasIntel?Math.max(0,1-(ex*ex+(py-1)**2+ez*ez)/16)*(.3+.1*Math.sin(clock*5)):0;
        const warmth=(muzzle+glow+intelGlow)*keep;
        pixels[j]=(AR*LR)*keep+(F[0]+SC[0]*90*glare)*haze+warmth*116+padGlow*20;
        pixels[j+1]=(AG*LG)*keep+(F[1]+SC[1]*90*glare)*haze+warmth*76+padGlow*120;
        pixels[j+2]=(AB*LB)*keep+(F[2]+SC[2]*90*glare)*haze+warmth*32+padGlow*70;
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
  // lit: light falling on the sprite (sun if not in shadow, sky, lamps), or null for self-lit things
  function spriteLight(x,y,z) {
    const tx=player.x-x, tz=player.z-z, tl=Math.hypot(tx,tz)||1;
    lightAt(x,y,z,tx/tl*.9,.3,tz/tl*.9,1,true);
    return [LR*.95+.08,LG*.95+.08,LB*.95+.08];
  }
  function sprite(x,y,z,w,h,colorAt,opacity=1,outline=false,lit=null) {
    const p=project(x,y,z);
    if (!p) return;
    const lr=lit?lit[0]:1, lgc=lit?lit[1]:1, lb=lit?lit[2]:1;
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
          pixels[j]=c[0]*shade*lr+groundFog[0]*haze;
          pixels[j+1]=c[1]*shade*lgc+groundFog[1]*haze;
          pixels[j+2]=c[2]*shade*lb+groundFog[2]*haze;
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
    // through night-vision goggles soldiers stand out brighter than the concrete around them
    const lit=spriteLight(g.x,2.6,g.z).map(c=>theme.nvg?c*1.9+.35:c);
    if (fall>=.55) {
      const lie=Math.min(1,(fall-.55)/.45), pose=g.pose??=h3(Math.floor(g.x*7),Math.floor(g.z*7),3)%3;
      sprite(g.x,1+.32,g.z,2.9,.64,(u,v)=>corpsePixel(u,v/lie-(1/lie-1),pose,g.look),1,true,spriteLight(g.x,1.4,g.z));
      continue;
    }
    const height=3.26-2.8*fall;
    const hitOffset=g.impact*1.2;
    sprite(g.x,1+height/2+Math.abs(step)*.06,g.z,1.76+fall*.56,height,(u,v)=>{
      const color=guardPixel(view,u-hitOffset*(1-v),v,g.muzzle>0,step,g.aim>0?1-g.aim/windup:0,g.look);
      return color && g.impact?[color[0]+60,color[1]+22,color[2]+10]:color;
    },1,true,lit);
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
    sprite(intel.x,2.55+bob,intel.z,w,.95,(u,v)=>intelPixel(u,v,1),1,true,spriteLight(intel.x,2.6,intel.z).map(c=>Math.max(.9,c)));
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
    },1,true,spriteLight(x,y,z));
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
      },1,true,spriteLight(f.x,f.y,f.z));
    }
  }
  for (const b of bullets) {
    for (let k=0;k<4;k++) {
      const back=k*.012;
      sprite(b.x-b.vx*back,b.y-b.vy*back,b.z-b.vz*back,.3-k*.05,.3-k*.05,glowAt(255,180-k*25,80,.8-k*.18));
    }
    sprite(b.x,b.y,b.z,.08,.08,()=>[255,245,210]);
  }
  for (const g of grenades) {
    const lit=spriteLight(g.x,g.y,g.z), blink=Math.sin(g.fuse*(g.fuse<.8?40:14))>0;
    sprite(g.x,g.y+.12,g.z,.3,.3,(u,v)=>{
      const d=(u-.5)**2+(v-.55)**2;
      if (v<.2) return Math.abs(u-.55)<.12?[70,72,66]:null;                     // fuse head
      if (d>.16) return;
      return d<.02 && u<.45?[120,128,96]:[58,66,44];
    },1,true,lit);
    if (blink) sprite(g.x,g.y+.3,g.z,.35,.35,glowAt(255,60,40,.9));
  }
  // wall lamps: a caged bulb on a bracket, with a soft halo
  for (const L of lamps) {
    if (L.dead) continue;
    const K=palette.lamp;
    sprite(L.x+L.nx*.12,L.y,L.z+L.nz*.12,.42,.34,(u,v)=>{
      if (v<.18) return Math.abs(u-.5)<.42?[44,46,44]:null;            // hood
      const c=(u-.5)**2/.1+(v-.6)**2/.16;
      if (c>1) return;
      if (Math.abs(u-.5)<.04 || Math.abs(v-.6)<.04 || c>.8) return [30,32,30];  // wire cage
      return [255*K[0],255*K[1],255*K[2]];
    },1,false);
    sprite(L.x+L.nx*.2,L.y,L.z+L.nz*.2,1.6*L.power,1.6*L.power,glowAt(255*K[0],255*K[1],255*K[2],.35*palette.lampK));
  }
  for (const p of particles) {
    if (p.spark) { sprite(p.x,p.y,p.z,.14,.14,glowAt(255,210,130,Math.min(1,p.life*6))); continue; }
    if (p.dust || p.smoke) continue;
    const k=.7+p.shade*.5;
    sprite(p.x,p.y,p.z,.11+p.shade*.08,.11+p.shade*.08,()=>[rubbleColor[0]*k,rubbleColor[1]*k,rubbleColor[2]*k],1,false,spriteLight(p.x,p.y,p.z));
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
    if (p.smoke) {
      // blast smoke: a dark, slowly spreading plume that thins out as it rises
      const age=1-p.life/p.max, size=1.6+age*5.5, k=.32+p.shade*.14;
      const L=spriteLight(p.x,p.y,p.z), c=[dustColor[0]*k*L[0],dustColor[1]*k*L[1],dustColor[2]*k*L[2]];
      sprite(p.x,p.y,p.z,size,size,()=>c,Math.min(.5,p.life/p.max*.75)*(age<.08?age/.08:1));
      continue;
    }
    if (!p.dust) continue;
    const size=(p.size||1)*(1.4+(1.6-p.life)*1.4);
    const L=spriteLight(p.x,p.y,p.z), c=[dustColor[0]*L[0],dustColor[1]*L[1],dustColor[2]*L[2]];
    sprite(p.x,p.y,p.z,size,size,()=>c,Math.min(.22,p.life*.25));
  }
  if (theme.nvg) nightVision(clock);
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

let vmSmoke=[], lastClock=0;
function drawRifle(clock) {
  lastClock=clock;
  vmSmoke=vmSmoke.filter(w=>clock-w.born<1.2);
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
  // worn edges: paint rubbed through to bare metal where hands and kit touch it
  line("rgba(196,204,198,.38)",.4,[[17,-6.2],[24,-7.2],[44,-6.2]]);
  line("rgba(196,204,198,.3)",.35,[[20,-15.2],[25.2,-21.2]]);
  line("rgba(196,204,198,.32)",.35,[[22.2,10.5],[25.5,27.5]]);
  line("rgba(196,204,198,.25)",.3,[[13,7.6],[17.2,-5.8]]);
  for (const [x0,y0,x1,y1] of [[32,-6.6,35,-7],[18,2,19.4,-1],[43,1,46,3.2],[27,24,29,24.4]]) line("rgba(170,178,172,.35)",.25,[[x0,y0],[x1,y1]]);

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

  // holographic sight (sits low on the receiver): rail clamp, armoured hood, coated window
  vm.save(); vm.translate(33,-20); vm.scale(.82,.82); vm.translate(-33,20); vm.translate(0,4);
  poly("#1a1f1e",[[26,-19.5],[39,-18],[40,-21.5],[27,-23]]);
  poly("#0d1010",[[29,-19],[31,-18.8],[31,-16.6],[29,-16.8]]); poly("#0d1010",[[35,-18.4],[37,-18.2],[37,-16],[35,-16.2]]);  // clamp screws
  poly(lg(24,-34,40,-20,"#2f3735","#121615"),[[25,-21.5],[24.8,-31],[27.5,-34.5],[37.5,-33.8],[40.5,-30],[40.5,-20.5]],"#59645f");
  line("rgba(200,210,204,.35)",.35,[[25.2,-30.6],[27.7,-34.1],[37.3,-33.5]]);   // worn hood edge
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

  // muzzle smoke: a few grey wisps curl up from the barrel after each shot
  for (const w of vmSmoke) {
    const age=clock-w.born;
    if (age<0 || age>1.1) continue;
    const r=3+age*14, a=(1-age/1.1)*.22;
    const g=vm.createRadialGradient(w.x+w.dx*age*12,-44-age*22,0,w.x+w.dx*age*12,-44-age*22,r);
    g.addColorStop(0,`rgba(176,174,166,${a})`); g.addColorStop(1,"rgba(176,174,166,0)");
    vm.fillStyle=g; vm.beginPath(); vm.arc(w.x+w.dx*age*12,-44-age*22,r,0,7); vm.fill();
  }
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

// ===== Touch controls (phones/tablets), same scheme as QUACK =====
// One full-screen layer takes every finger. Left half: a MOVE stick appears wherever your thumb lands.
// Right half: a LOOK stick that keeps turning while held (gentle near the middle, fast at full tilt).
// FIRE hugs the look stick and also aims while held; RELOAD, PLANT and DUCK sit beside it.
// A new finger always takes over its half, so a lost touch can never leave a control stuck.
const isTouch=touchDevice;
const touchMove={x:0,y:0};
const touchLook={id:null,ox:0,oy:0,x:0,y:0};
const touchJoy={id:null,ox:0,oy:0};
const fireTouch={id:null};
let touchFire=false, touchCrouch=false;
const LOOK_YAW=3.0, LOOK_PITCH=1.7;
document.querySelector("#version").textContent="BUNKER BUSTER "+VERSION;
const touchLayer=document.querySelector("#touch");
const tctx=touchLayer.getContext("2d");
function touchLookStep(dt) {
  if (touchLook.id===null) return;
  const curve=v=>Math.abs(v)<.08?0:Math.sign(v)*Math.pow(Math.abs(v),1.6);
  player.yaw+=curve(touchLook.x)*LOOK_YAW*dt;
  player.pitch=Math.max(-1.12,Math.min(1.12,player.pitch-curve(touchLook.y)*LOOK_PITCH*dt));
}
function touchLayout() {
  const w=touchLayer.clientWidth, h=touchLayer.clientHeight, m=Math.min(w,h);
  const R=Math.max(48,Math.min(70,m*.15));
  const home=side=>({x:side<0?30+R:w-30-R, y:h-36-R});
  const r=Math.max(38,Math.min(54,m*.12)), r2=Math.round(r*.66), hr=home(1);
  // FIRE hugs the look stick (up and to the left of its resting spot), so the right thumb barely moves
  const d=(R+r+10)*.7071, fire={x:hr.x-d, y:hr.y-d, r};
  const portrait=isPortrait();
  // landscape: one row to the left of FIRE; portrait: one row across the deck, above both sticks
  const gap=2*r2+14, rowY=portrait?fire.y-r-r2-14:fire.y+r*.35;
  const reload={x:portrait?w/2+gap:fire.x-r-r2-16, y:rowY, r:r2};
  const plant={x:reload.x-gap, y:rowY, r:r2};
  const duck={x:plant.x-gap, y:rowY, r:r2};
  // grenade: above PLANT in landscape, at the end of the row in portrait
  const nade=portrait?{x:duck.x-gap, y:rowY, r:r2}:{x:plant.x, y:rowY-gap, r:r2};
  const pause=portrait?{x:w/2, y:Math.round(innerWidth*.75)+36, r:20}:{x:w*.36, y:32, r:20};
  return {w,h,R,home,buttons:{fire,reload,plant,duck,nade,pause}};
}
if (isTouch) {
  document.querySelector("main").classList.add("touch");
  document.querySelector(".controls").hidden=true;
  document.querySelector("#touch-help").hidden=false;
  const local=e=>{ const b=touchLayer.getBoundingClientRect(); return {x:e.clientX-b.left, y:e.clientY-b.top}; };
  const hit=(p,b)=>Math.hypot(p.x-b.x,p.y-b.y)<b.r+10;
  touchLayer.addEventListener("contextmenu",e=>e.preventDefault());
  touchLayer.addEventListener("pointerdown",e=>{
    e.preventDefault();
    if (phase!=="playing") return;
    try { touchLayer.setPointerCapture(e.pointerId); } catch {}
    const p=local(e), L=touchLayout(), B=L.buttons;
    if (hit(p,B.pause)) { pauseTouch(); return; }
    // FIRE also aims: hold it to shoot and slide the same thumb to steer, like a look stick
    if (hit(p,B.fire)) { fireTouch.id=e.pointerId; touchFire=true;
      touchLook.id=e.pointerId; touchLook.ox=B.fire.x; touchLook.oy=B.fire.y; touchLook.x=touchLook.y=0; return; }
    if (hit(p,B.reload)) { reloadRifle(); return; }
    if (hit(p,B.plant)) { breach(); return; }
    if (hit(p,B.nade)) { throwGrenade(); return; }
    if (hit(p,B.duck)) { touchCrouch=!touchCrouch; return; }
    if (p.x<L.w/2) { touchJoy.id=e.pointerId; touchJoy.ox=p.x; touchJoy.oy=p.y; touchMove.x=touchMove.y=0; return; }
    touchLook.id=e.pointerId; touchLook.ox=p.x; touchLook.oy=p.y; touchLook.x=touchLook.y=0;
  });
  touchLayer.addEventListener("pointermove",e=>{
    const p=local(e), R=touchLayout().R;
    const clampStick=st=>{ let dx=p.x-st.ox, dy=p.y-st.oy; const m=Math.hypot(dx,dy); if (m>R) { dx*=R/m; dy*=R/m; } return [dx/R,dy/R]; };
    if (e.pointerId===touchJoy.id) { const [x,y]=clampStick(touchJoy); const m=Math.hypot(x,y); touchMove.x=m<.12?0:x; touchMove.y=m<.12?0:y; }
    else if (e.pointerId===touchLook.id) { [touchLook.x,touchLook.y]=clampStick(touchLook); }
  });
  const endPointer=e=>{
    if (e.pointerId===touchJoy.id) { touchJoy.id=null; touchMove.x=touchMove.y=0; }
    if (e.pointerId===touchLook.id) { touchLook.id=null; touchLook.x=touchLook.y=0; }
    if (e.pointerId===fireTouch.id) { fireTouch.id=null; touchFire=false; }
  };
  touchLayer.addEventListener("pointerup",endPointer);
  touchLayer.addEventListener("pointercancel",endPointer);
  touchLayer.addEventListener("lostpointercapture",endPointer);
  addEventListener("blur",()=>{ touchJoy.id=touchLook.id=fireTouch.id=null; touchMove.x=touchMove.y=touchLook.x=touchLook.y=0; touchFire=false; });
  // re-layout on rotation: switch portrait/landscape and resize the render buffers to match
  const main=document.querySelector("main");
  const relayout=()=>{
    const portrait=isPortrait();
    main.classList.toggle("portrait",portrait);
    main.style.setProperty("--vh",portrait?Math.round(innerWidth*.75)+"px":"100%");
    const aspect=touchAspect(), w=Math.round(180*aspect/2)*2;
    if (w!==width) {
      screen.width=width=w;
      image=ctx.createImageData(width,height); pixels=image.data; depth=new Float32Array(width*height);
      const vmCanvas=document.querySelector("#viewmodel"); vmCanvas.width=VW=Math.round(720*aspect);
    }
  };
  addEventListener("resize",relayout); addEventListener("orientationchange",()=>setTimeout(relayout,120));
  relayout();
}
function drawTouch() {
  if (!isTouch || touchLayer.hidden) return;
  const dpr=devicePixelRatio||1, cw=touchLayer.clientWidth, ch=touchLayer.clientHeight;
  if (touchLayer.width!==Math.round(cw*dpr) || touchLayer.height!==Math.round(ch*dpr)) { touchLayer.width=Math.round(cw*dpr); touchLayer.height=Math.round(ch*dpr); }
  const c=tctx, L=touchLayout(), R=L.R, B=L.buttons;
  c.setTransform(dpr,0,0,dpr,0,0); c.clearRect(0,0,cw,ch);
  c.textAlign="center"; c.textBaseline="middle";
  const disc=(x,y,r,fill,alpha,stroke)=>{ c.globalAlpha=alpha; c.fillStyle=fill; c.beginPath(); c.arc(x,y,r,0,6.283); c.fill();
    if (stroke) { c.globalAlpha=Math.min(1,alpha+.35); c.strokeStyle=stroke; c.lineWidth=2; c.stroke(); } };
  const label=(t,x,y,size,col)=>{ c.globalAlpha=.95; c.fillStyle=col; c.font=`900 ${size}px monospace`; c.fillText(t,x,y+1); };
  const stick=(st,sx,sy,side,name)=>{
    const on=st.id!==null, home=L.home(side), x=on?st.ox:home.x, y=on?st.oy:home.y;
    const kx=side<0?touchMove.x:touchLook.x, ky=side<0?touchMove.y:touchLook.y;
    disc(x,y,R,"#0b1414",on?.5:.3,"#a9d9bd");
    disc(x+kx*R,y+ky*R,R*.42,side<0?"#a9d9bd":"#8fd0ff",.7);
    label(name,x+kx*R,y+ky*R,Math.round(R*.2),"#0b1414");
  };
  stick(touchJoy,0,0,-1,"MOVE");
  const fireAim=touchLook.id!==null && touchLook.id===fireTouch.id;
  if (fireAim) { const h=L.home(1); disc(h.x,h.y,R,"#0b1414",.3,"#a9d9bd"); disc(h.x,h.y,R*.42,"#8fd0ff",.7); label("LOOK",h.x,h.y,Math.round(R*.2),"#0b1414"); }
  else stick(touchLook,0,0,1,"LOOK");
  const btn=(b,t,active,accent)=>{ disc(b.x,b.y,b.r,active?accent:"#0b1414",active?.75:.5,accent); label(t,b.x,b.y,Math.round(b.r*(t.length>4?.32:.4)),active?"#0b1414":"#e5e8d9"); };
  btn(fireAim?{...B.fire,x:B.fire.x+touchLook.x*R*.5,y:B.fire.y+touchLook.y*R*.5}:B.fire,"FIRE",touchFire,"#f2b76b");
  btn(B.reload,"RELOAD",!!reload,"#a9d9bd");
  btn(B.plant,"PLANT",false,"#a9d9bd");
  btn(B.duck,"DUCK",touchCrouch,"#a9d9bd");
  btn(B.nade,"NADE "+grenadeCount,throwCool>0,grenadeCount?"#f2b76b":"#5b6b62");
  btn(B.pause,"II",false,"#a9d9bd");
  c.globalAlpha=1;
}
function pauseTouch() {
  phase="paused"; touchFire=false; touchMove.x=touchMove.y=0; touchJoy.id=touchLook.id=fireTouch.id=null; touchLook.x=touchLook.y=0;
  touchLayer.hidden=true; overlay.hidden=false;
  title.textContent="PAUSED"; brief.textContent="Tap resume to return to the operation.";
  deploy.textContent="RESUME";
}

deploy.addEventListener("click",()=>{
  document.querySelector("#device-note").hidden=true;   // start-screen notice only
  if (phase==="won" || phase==="lost" || phase==="ended") {
    // after a win: on to the next base. After a loss or a finished run: start a new run from level 1.
    if (phase==="won") campaign.level++;
    else campaign={level:1,total:0,time:0,cleared:0};
    theme=pickTheme();
    reset(); resultsEl.hidden=entryEl.hidden=boardEl.hidden=true; lastResult=null; overlay.querySelector("article").classList.remove("scored");
    showBriefing();
    return;                                   // show the new base's briefing; DEPLOY starts it
  }
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (Audio) {
    audio ??= new Audio();
    audio.resume().catch(()=>{});
  }
  if (isTouch) {
    try { document.documentElement.requestFullscreen?.({navigationUI:"hide"})?.catch(()=>{}); } catch {}
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
  if (e.code==="KeyG") throwGrenade();
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
  drawTouch();
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
  ammo.textContent=(reload?"RELOAD":String(magazine).padStart(2,"0")+"/"+reserve)+"  ·  "+charges+" CHG  ·  "+grenadeCount+" GRN";
  message.textContent=charge?(charge.plant>0
    ? "PLANTING CHARGE"
    : "CHARGE ARMED  "+charge.fuse.toFixed(1)+" S")
    : noticeTime?notice:"";
  chargeFill.hidden=!charge;
  if (charge) chargeFill.style.setProperty("--progress",charge.plant>0
    ? 1-charge.plant/plantTime : charge.fuse/fuseTime);
  const [fx,fy,fz]=direction();
  prompt.hidden=phase!=="playing" || !!charge || !charges ||
    !breachable(trace(player.x,player.eye,player.z,fx,fy,fz,plantRange,hit));
  const sh=shake*shake*14;
  document.querySelector("main").style.transform=sh>.05?`translate(${(Math.random()-.5)*sh}px,${(Math.random()-.5)*sh}px)`:"";
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);




