'use strict';
// ===== 失败回退、回合流转、敌方阶段 =====

// 失败回退：切换到未失败过的次优候选，避免角色卡住
function fallback(u,P,reason){
  const rest=P.cands.filter(c=>!P.failedKinds.includes(c.kind));
  const next=rest[0]||genCandidates(u).map(scoreCand).sort((a,b)=>b.score-a.score)
    .find(c=>c.kind==='hold');
  P.current=next; P.stepIdx=0;
  P.reason=`因「${reason}」启用备选计划。`+buildReason(next,rest[1]);
  addLog(`[${u.name}] 动作失败，回退到备选计划「${next.name}」`);
}

// 全员行动完毕（或无行动点）后进入敌方阶段
function checkRoundEnd(){
  const busy=aliveSquad().some(u=>{
    const P=S.plans[u.id];
    return u.ap>0&&P&&P.current&&P.stepIdx<P.current.steps.length;
  });
  if(!busy) enemyPhase();
}

function enemyPhase(){
  const moved=[];
  for(const e of S.enemies){
    if(e.hp<=0) continue;
    const tgt=aliveSquad().sort((a,b)=>dist(e,a)-dist(e,b))[0];
    if(!tgt) break;
    if(dist(e,tgt)<=e.range&&losGrid(S.grid,e.x,e.y,tgt.x,tgt.y)){
      if(Math.random()<0.6){
        tgt.hp-=e.dmg;
        addLog(`敌方阶段：${e.name} 命中 ${tgt.name}（-${e.dmg}）`);
        if(tgt.hp<=0){ tgt.status='阵亡'; addLog(`${tgt.name} 阵亡！`); }
        else if(tgt.hp<tgt.maxHp*0.35) tgt.status='重伤';
      }
    }else{
      const p=astar(S.grid,e.x,e.y,tgt.x,tgt.y,tileBlocked);
      if(p&&p.length){
        const seg=p.slice(0,2), to=seg[seg.length-1];
        moved.push(`${e.name} (${e.x},${e.y})→(${to.x},${to.y})`);
        e.x=to.x; e.y=to.y;
      }
    }
    // 监视射击：敌人进入我方监视范围时触发
    for(const u of aliveSquad().filter(x=>x.overwatch)){
      if(dist(u,e)<=u.range&&losGrid(S.grid,u.x,u.y,e.x,e.y)&&Math.random()<0.7){
        e.hp-=u.dmg; u.overwatch=false;
        addLog(`[${u.name}] 监视射击命中 ${e.name}（-${u.dmg}）`);
      }
    }
  }
  S.round++;
  for(const u of S.squad){ u.ap=u.maxAp; u.overwatch=false; }
  const trig=moved.length?`环境变化：敌人移动（${moved.join('；')}）`:'新回合开始';
  for(const u of aliveSquad()) replanUnit(u,trig);
  if(!S.enemies.some(e=>e.hp>0)) endGame(true);
  else if(aliveSquad().length&&aliveSquad().every(u=>u.x>=COLS-2)) endGame(true,'全员抵达撤离点！');
}

function endGame(win,msg){
  S.over=true; S.running=false; clearInterval(S.timer);
  const b=document.getElementById('banner');
  b.textContent=msg||(win?'任务完成：敌人已全部消灭！':'任务失败：小队全灭');
  b.style.display='block';
}
