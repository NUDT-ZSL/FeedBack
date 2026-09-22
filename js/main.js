'use strict';
// ===== 全局状态与主循环 =====
const S={
  grid:makeGrid(), round:1, running:false, timer:null,
  weights:{elim:0.5,obj:0.3,surv:0.2},
  squad:[
    {id:'A',name:'突击手',role:'assault',skill:'冲锋射击',x:1,y:2,hp:100,maxHp:100,ap:6,maxAp:6,move:3,range:5,dmg:34,hit:0.8,vision:7,status:'正常'},
    {id:'B',name:'狙击手',role:'sniper',skill:'精准狙击',x:1,y:6,hp:80,maxHp:80,ap:5,maxAp:5,move:2,range:9,dmg:55,hit:0.75,vision:9,status:'正常'},
    {id:'C',name:'医疗兵',role:'medic',skill:'战地治疗',x:2,y:9,hp:90,maxHp:90,ap:6,maxAp:6,move:3,range:4,dmg:18,hit:0.7,vision:6,heal:40,status:'正常'},
  ],
  enemies:[
    {id:'E1',name:'敌兵α',x:12,y:2,hp:60,maxHp:60,range:5,dmg:22,vision:6},
    {id:'E2',name:'敌兵β',x:14,y:6,hp:60,maxHp:60,range:5,dmg:22,vision:6},
    {id:'E3',name:'敌兵γ',x:11,y:10,hp:60,maxHp:60,range:5,dmg:22,vision:6},
  ],
  plans:{}, logs:[], fails:[],
  selected:'A', showVision:true, actIdx:0, over:false,
};

function aliveSquad(){ return S.squad.filter(u=>u.hp>0); }

// ---- 单步执行：每个 tick 由一名角色执行当前计划的下一步 ----
function tick(){
  if(S.over) return;
  const units=aliveSquad();
  if(!units.length) return endGame(false);
  const u=units[S.actIdx++%units.length];
  let P=S.plans[u.id];
  if(!P||!P.current||P.stepIdx>=P.current.steps.length){
    if(u.ap<=0) return checkRoundEnd();
    P=replanUnit(u,'无进行中计划');
  }
  if(P.current&&P.stepIdx<P.current.steps.length){
    if(u.ap<P.current.steps[P.stepIdx].cost) return checkRoundEnd();
    executeStep(u,P);
  }
  checkRoundEnd();
  refreshUI();
}

function executeStep(u,P){
  const step=P.current.steps[P.stepIdx];
  const fail=reason=>{
    step.failed=true;
    addFail(`[${u.name}] ${stepText(step)} 失败：${reason}`);
    P.failedKinds.push(P.current.kind);
    P.current.failed=true;
    fallback(u,P,reason);
  };
  u.ap-=step.cost;
  if(step.type==='move'){
    let moved=0;
    while(moved<u.move&&step.path.length){
      const n=step.path[0];
      if(S.grid[n.y][n.x]===T.WALL) return fail('路径被新障碍阻挡');
      if(tileBlocked(n.x,n.y)) return fail('目标格被占用');
      u.x=n.x; u.y=n.y; step.path.shift(); moved++;
    }
    if(step.path.length) u.ap+=step.cost; // 长移动分多拍完成
    else P.stepIdx++;
  }else if(step.type==='attack'){
    const t=S.enemies.find(e=>e.id===step.target);
    if(!t||t.hp<=0) return fail('目标已被消灭');
    if(dist(u,t)>u.range||!losGrid(S.grid,u.x,u.y,t.x,t.y)) return fail('目标超出射程或视线被挡');
    if(Math.random()<u.hit){
      t.hp-=u.dmg;
      addLog(`[${u.name}] 命中 ${t.name}，造成 ${u.dmg} 伤害${t.hp<=0?'，目标被消灭':''}`);
      if(t.hp<=0) addLog(`环境变化：${t.name} 被消灭，威胁解除`);
    }else return fail('射击未命中');
    P.stepIdx++;
  }else if(step.type==='heal'){
    const a=S.squad.find(x=>x.id===step.target);
    if(!a||a.hp<=0) return fail('治疗目标无法行动');
    if(dist(u,a)>1) return fail('尚未接近治疗目标');
    if(Math.random()<0.9){
      a.hp=Math.min(a.maxHp,a.hp+u.heal);
      addLog(`[${u.name}] 为 ${a.name} 恢复 ${u.heal} 点生命`);
    }else return fail('治疗操作被打断');
    P.stepIdx++;
  }else if(step.type==='overwatch'){
    u.overwatch=true; P.stepIdx++;
  }
}
