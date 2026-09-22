(function () {
  "use strict";
  window.DemoPlanner.sampleData = {
    containers: [
      { id:"B1", name:"标准托盘箱", l:120, w:80, h:100, maxWeight:650, count:2 }
    ],
    cargos: [
      { id:"C1", name:"发电机组", l:70, w:50, h:45, weight:140, loadCapacity:80, stackable:true, rotatable:true, flippable:false, color:"#2563eb" },
      { id:"C2", name:"控制机柜", l:55, w:45, h:60, weight:95, loadCapacity:40, stackable:true, rotatable:true, flippable:false, color:"#0891b2" },
      { id:"C3", name:"冷却液", l:40, w:35, h:35, weight:55, loadCapacity:0, stackable:false, rotatable:true, flippable:false, color:"#059669" },
      { id:"C4", name:"食材包", l:50, w:40, h:30, weight:35, loadCapacity:20, stackable:true, rotatable:true, flippable:true, color:"#d97706" },
      { id:"C5", name:"线束盘", l:45, w:45, h:25, weight:45, loadCapacity:35, stackable:true, rotatable:true, flippable:true, color:"#dc2626" },
      { id:"C6", name:"蓄电池组", l:60, w:40, h:35, weight:120, loadCapacity:0, stackable:false, rotatable:true, flippable:false, color:"#7c3aed" },
      { id:"C7", name:"精密仪表", l:35, w:30, h:30, weight:30, loadCapacity:0, stackable:false, rotatable:true, flippable:false, color:"#0f766e" },
      { id:"C8", name:"工具箱", l:50, w:35, h:25, weight:40, loadCapacity:45, stackable:true, rotatable:true, flippable:true, color:"#be123c" },
      { id:"C9", name:"备品箱", l:40, w:30, h:25, weight:30, loadCapacity:25, stackable:true, rotatable:true, flippable:true, color:"#4d7c0f" }
    ],
    relations: [
      { id:"R1", a:"C3", b:"C4", type:"incompatible" },
      { id:"R2", a:"C2", b:"C7", type:"adjacent" }
    ],
    supportRatio:0.9
  };
})();
