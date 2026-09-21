(function(){
  "use strict";
  const {D,clone,money,rank,summarizeSensitivity} = window.Engine;
  const $=s=>document.querySelector(s);
  const storeKey="storage-dispatch-compare-v1";
  let state=loadState();
  let last=null;

  function freshState(){
    return {settings:clone(D.settings),basePrice:clone(D.basePrice),load:clone(D.load),
      plans:clone(D.plans),locks:{},preferences:{eco:50,safe:30,peak:20},pinned:""};
  }
  function loadState(){
    try{
      const raw=localStorage.getItem(storeKey);
      if(!raw) return freshState();
      const parsed=JSON.parse(raw);
      const base=freshState(), merged={...base,...parsed};
      merged.settings={...base.settings,...(parsed.settings||{})};
      merged.preferences=Object.fromEntries(["eco","safe","peak"].map(k=>[k,Number(parsed.preferences?.[k] ?? base.preferences[k])||0]));
      merged.locks=parsed.locks&&typeof parsed.locks==="object"?parsed.locks:{};
      merged.basePrice=Array.isArray(parsed.basePrice)&&parsed.basePrice.length===24?parsed.basePrice:base.basePrice;
      merged.load=Array.isArray(parsed.load)&&parsed.load.length===24?parsed.load:base.load;
      merged.plans=Array.isArray(parsed.plans)&&parsed.plans.length?parsed.plans.map(normalizePlan):base.plans;
      return merged;
    }catch(e){return freshState();}
  }
  function normalizePlan(p,i){
    const base=freshState().plans[0];
    const schedule=Array.isArray(p.schedule)&&p.schedule.length===24
      ? p.schedule.map((c,h)=>({hour:h,power:Number(c.power)||0}))
      : Array.from({length:24},(_,h)=>({hour:h,power:0}));
    return {id:String(p.id||uid()),name:String(p.name||`候选方案 ${i+1}`),
      color:String(p.color||base.color),ratedEnergy:Number(p.ratedEnergy)||1,
      ratedPower:Number(p.ratedPower)||1,schedule};
  }
  function save(){ try{localStorage.setItem(storeKey,JSON.stringify(state));}catch(e){} }
  function fmt(n,d=1){return Number.isFinite(Number(n))?Number(n).toFixed(d):"—";}
  function pct(n,d=0){return `${(Number(n)*100).toFixed(d)}%`;}
  function planName(id){return state.plans.find(p=>p.id===id)?.name || "—";}
  function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
  function valLabel(m,x){return m.percent?pct(x,1):`${fmt(x,m.step<1?2:0)}${m.unit?` ${m.unit}`:""}`;}
  function uid(){return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2,6)}`;}
  function byId(id){return last.results.find(r=>r.id===id);}

  function render(){
    last=rank(state);
    renderControls();
    renderPinned();
    renderOutputs(false);
    save();
  }
  function renderOutputs(refreshControls=true){
    if(refreshControls) renderControls();
    last=rank(state);
    renderCards();
    renderTable();
    renderChart();
    renderSensitivity();
    renderPlanEditor();
  }

  function renderControls(){
    const box=$("#paramControls");
    box.innerHTML=D.paramsMeta.map(m=>{
      const v=state.settings[m.key], locked=Boolean(state.locks[m.key]);
      return `<div class="field ${locked?"is-locked":""}">
        <div class="lock-row"><label>${m.label}</label>
        <label><input type="checkbox" data-lock="${m.key}" ${locked?"checked":""}>锁定</label></div>
        <input type="range" min="${m.min}" max="${m.max}" step="${m.step}" value="${v}" data-param="${m.key}" ${locked?"disabled":""}>
        <span><small>扫描 ${valLabel(m,m.scanMin)} ~ ${valLabel(m,m.scanMax)}</small><b>${valLabel(m,v)}</b></span>
      </div>`;
    }).join("");
    $("#priceEditor").innerHTML=D.hours.map((h,i)=>`<div class="price-cell">
      <span>${h}</span><input type="number" step="0.01" min="0" value="${state.basePrice[i]}" data-price="${i}"></div>`).join("");
    $("#loadEditor").innerHTML=D.hours.map((h,i)=>`<div class="price-cell">
      <span>${h}</span><input type="number" step="1" min="0" value="${fmt(state.load[i],0)}" data-load="${i}"></div>`).join("");
    ["eco","safe","peak"].forEach(k=>{
      $("#"+k+"Weight").value=state.preferences[k];
      $("#"+k+"WeightLabel").textContent=`${state.preferences[k]}%`;
    });
  }

  function renderPinned(){
    const sel=$("#pinnedPlan");
    sel.innerHTML=`<option value="">不固定（按综合分推荐）</option>`+
      state.plans.map(p=>`<option value="${p.id}" ${state.pinned===p.id?"selected":""}>固定：${esc(p.name)}</option>`).join("");
  }

  function renderCards(){
    const box=$("#cards");
    const feasibleResults=last.results.filter(r=>r.feasible);
    const rawBest=feasibleResults[0];
    const pinnedResult=state.pinned ? byId(state.pinned) : null;
    const recommended=pinnedResult&&pinnedResult.feasible?pinnedResult:rawBest;
    box.innerHTML=(feasibleResults.length?"":`<div class="flip-note" style="grid-column:1/-1">当前参数下没有可行方案；请查看下列越界约束，或调整电池 SOH、额定容量/功率及分时安排。</div>`)+
      last.results.map(r=>{
      const isRec=recommended&&recommended.id===r.id, isPinned=state.pinned===r.id;
      const tags=[];
          if(isRec) tags.push(`<span class="tag good">${isPinned?"按偏好执行":"当前推荐"}</span>`);
          if(isPinned&&!isRec) tags.push(`<span class="tag warn">${r.feasible?"固定偏好":"固定但不可执行"}</span>`);
      if(!r.feasible) tags.push(`<span class="tag bad">不可行</span>`);
      if(r.rank===1&&r.feasible) tags.push(`<span class="tag">原始排序 #1</span>`);
      return `<article class="plan-card ${isRec?"best":""} ${r.feasible?"":"invalid"} ${isPinned?"pinned":""}">
        <h3>${esc(r.plan.name)}</h3>
        <div class="rank">${r.feasible?`综合排序 #${r.rank} · 综合分 ${fmt(r.score,1)}`:"不参与可行方案排序"}</div>
        <div class="big ${r.netBenefit>=0?"":"bad"}">${money(r.netBenefit)} <small class="muted">元/日</small></div>
        <div class="kv">
          <span>套利收益</span><b>${money(r.arb)}</b>
          <span>需量收益</span><b>${money(r.demandBenefit)}</b>
          <span>衰减成本</span><b class="bad">${money(r.degradationCost)}</b>
          <span>削减峰值</span><b>${fmt(r.peakReduction,0)} kW</b>
          <span>日终 SOC</span><b>${pct(r.endSoc,1)}</b>
          <span>安全裕度</span><b>${r.feasible?`${fmt(r.safetyIndex,0)}/100`:"—"}</b>
        </div>
        <div class="tags">${tags.join("")}</div>
        ${r.feasible?"":`<div class="violations">${r.violations.slice(0,4).map(v=>`<div>⚠ ${esc(v)}</div>`).join("")}</div>`}
      </article>`;
    }).join("");
  }

  function renderTable(){
    const rows=last.results;
    const headers=["方案","状态","净收益(元/日)","套利","需量收益","衰减成本","峰荷(kW)","削峰(kW)","充电(kWh)","放电(kWh)","日终SOC","最低SOC","功率峰值(kW)","综合分"];
    $("#metricsTable").innerHTML=`<thead><tr>${headers.map(h=>`<th>${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(r=>`<tr class="${r.rank===1&&r.feasible?"best":""}">
        <td><span style="display:inline-block;width:8px;height:8px;background:${r.plan.color};border-radius:50%;margin-right:6px"></span>${esc(r.plan.name)}</td>
        <td style="color:${r.feasible?"var(--green)":"var(--red)"}">${r.feasible?"可行":"越界"}</td>
        <td><b>${money(r.netBenefit)}</b></td><td>${money(r.arb)}</td><td>${money(r.demandBenefit)}</td>
        <td>${money(r.degradationCost)}</td><td>${fmt(r.maxNetLoad,0)}</td><td>${fmt(r.peakReduction,0)}</td>
        <td>${fmt(r.chargeEnergy,0)}</td><td>${fmt(r.dischargeEnergy,0)}</td><td>${pct(r.endSoc,1)}</td>
        <td>${pct(r.minSocSeen,1)}</td><td>${fmt(r.maxAbsPower,0)}/${fmt(r.maxPower,0)}</td>
        <td><b>${r.feasible?fmt(r.score,1):"—"}</b></td></tr>
        ${r.feasible?"":r.violations.map(v=>`<tr><td colspan="14" style="text-align:left;color:var(--red)">约束突破：${esc(v)}</td></tr>`).join("")}
      </tbody>`).join("")}</tbody>`;
  }

  function renderChart(){
    const w=920,h=330,L=54,R=18,T=18,B=42;
    const all=[];
    last.results.forEach(r=>r.netLoads.forEach(v=>all.push(v)));
    last.world.loads.forEach(v=>all.push(v));
    const maxY=Math.max(...all)*1.08, minY=0;
    const X=h=>L+(w-L-R)*h/23, Y=v=>T+(h-T-B)*(1-(v-minY)/(maxY-minY));
    const path=(arr,color,width=2,fill="none")=>`<path d="M ${arr.map((v,h)=>`${X(h)},${Y(v)}`).join(" L ")}"
      fill="${fill}" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"></path>`;
    const grid=[0,.25,.5,.75,1].map(q=>{const y=T+(h-T-B)*q,v=maxY*(1-q);
      return `<line class="gridline" x1="${L}" y1="${y}" x2="${w-R}" y2="${y}"></line>
        <text x="8" y="${y+4}" font-size="11" fill="#65737b">${v.toFixed(0)}</text>`}).join("");
    const xLabels=D.hours.filter((_,i)=>i%3===0).map((hr,i)=>`<text x="${X(i*3)}" y="${h-14}" text-anchor="middle" font-size="11" fill="#65737b">${hr}</text>`).join("");
    $("#chart").innerHTML=`<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="24小时负荷与调度曲线">
      ${grid}
      <line class="axis" x1="${L}" y1="${h-B}" x2="${w-R}" y2="${h-B}"></line>
      <line class="axis" x1="${L}" y1="${T}" x2="${L}" y2="${h-B}"></line>
      ${path(last.world.loads,"#5f6c72",2.4)}
      ${state.plans.map(p=>path(byId(p.id).netLoads,p.color,1.8)).join("")}
      ${xLabels}
    </svg>
    <div class="legend"><span><i style="background:#5f6c72"></i>原始负荷</span>
      ${state.plans.map(p=>`<span><i style="background:${p.color}"></i>${esc(p.name)}净负荷</span>`).join("")}
      <span>纵轴：kW；调度输入正值放电、负值充电。</span></div>`;
  }
  function maxPriceForAxis(){return Math.max(...last.world.prices,1);}

  function renderPlanEditor(){
    $("#planEditor").innerHTML=`<h2>维护分时段安排</h2>`+state.plans.map((p,idx)=>{
      const r=byId(p.id);
      return `<details class="plan-edit" ${idx===0?"open":""}>
        <summary><b style="color:${p.color}">${esc(p.name)}</b> · 当前 ${r.feasible?"可行":"不可行"}</summary>
        <div class="plan-edit-head">
          <label>方案名称 <input data-plan-field="name" data-plan="${p.id}" value="${esc(p.name)}" style="width:180px"></label>
          <label>额定电量 kWh <input type="number" min="1" data-plan-field="ratedEnergy" data-plan="${p.id}" value="${p.ratedEnergy}" style="width:120px"></label>
          <label>额定功率 kW <input type="number" min="1" data-plan-field="ratedPower" data-plan="${p.id}" value="${p.ratedPower}" style="width:120px"></label>
          <button class="danger" data-action="deletePlan" data-plan="${p.id}">删除</button>
        </div>
        <div class="schedule-grid">${p.schedule.map(c=>`<div class="schedule-cell">
          <label>${D.hours[c.hour]} ${state.basePrice[c.hour].toFixed(2)}元</label>
          <input type="number" step="1" data-schedule="${p.id}" data-hour="${c.hour}" value="${c.power}">
        </div>`).join("")}</div>
      </details>`;
    }).join("");
  }

  document.addEventListener("change",e=>{
    const t=e.target;
    if(t.dataset.schedule){
      const p=state.plans.find(x=>x.id===t.dataset.schedule);
      p.schedule[Number(t.dataset.hour)].power=Number(t.value)||0; render();
    }
    if(t.dataset.plan){
      const p=state.plans.find(x=>x.id===t.dataset.plan);
      if(t.dataset.planField==="name") p.name=t.value || p.name;
      else p[t.dataset.planField]=Math.max(1,Number(t.value)||1);
      render();
    }
  });

  function renderSensitivity(){
    const box=$("#sensitivityList");
    box.innerHTML=D.paramsMeta.map(m=>renderOneSensitivity(m.key)).join("");
  }
  function renderOneSensitivity(key){
    const s=summarizeSensitivity(state,key);
    if(s.locked) return `<article class="sens-card locked"><div class="sens-title"><span>${s.meta.label}</span><span>已锁定</span></div>
      <p class="hint">该参数保持 ${valLabel(s.meta,s.current)}，未进行扫描。</p></article>`;
    const currentText=valLabel(s.meta,s.current);
    const leaders=s.leaderIntervals.map(seg=>`<div class="interval">
      <span>${fmtRange(s.meta,seg.lo,seg.hi)}</span><b style="color:${colorOf(seg.leader)}">${esc(seg.leaderName)}</b></div>`).join("");
    const flips=s.pairFlips.map(f=>{
      const ranges=f.intervals.map(i=>fmtRange(s.meta,i.lo,i.hi)).join("、");
      return `<div class="interval"><span>${esc(f.nameA)} / ${esc(f.nameB)}</span><b>${ranges}</b></div>
      <div class="hint" style="margin-top:-4px">当前领先：${esc(f.baseAhead)}；区间内二者结论翻转。</div>`;
    }).join("");
    const infeasible=s.feasibility.map(f=>{
      const ranges=f.intervals.map(i=>`<div>${fmtRange(s.meta,i.lo,i.hi)}：${(i.reasons||[]).map(esc).join("；")}</div>`).join("");
      return `<div class="interval"><span>${esc(f.name)}</span><div>${ranges}</div></div>`;
    }).join("");
    const changedLeaders=new Set(s.leaderIntervals.map(x=>x.leader)).size>1;
    return `<article class="sens-card">
      <div class="sens-title"><span>${s.meta.label}</span><span>当前 ${currentText}</span></div>
      <h3 style="font-size:13px;margin:10px 0 4px">领先方案区间</h3>${leaders}
      <h3 style="font-size:13px;margin:12px 0 4px">成对排序翻转</h3>
      <div class="${s.pairFlips.length?"flip-note":"ok-note"}">${s.pairFlips.length?flips:"扫描范围内未发现成对排序翻转。"}</div>
      <h3 style="font-size:13px;margin:12px 0 4px">不可行/越界区间</h3>
      <div class="${s.feasibility.length?"flip-note":"ok-note"}">${s.feasibility.length?infeasible:"扫描范围内所有方案均满足约束。"}</div>
      <p class="hint" style="margin-bottom:0">${changedLeaders?"该参数会改变推荐方案。":"该参数在扫描范围内不改变领先方案，但可能改变次级排序或收益。"}</p>
    </article>`;
  }
  function fmtRange(m,lo,hi){
    const d=m.step<1?2:0;
    return `${fmt(lo,d)} ~ ${fmt(hi,d)}${m.unit?` ${m.unit}`:""}`;
  }
  function colorOf(id){return state.plans.find(p=>p.id===id)?.color || "#333";}

  document.addEventListener("input",e=>{
    const t=e.target;
    if(t.dataset.param){
      state.settings[t.dataset.param]=Number(t.value);
      const m=D.paramsMeta.find(x=>x.key===t.dataset.param);
      t.parentElement.querySelector("b").textContent=valLabel(m,state.settings[m.key]);
      renderOutputs(false); save();
    }
    if(t.dataset.price!==undefined){
      state.basePrice[Number(t.dataset.price)]=Math.max(0,Number(t.value)||0);
      renderOutputs(false); save();
    }
    if(t.dataset.load!==undefined){
      state.load[Number(t.dataset.load)]=Math.max(0,Number(t.value)||0);
      const rawPeak=Math.max(1,...state.load);
      if(!state.locks.peakLoad) state.settings.peakLoad=Math.round(rawPeak);
      const peakMeta=D.paramsMeta.find(x=>x.key==="peakLoad");
      const peakRange=document.querySelector('[data-param="peakLoad"]');
      if(peakRange&&!state.locks.peakLoad) peakRange.value=state.settings.peakLoad;
      const peakLabel=peakRange?.parentElement.querySelector("span b:last-child");
      if(peakLabel&&!state.locks.peakLoad) peakLabel.textContent=valLabel(peakMeta,state.settings.peakLoad);
      renderOutputs(false); save();
    }
    if(t.id==="ecoWeight"||t.id==="safeWeight"||t.id==="peakWeight"){
      state.preferences[t.id.replace("Weight","")]=Number(t.value);
      ["eco","safe","peak"].forEach(k=>$("#"+k+"WeightLabel").textContent=`${state.preferences[k]}%`);
      renderOutputs(false); save();
    }
  });
  document.addEventListener("change",e=>{
    const t=e.target;
    if(t.dataset.lock){state.locks[t.dataset.lock]=t.checked;render();}
    if(t.id==="pinnedPlan"){state.pinned=t.value;render();}
  });
  document.addEventListener("click",e=>{
    const id=e.target.dataset.action;
    if(id==="deletePlan") deletePlan(e.target.dataset.plan);
  });

  $("#addPlanBtn").addEventListener("click",()=>{
    const colors=["#00a6a6","#ee6c4d","#3d5a80","#9d4edd"];
    state.plans.push({id:uid(),name:`候选方案 ${state.plans.length+1}`,
      color:colors[state.plans.length%colors.length],ratedEnergy:700,ratedPower:300,
      schedule:D.hours.map((_,h)=>({hour:h,power:0}))});
    render();
  });
  $("#resetBtn").addEventListener("click",()=>{state=freshState();render();});
  $("#exportBtn").addEventListener("click",exportJson);
  $("#scenarioBase").addEventListener("click",()=>applyScenario({}));
  $("#scenarioStress").addEventListener("click",()=>applyScenario({peakLoad:1200,soh:.82,degradationCost:.22,spreadMultiplier:1.4,demandCharge:50}));
  $("#scenarioSoft").addEventListener("click",()=>applyScenario({peakLoad:850,soh:.96,degradationCost:.12,spreadMultiplier:.8,demandCharge:25}));

  function applyScenario(values){
    Object.entries(values).forEach(([k,v])=>{if(!state.locks[k]) state.settings[k]=v;});
    render();
  }
  function deletePlan(id){
    if(state.plans.length<=1){alert("至少保留一套候选方案。");return;}
    if(!confirm("删除这套候选方案？")) return;
    state.plans=state.plans.filter(p=>p.id!==id);
    if(state.pinned===id) state.pinned="";
    render();
  }
  function exportJson(){
    const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);a.download="储能调度方案对比.json";a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  render();
})();
