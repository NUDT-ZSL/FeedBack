'use strict';
// ===== 计划生成：根据位置、技能、状态与地图信息产出多种候选计划 =====
let planSeq=0;
const dist=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const tileBlocked=(x,y)=>S.squad.concat(S.enemies).some(u=>u.hp>0&&u.x===x&&u.y===y);
const pathTo=(u,tx,ty)=>astar(S.grid,u.x,u.y,tx,ty,tileBlocked);
const visibleEnemies=u=>S.enemies.filter(e=>e.hp>0&&dist(u,e)<=u.vision&&losGrid(S.grid,u.x,u.y,e.x,e.y));

// 目的格风险：能攻击到该格的敌人火力之和；掩体减伤
function riskAt(x,y){
  let r=0;
  for(const e of S.enemies)
    if(e.hp>0 && dist({x,y},e)<=e.range && losGrid(S.grid,x,y,e.x,e.y)) r+=e.dmg/100;
  if(S.grid[y][x]===T.COVER) r*=0.45;
  return +r.toFixed(2);
}

// 在目标周围找一个可射击且风险低的站位
function approachTile(u,t){
  let best=null,bestCost=1e9;
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
    if(S.grid[y][x]===T.WALL||tileBlocked(x,y)) continue;
    if(dist({x,y},t)>u.range||!losGrid(S.grid,x,y,t.x,t.y)) continue;
    const p=pathTo(u,x,y); if(!p) continue;
    const c=p.length+riskAt(x,y)*8;
    if(c<bestCost){bestCost=c;best={x,y,path:p};}
  }
  return best;
}

function moveStep(u,path){ return {type:'move',path,cost:Math.max(1,Math.ceil(path.length/u.move))}; }

function finalize(u,c){
  c.id=++planSeq; c.unit=u.id;
  c.cost=c.steps.reduce((s,x)=>s+x.cost,0);
  c.costNorm=+(c.cost/u.maxAp).toFixed(2);
  const last=c.steps[c.steps.length-1];
  const dest=last&&last.type==='move'?last.path[last.path.length-1]:{x:u.x,y:u.y};
  c.dest=dest;
  c.risk=riskAt(dest.x,dest.y);
  return c;
}

function genCandidates(u){
  const C=[];
  const foes=visibleEnemies(u);
  // 1) 进攻：接近并攻击最近的可见敌人
  if(foes.length&&u.ap>=2){
    const t=foes.slice().sort((a,b)=>dist(u,a)-dist(u,b))[0];
    const steps=[];
    if(dist(u,t)>u.range||!losGrid(S.grid,u.x,u.y,t.x,t.y)){
      const spot=approachTile(u,t);
      if(spot&&spot.path.length) steps.push(moveStep(u,spot.path));
    }
    steps.push({type:'attack',target:t.id,cost:2});
    C.push(finalize(u,{kind:'attack',name:'进攻·'+t.name,steps,
      expected:`接敌并攻击 ${t.name}，预计伤害 ${u.dmg}，命中率 ${Math.round(u.hit*100)}%`,
      goalMetric:u.dmg/100*(t.hp<=u.dmg?1.6:1)}));
  }
  // 2) 推进：向撤离点机动
  {
    const tgt={x:COLS-2,y:u.y};
    const p=pathTo(u,tgt.x,Math.min(ROWS-1,Math.max(0,tgt.y)));
    if(p&&p.length){
      const cut=p.slice(0,u.ap*u.move);
      C.push(finalize(u,{kind:'advance',name:'推进·撤离点',steps:[moveStep(u,cut)],
        expected:`向撤离点机动 ${cut.length} 格，距目标还剩 ${Math.max(0,COLS-2-cut[cut.length-1].x)} 格`,
        goalMetric:cut.length/COLS}));
    }
  }
  // 3) 掩护：占据掩体并监视
  {
    let best=null,br=1e9;
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
      if(S.grid[y][x]!==T.COVER||tileBlocked(x,y)) continue;
      const p=pathTo(u,x,y); if(!p||p.length>u.ap*u.move) continue;
      const r=riskAt(x,y)+p.length*0.02;
      if(r<br){br=r;best={x,y,path:p};}
    }
    const steps=[];
    if(best&&best.path.length) steps.push(moveStep(u,best.path));
    steps.push({type:'overwatch',cost:1});
    C.push(finalize(u,{kind:'cover',name:'掩护·监视',steps,
      expected:`占据掩体并进入监视状态，受击风险约 ${riskAt(steps[0]&&steps[0].type==='move'?best.x:u.x,steps[0]&&steps[0].type==='move'?best.y:u.y)}`,
      goalMetric:0.2}));
  }
  // 4) 治疗：医疗兵支援重伤队友
  if(u.role==='medic'){
    const ally=S.squad.filter(a=>a.id!==u.id&&a.hp>0&&a.hp<a.maxHp*0.7)
      .sort((a,b)=>dist(u,a)-dist(u,b))[0];
    if(ally&&u.ap>=2){
      const spot=approachTile(u,ally)||{path:[]};
      const steps=[];
      if(dist(u,ally)>1&&spot.path.length) steps.push(moveStep(u,spot.path));
      steps.push({type:'heal',target:ally.id,cost:2});
      C.push(finalize(u,{kind:'heal',name:'治疗·'+ally.name,steps,
        expected:`靠近并为 ${ally.name} 恢复 ${u.heal} 点生命`,
        goalMetric:u.heal/100}));
    }
  }
  // 5) 撤退：低血量脱离交火
  if(u.hp<u.maxHp*0.35){
    let best=null,bs=-1;
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
      if(S.grid[y][x]===T.WALL||tileBlocked(x,y)) continue;
      const p=pathTo(u,x,y); if(!p||p.length>u.ap*u.move) continue;
      const d=Math.min(...S.enemies.filter(e=>e.hp>0).map(e=>dist({x,y},e)),99)-riskAt(x,y)*5;
      if(d>bs){bs=d;best={x,y,path:p};}
    }
    if(best) C.push(finalize(u,{kind:'retreat',name:'撤退·保全',steps:[moveStep(u,best.path)],
      expected:'脱离敌方火力，保全战力',goalMetric:0.5}));
  }
  // 兜底：原地警戒
  C.push(finalize(u,{kind:'hold',name:'原地警戒',steps:[{type:'overwatch',cost:1}],
    expected:'保持原位并监视周边',goalMetric:0.05}));
  return C;
}
