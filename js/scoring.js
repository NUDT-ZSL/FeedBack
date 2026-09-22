'use strict';
// ===== 计划评分与择优：目标优先级、资源消耗、风险 =====
function scoreCand(c){
  const w=S.weights;
  let goal=0;
  if(c.kind==='attack')       goal=c.goalMetric*w.elim*2;
  else if(c.kind==='advance') goal=c.goalMetric*w.obj*2;
  else if(c.kind==='heal')    goal=c.goalMetric*w.surv*2;
  else if(c.kind==='retreat') goal=c.goalMetric*w.surv*2;
  else if(c.kind==='cover')   goal=0.3*w.surv+0.15*w.elim;
  else                        goal=0.05;
  c.goal=+goal.toFixed(2);
  c.score=+(goal-0.35*c.costNorm-0.6*c.risk).toFixed(2);
  return c;
}

// 生成选择理由：与次优计划对比，指出胜出的关键因素
function buildReason(best,second){
  if(!second) return '唯一可行计划，直接采用。';
  const parts=[];
  if(best.goal>second.goal) parts.push(`目标收益更高(${best.goal} vs ${second.goal})`);
  if(best.risk<second.risk) parts.push(`风险更低(${best.risk} vs ${second.risk})`);
  if(best.costNorm<second.costNorm) parts.push(`行动点消耗更少(${best.cost}AP vs ${second.cost}AP)`);
  if(!parts.length) parts.push('三项指标接近，综合评分略优');
  return `总分 ${best.score} 领先次选「${second.name}」(${second.score})：`+parts.join('，')+'。';
}

// 为角色重新生成候选并决定是否切换计划；trigger 为重规划原因
function replanUnit(u,trigger){
  const cands=genCandidates(u).map(scoreCand).sort((a,b)=>b.score-a.score);
  const best=cands[0], second=cands[1];
  let P=S.plans[u.id];
  if(!P) P=S.plans[u.id]={current:null,stepIdx:0,cands:[],reason:'',failedKinds:[],history:[]};
  P.cands=cands;
  const cur=P.current;
  const curStillValid=cur && P.stepIdx<cur.steps.length && !cur.failed;
  const curScore=curStillValid?(cur.score??-9):-9;
  // 现有计划明显更差、已失效或已完成时才切换，保证行为连贯
  if(!curStillValid || best.score>curScore+0.15 || (best.kind!==cur.kind && best.score>curScore)){
    const keep=P.stepIdx>0?`保持已完成的 ${P.stepIdx} 步，`:'';
    if(cur&&cur!==best) P.history.push(cur.name);
    P.current=best; P.stepIdx=0;
    P.reason=buildReason(best,second);
    addLog(`[${u.name}] 重规划(${trigger}) → ${keep}采用「${best.name}」`);
  }else{
    P.reason=buildReason(cur,second);
    addLog(`[${u.name}] 重评估(${trigger})：现有计划「${cur.name}」仍为最优，继续执行`);
  }
  return P;
}
