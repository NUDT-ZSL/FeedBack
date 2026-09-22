'use strict';
// ===== 交互控制：运行控制、人工干预、环境变化模拟 =====

function setRunning(on){
  S.running=on;
  clearInterval(S.timer);
  if(on) S.timer=setInterval(tick,+document.getElementById('speed').value);
  document.getElementById('btnRun').textContent=on?'⏸ 暂停':'▶ 开始';
}

// 人工干预：手动指定移动目标，立即生成手动计划并执行
function manualMove(u,x,y){
  const p=pathTo(u,x,y);
  if(!p||!p.length) return;
  const plan=finalize(u,{kind:'manual',name:'手动移动',steps:[moveStep(u,p)],
    expected:`按用户指令移动至 (${x},${y})`,goalMetric:0});
  plan.score=99;
  const P=S.plans[u.id]||replanUnit(u,'初始化');
  P.current=plan; P.stepIdx=0; u.manual=true;
  P.reason='用户手动指令，优先级最高；执行完毕后恢复自动规划。';
  addLog(`[${u.name}] 用户干预：手动移动至 (${x},${y})，立即更新后续行为`);
  refreshUI();
}

function bindUI(){
  document.getElementById('btnRun').onclick=()=>setRunning(!S.running);
  document.getElementById('btnStep').onclick=()=>{setRunning(false);tick();};
  document.getElementById('speed').onchange=e=>{
    if(S.running){setRunning(false);setRunning(true);}
  };
  document.getElementById('chkVision').onchange=e=>{S.showVision=e.target.checked;refreshUI();};
  // 目标权重调整 → 立即触发全员重规划
  [['wElim','elim','wElimV'],['wObj','obj','wObjV'],['wSurv','surv','wSurvV']]
    .forEach(([id,key,vid])=>{
      document.getElementById(id).oninput=e=>{
        S.weights[key]=e.target.value/100;
        document.getElementById(vid).textContent=S.weights[key].toFixed(2);
        for(const u of aliveSquad()) replanUnit(u,'目标优先级调整');
        refreshUI();
      };
    });
  // 画布点击：选中角色 / 下达手动移动
  cv.addEventListener('click',e=>{
    const r=cv.getBoundingClientRect();
    const x=Math.floor((e.clientX-r.left)/CELL), y=Math.floor((e.clientY-r.top)/CELL);
    const u=S.squad.find(a=>a.hp>0&&a.x===x&&a.y===y);
    if(u){ S.selected=u.id; refreshUI(); return; }
    const sel=S.squad.find(a=>a.id===S.selected&&a.hp>0);
    if(sel&&inBounds(x,y)&&S.grid[y][x]!==T.WALL&&!tileBlocked(x,y)) manualMove(sel,x,y);
  });
  // 环境变化模拟
  document.getElementById('btnEnemy').onclick=()=>{
    enemyPhase();
    refreshUI();
  };
  document.getElementById('btnWall').onclick=()=>{
    const spots=[];
    for(let y=0;y<ROWS;y++)for(let x=3;x<COLS-3;x++)
      if(S.grid[y][x]===T.FLOOR&&!tileBlocked(x,y)) spots.push([x,y]);
    if(!spots.length) return;
    const [x,y]=spots[Math.floor(Math.random()*spots.length)];
    S.grid[y][x]=T.WALL;
    for(const u of aliveSquad()) replanUnit(u,`环境变化：(${x},${y}) 出现新障碍`);
    refreshUI();
  };
  document.getElementById('btnUnwall').onclick=()=>{
    const walls=[];
    for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++)
      if(S.grid[y][x]===T.WALL) walls.push([x,y]);
    if(!walls.length) return;
    const [x,y]=walls[Math.floor(Math.random()*walls.length)];
    S.grid[y][x]=T.FLOOR;
    for(const u of aliveSquad()) replanUnit(u,`环境变化：(${x},${y}) 障碍被清除`);
    refreshUI();
  };
}

// 初始化：为每名角色生成首批计划
bindUI();
for(const u of aliveSquad()) replanUnit(u,'任务开始，初始规划');
refreshUI();
