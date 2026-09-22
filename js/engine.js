'use strict';
// ===== 网格引擎：地图、寻路、视线 =====
const COLS=18, ROWS=12, CELL=40;
const T={FLOOR:0, WALL:1, COVER:2};
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];

function inBounds(x,y){ return x>=0 && y>=0 && x<COLS && y<ROWS; }

function makeGrid(){
  const g=Array.from({length:ROWS},()=>Array(COLS).fill(T.FLOOR));
  // 墙体：不可通行、阻挡视线
  [[5,3],[5,4],[5,8],[9,2],[9,3],[9,8],[9,9],[13,5],[13,6],[13,7]]
    .forEach(([x,y])=>g[y][x]=T.WALL);
  // 掩体：可站立，降低被命中风险
  [[3,5],[4,5],[7,4],[7,7],[8,7],[11,4],[11,7],[12,7],[14,3],[15,8],[6,9],[10,5]]
    .forEach(([x,y])=>g[y][x]=T.COVER);
  return g;
}

// Bresenham 视线：墙体阻挡
function losGrid(g,x0,y0,x1,y1){
  let dx=Math.abs(x1-x0), dy=Math.abs(y1-y0);
  let sx=x0<x1?1:-1, sy=y0<y1?1:-1, err=dx-dy, x=x0, y=y0;
  while(true){
    const isEnd=(x===x0&&y===y0)||(x===x1&&y===y1);
    if(!isEnd && g[y][x]===T.WALL) return false;
    if(x===x1&&y===y1) return true;
    const e2=2*err;
    if(e2>-dy){ err-=dy; x+=sx; }
    if(e2<dx){ err+=dx; y+=sy; }
  }
}

// A* 寻路，blocked(x,y) 为额外占用判断；返回不含起点的路径，失败返回 null
function astar(g,sx,sy,tx,ty,blocked){
  const key=(x,y)=>x+','+y;
  const h=(x,y)=>Math.abs(x-tx)+Math.abs(y-ty);
  const open=[{x:sx,y:sy,g:0,f:h(sx,sy)}];
  const came={}, gs={[key(sx,sy)]:0};
  while(open.length){
    open.sort((a,b)=>a.f-b.f);
    const cur=open.shift();
    if(cur.x===tx&&cur.y===ty){
      const path=[]; let c=cur;
      while(c){ path.unshift({x:c.x,y:c.y}); c=came[key(c.x,c.y)]||null; }
      path.shift();
      return path;
    }
    for(const [dx,dy] of DIRS){
      const nx=cur.x+dx, ny=cur.y+dy;
      if(!inBounds(nx,ny) || g[ny][nx]===T.WALL) continue;
      if(!(nx===tx&&ny===ty) && blocked && blocked(nx,ny)) continue;
      const ng=cur.g+1, k=key(nx,ny);
      if(gs[k]!==undefined && gs[k]<=ng) continue;
      gs[k]=ng;
      const node={x:nx,y:ny,g:ng,f:ng+h(nx,ny)};
      came[k]=cur;
      open.push(node);
    }
  }
  return null;
}
