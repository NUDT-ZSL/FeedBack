'use strict';
// ===== 面板刷新：角色状态、当前计划、候选对比、日志 =====
const $=id=>document.getElementById(id);

function refreshUI(){
  draw();
  // 角色卡片
  $('squad').innerHTML=S.squad.map(u=>{
    const P=S.plans[u.id];
    const plan=P&&P.current?P.current:'—';
    const prog=P&&P.current?`${Math.min(P.stepIdx,P.current.steps.length)}/${P.current.steps.length}步`:'';
    const tags=[u.status,u.overwatch?'监视':'',u.manual?'手动':''].filter(Boolean)
      .map(t=>`<span class="tag${t==='手动'?' manual':''}">${t}</span>`).join('');
    return `<div class="card${u.id===S.selected?' sel':''}${u.hp<=0?' dead':''}" data-id="${u.id}">
      <b>${u.name}</b> <span class="muted">${u.skill}</span> ${tags}<br>
      HP ${Math.max(0,u.hp)}/${u.maxHp}<div class="bar hp"><i style="width:${100*u.hp/u.maxHp}%"></i></div>
      AP ${u.ap}/${u.maxAp}<div class="bar ap"><i style="width:${100*u.ap/u.maxAp}%"></i></div>
      <div class="muted">计划：${plan.name||plan} ${prog}</div>
    </div>`;
  }).join('');
  document.querySelectorAll('#squad .card').forEach(c=>
    c.onclick=()=>{S.selected=c.dataset.id;refreshUI();});
  // 当前计划详情
  const u=S.squad.find(x=>x.id===S.selected);
  const P=u&&S.plans[u.id];
  if(P&&P.current){
    const steps=P.current.steps.map((s,i)=>{
      const cls=i<P.stepIdx?'done':(i===P.stepIdx?'now':'todo');
      const icon=i<P.stepIdx?'✔':(i===P.stepIdx?'▶':'·');
      return `<li class="${cls}">${icon} ${stepText(s)}（${s.cost}AP）</li>`;
    }).join('');
    $('planDetail').innerHTML=
      `<div><b>${P.current.name}</b> <span class="muted">预期：${P.current.expected}</span></div>
       <ul class="steps">${steps}</ul>
       <div class="reason">选择理由：${P.reason}</div>`;
  }else $('planDetail').innerHTML='<span class="muted">暂无计划</span>';
  // 候选对比
  if(P&&P.cands.length){
    const rows=P.cands.map(c=>
      `<tr class="${P.current&&c.id===P.current.id?'cur':''}">
        <td>${c.name}</td><td>${c.goal}</td><td>${c.cost}AP</td><td>${c.risk}</td><td><b>${c.score}</b></td>
      </tr>`).join('');
    $('cands').innerHTML=`<table><tr><th>候选计划</th><th>目标收益</th><th>消耗</th><th>风险</th><th>总分</th></tr>${rows}</table>`;
  }else $('cands').textContent='—';
  // 日志
  $('logs').innerHTML=S.logs.slice(-9).reverse().map(l=>`<div>${l}</div>`).join('');
  $('fails').innerHTML=S.fails.slice(-7).reverse().map(l=>`<div>${l}</div>`).join('');
}

function stepText(s){
  if(s.type==='move') return `移动 ${s.path.length} 格`;
  if(s.type==='attack') return `攻击 ${s.target}`;
  if(s.type==='heal') return `治疗 ${s.target}`;
  if(s.type==='overwatch') return '进入监视';
  return s.type;
}

function addLog(msg){ S.logs.push(`[回合${S.round}] ${msg}`); }
function addFail(msg){ S.fails.push(`[回合${S.round}] ${msg}`); }
