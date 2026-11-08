// Reference implementation of the maze generation used by MazeGenerator.cs.
// Usage: node maze-reference.mjs [seed]   (default 12345)
const columns=7, rows=10, midCol=Math.floor(columns/2);
const firstCell=midCol, lastCell=(rows-1)*columns+midCol;

function mulberry32(a) {
  return function() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  const snake=Array.from({length:columns*rows},(_,i)=>{
    const row=Math.floor(i/columns), col=i%columns;
    return row*columns+(row%2?columns-1-col:col);
  });
  return snake.slice(1).map((cell,i)=>[snake[i],cell]);
}

function addExtraOpenings(passages, random) {
  for (let k=0;k<Math.round(columns*rows*.08);k++) {
    const cell=Math.floor(random()*columns*rows), right=random()<.5;
    const col=cell%columns, row=Math.floor(cell/columns);
    if (right && col<columns-1) passages.push([cell,cell+1]);
    else if (!right && row<rows-1) passages.push([cell,cell+columns]);
  }
}

const seed = Number(process.argv[2] ?? 12345);
const random = mulberry32(seed);
const passages = generateMaze(random);
const base = passages.length;
addExtraOpenings(passages, random);
console.log(JSON.stringify({seed, basePassageCount: base, passageCount: passages.length, passages}));
