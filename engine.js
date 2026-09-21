(function(){
  "use strict";
  const D = window.DEFAULTS;
  function clone(v){ return JSON.parse(JSON.stringify(v)); }
  function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
  function money(v){ return Number.isFinite(v) ? v.toFixed(1) : "—"; }

  function effectiveWorld(state, override={}){
    const s = {...state.settings, ...override};
    const rawMax = Math.max(1, ...state.load);
    const scale = Number(s.peakLoad) / rawMax;
    const loads = state.load.map(v => v * scale);
    const mean = state.basePrice.reduce((a,b)=>a+b,0) / state.basePrice.length;
    const m = Number(s.spreadMultiplier);
    const prices = state.basePrice.map(p => Math.max(0, mean + (p-mean)*m));
    return {settings:s, loads, prices, originalPeak:Number(s.peakLoad)};
  }

  function evaluatePlan(plan, world){
    const s=world.settings, eta=Math.sqrt(Number(s.efficiency));
    const usable=Number(plan.ratedEnergy)*Number(s.soh);
    const maxPower=Number(plan.ratedPower)*Number(s.soh);
    const minE=usable*Number(s.minSoc), maxE=usable*Number(s.maxSoc);
    let energy=usable*Number(s.initialSoc);
    const violations=[], series=[], netLoads=[];
    let chargeEnergy=0, dischargeEnergy=0, arb=0, maxNetLoad=-Infinity;
    let maxAbsPower=0, minSocSeen=1, maxSocSeen=0;

    plan.schedule.forEach((cell,h)=>{
      const p=Number(cell.power)||0, before=energy;
      const next=p<0 ? energy+(-p)*eta : energy-p/eta;
      const local=[];
      if(Math.abs(p)>maxPower+1e-6) local.push(`${D.hours[h]} 功率 ${Math.abs(p).toFixed(0)}kW 超过当前可用功率 ${maxPower.toFixed(0)}kW`);
      if(next<minE-1e-6) local.push(`${D.hours[h]} SOC 跌破下限 ${(s.minSoc*100).toFixed(0)}%（缺 ${(minE-next).toFixed(1)}kWh）`);
      if(next>maxE+1e-6) local.push(`${D.hours[h]} SOC 超过上限 ${(s.maxSoc*100).toFixed(0)}%（超 ${(next-maxE).toFixed(1)}kWh）`);
      if(p>world.loads[h]+1e-6) local.push(`${D.hours[h]} 放电 ${p.toFixed(0)}kW 超过本地负荷 ${world.loads[h].toFixed(0)}kW，存在反送`);
      violations.push(...local);
      energy=clamp(next,minE,maxE);
      if(p<0) chargeEnergy+=-p;
      if(p>0) dischargeEnergy+=p;
      arb+=p*world.prices[h];
      maxAbsPower=Math.max(maxAbsPower,Math.abs(p));
      minSocSeen=Math.min(minSocSeen,energy/usefulSafe(usable));
      maxSocSeen=Math.max(maxSocSeen,energy/usefulSafe(usable));
      const net=Math.max(0,world.loads[h]-p);
      netLoads.push(net); maxNetLoad=Math.max(maxNetLoad,net);
      series.push({hour:h,p,before,next:energy,net,violation:local});
    });
    const endSoc=energy/usefulSafe(usable);
    if(endSoc<Number(s.minEndSoc)-1e-6) violations.push(`日终 SOC ${(endSoc*100).toFixed(1)}% 低于可持续运行下限 ${(s.minEndSoc*100).toFixed(0)}%`);
    const baselinePeak=Math.max(...world.loads);
    const peakReduction=Math.max(0,baselinePeak-maxNetLoad);
    const demandBenefit=peakReduction*Number(s.demandCharge)/30;
    const throughput=chargeEnergy+dischargeEnergy;
    const agingMultiplier=2-Number(s.soh);
    const degradationCost=throughput*Number(s.degradationCost)*agingMultiplier;
    const netBenefit=arb+demandBenefit-degradationCost;
    const energyCost=world.loads.reduce((sum,l,h)=>sum+l*world.prices[h],0);
    const powerMargin=maxPower===0?0:1-maxAbsPower/maxPower;
    const socMargin=Math.min(minSocSeen-s.minSoc,s.maxSoc-maxSocSeen,endSoc-s.minEndSoc);
    const safetyIndex=clamp(100*Math.min(1,Math.max(0,socMargin)/.20,powerMargin/.25),0,100);
    const peakIndex=clamp(100*peakReduction/baselinePeak*4,0,100);
    return {id:plan.id,plan,feasible:violations.length===0,violations,series,netLoads,
      arb,demandBenefit,degradationCost,netBenefit,energyCost,chargeEnergy,dischargeEnergy,
      throughput,peakReduction,maxNetLoad,endSoc,minSocSeen,maxSocSeen,maxAbsPower,
      maxPower,safetyIndex,peakIndex,score:null};
  }
  function usefulSafe(v){ return v > 0 ? v : 1; }
  function rank(state, override={}){
    const world=effectiveWorld(state,override);
    const results=state.plans.map(p=>evaluatePlan(p,world));
    const feasible=results.filter(r=>r.feasible);
    const benefits=feasible.map(r=>r.netBenefit);
    const min=Math.min(0,...benefits), max=Math.max(1,...benefits);
    const wE=Number(state.preferences.eco),wS=Number(state.preferences.safe),wP=Number(state.preferences.peak);
    const wSum=Math.max(1,wE+wS+wP);
    results.forEach(r=>{
      if(!r.feasible){r.economicIndex=0;r.score=-999;return;}
      r.economicIndex=clamp((r.netBenefit-min)/(max-min)*100,0,100);
      r.score=(r.economicIndex*wE+r.safetyIndex*wS+r.peakIndex*wP)/wSum;
    });
    results.sort((a,b)=>(b.feasible-a.feasible)||b.score-a.score||b.netBenefit-a.netBenefit);
    results.forEach((r,i)=>r.rank=r.feasible?i+1:null);
    return {world,results};
  }
  function meta(key){return D.paramsMeta.find(m=>m.key===key);}
  function mergeIntervals(list,withReasons){
    if(!list.length) return [];
    const out=[];
    list.forEach(x=>{
      const last=out[out.length-1];
      if(last&&Math.abs(x.lo-last.hi)<1e-5){
        last.hi=x.hi;
        if(withReasons) last.reasons=[...new Set([...last.reasons,...(x.reasons||[])])].slice(0,3);
      } else out.push({...x});
    });
    return out;
  }
  function mergeLeader(list){
    const out=[];
    list.forEach(x=>{
      const last=out[out.length-1];
      if(last&&last.leader===x.leader) last.hi=x.hi;
      else out.push({...x});
    });
    return out;
  }
  function bisectBoundary(state,key,a,b,pred){
    let lo=a,hi=b,start=pred(a);
    for(let i=0;i<30&&hi-lo>1e-7;i++){
      const mid=(lo+hi)/2;
      if(pred(mid)===start) lo=mid; else hi=mid;
    }
    return (lo+hi)/2;
  }
  function summarizeSensitivity(state,key){
    const m=meta(key),current=Number(state.settings[key]);
    if(state.locks[key]) return {key,meta:m,locked:true,current,leaderIntervals:[],pairFlips:[],feasibility:[]};
    const N=101,points=[];
    for(let i=0;i<N;i++) points.push(m.scanMin+(m.scanMax-m.scanMin)*i/(N-1));
    const evalAt=x=>rank(state,{[key]:x}).results;
    const idOrder=rs=>rs.map(r=>r.id+(r.feasible?"":"(不可行)")).join(">");
    const row=(rs,id)=>rs.find(r=>r.id===id);
    const score=(rs,id)=>row(rs,id)?.score ?? -Infinity;
    const feasible=(rs,id)=>Boolean(row(rs,id)?.feasible);
    const ids=state.plans.map(p=>p.id);
    const currentResults=evalAt(current);
    const cuts=[m.scanMin,m.scanMax];

    ids.forEach(id=>{
      for(let i=1;i<N;i++){
        if(feasible(evalAt(points[i-1]),id)!==feasible(evalAt(points[i]),id))
          cuts.push(bisectBoundary(state,key,points[i-1],points[i],x=>feasible(evalAt(x),id)));
      }
    });
    for(let a=0;a<ids.length;a++) for(let b=a+1;b<ids.length;b++){
      const A=ids[a],B=ids[b];
      for(let i=1;i<N;i++){
        const r1a=row(evalAt(points[i-1]),A),r1b=row(evalAt(points[i-1]),B);
        const r2a=row(evalAt(points[i]),A),r2b=row(evalAt(points[i]),B);
        if(!r1a.feasible||!r1b.feasible||!r2a.feasible||!r2b.feasible) continue;
        const s1=Math.sign(r1a.score-r1b.score),s2=Math.sign(r2a.score-r2b.score);
        if(s1!==s2) cuts.push(bisectBoundary(state,key,points[i-1],points[i],
          x=>Math.sign(score(evalAt(x),A)-score(evalAt(x),B))));
      }
    }
    const uniq=[...new Set(cuts.map(v=>Number(v.toFixed(6))))].sort((a,b)=>a-b);
    const raw=[];
    for(let i=0;i<uniq.length-1;i++){
      const lo=uniq[i],hi=uniq[i+1],rs=evalAt((lo+hi)/2);
      const frs=rs.filter(r=>r.feasible);
      raw.push({lo,hi,leader:frs[0]?.id||"none",leaderName:frs[0]?.plan.name||"无可行方案",order:idOrder(rs),results:rs});
    }
    const leaderIntervals=mergeLeader(raw);
    return finishSummary(state,key,m,current,ids,raw,leaderIntervals,score,idOrder(currentResults));
  }
  function finishSummary(state,key,m,current,ids,raw,leaderIntervals,score,baseOrder){
    const currentRankAll=rank(state,{[key]:current}).results;
    const currentRank=currentRankAll.filter(r=>r.feasible);
    const baseScores=Object.fromEntries(currentRank.map(r=>[r.id,r.score]));
    const pairFlips=[];
    for(let a=0;a<ids.length;a++) for(let b=a+1;b<ids.length;b++){
      const A=ids[a],B=ids[b];
      const nameA=state.plans.find(p=>p.id===A).name;
      const nameB=state.plans.find(p=>p.id===B).name;
      const baseA=currentRank.find(r=>r.id===A),baseB=currentRank.find(r=>r.id===B);
      if(!baseA||!baseB) continue;
      const intervals=[];
      raw.forEach(seg=>{
        const nowARow=seg.results.find(r=>r.id===A),nowBRow=seg.results.find(r=>r.id===B);
        if(!nowARow||!nowBRow||!nowARow.feasible||!nowBRow.feasible) return;
        const nowA=nowARow.score,nowB=nowBRow.score;
        const flipped=baseScores[A]>baseScores[B] ? nowA<nowB : nowA>nowB;
        if(flipped) intervals.push({lo:seg.lo,hi:seg.hi});
      });
      const merged=mergeIntervals(intervals);
      if(merged.length) pairFlips.push({nameA,nameB,baseAhead:baseA.score>baseB.score?nameA:nameB,intervals:merged});
    }
    const feasibility=ids.map(id=>{
      const intervals=[];
      raw.forEach(seg=>{
        const r=seg.results.find(x=>x.id===id);
        if(!r.feasible) intervals.push({lo:seg.lo,hi:seg.hi,reasons:[...new Set(r.violations.map(v=>v.split("（")[0]))].slice(0,3)});
      });
      return {id,name:state.plans.find(p=>p.id===id).name,intervals:mergeIntervals(intervals,true)};
    }).filter(x=>x.intervals.length);
    return {key,meta:m,locked:false,current,currentLeader:currentRank[0]?.id||"none",
      leaderIntervals,pairFlips,feasibility,baseOrder};
  }
  window.Engine={D,clone,clamp,money,effectiveWorld,evaluatePlan,rank,meta,mergeIntervals,mergeLeader,summarizeSensitivity};
})();
