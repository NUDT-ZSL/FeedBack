/* 示例数据：功率正数表示放电，负数表示充电，单位 kW；电量单位 kWh */
window.DEFAULTS = (() => {
  const hours = Array.from({length:24}, (_,h)=>`${String(h).padStart(2,"0")}:00`);
  const basePrice = [
    0.34,0.32,0.31,0.30,0.30,0.32,0.38,0.52,
    0.82,0.96,1.05,0.78,0.62,0.55,0.68,0.86,
    1.08,1.22,1.18,0.96,0.78,0.62,0.48,0.38
  ];
  const load = [
    420,400,390,380,390,430,520,680,
    820,900,930,870,760,700,720,800,
    940,1080,1060,940,780,650,540,460
  ];
  function schedule(values){ return values.map((p,h)=>({hour:h,power:p})); }
  const plans = [
    {
      id:"p1", name:"保守套利", color:"#146cff", ratedEnergy:1500, ratedPower:300,
      schedule: schedule([-120,-120,-100,-80,0,0,0,0,0,0,0,0,0,0,0,0,140,170,150,0,0,0,0,0])
    },
    {
      id:"p2", name:"激进价差", color:"#d1495b", ratedEnergy:1500, ratedPower:300,
      schedule: schedule([-220,-220,-180,0,0,0,0,0,0,0,0,0,0,0,0,0,200,240,230,0,0,0,0,0])
    },
    {
      id:"p3", name:"均衡调度", color:"#0a8a54", ratedEnergy:1500, ratedPower:300,
      schedule: schedule([-160,-160,-140,-70,0,0,0,0,0,0,0,0,-80,0,0,0,180,230,200,0,0,0,0,0])
    },
    {
      id:"p4", name:"削峰优先", color:"#7343d4", ratedEnergy:1500, ratedPower:300,
      schedule: schedule([-190,-190,-170,-70,0,0,0,0,0,0,0,0,0,0,0,40,120,190,250,80,0,0,0,0])
    }
  ];
  return {
    settings:{
      efficiency:.93, minSoc:.10, maxSoc:.95, initialSoc:.50,
      minEndSoc:.40, demandCharge:38, spreadMultiplier:1,
      peakLoad:1080, soh:.90, degradationCost:.18
    },
    paramsMeta:[
      {key:"peakLoad", label:"负荷峰值", unit:"kW", min:700, max:1400, step:10, scanMin:800, scanMax:1300, lockable:true},
      {key:"soh", label:"电池健康度 SOH", unit:"", min:.55, max:1, step:.01, scanMin:.65, scanMax:1, lockable:true, percent:true},
      {key:"degradationCost", label:"基础衰减成本", unit:"元/kWh", min:0, max:.60, step:.01, scanMin:.05, scanMax:.45, lockable:true},
      {key:"spreadMultiplier", label:"峰谷价差系数", unit:"×", min:.40, max:2, step:.01, scanMin:.60, scanMax:1.80, lockable:true},
      {key:"demandCharge", label:"需量电价", unit:"元/kW·月", min:0, max:80, step:1, scanMin:0, scanMax:70, lockable:true}
    ],
    basePrice, load, hours, plans
  };
})();
