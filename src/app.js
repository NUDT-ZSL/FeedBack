"use strict";
/* global TransformCore, DemoScene, TransformMath */
const engine = new TransformCore(DemoScene);
const M = TransformMath;
const canvas = document.getElementById("sceneCanvas");
const ctx = canvas.getContext("2d");
let selectedId = "tool";
let collapsed = new Set();
const camera = {yaw:-38*M.DEG,pitch:28*M.DEG,distance:10.5,target:[0,-0.25,0]};
const orbit={active:false,x:0,y:0};
const drag={active:false,mode:null,axis:null,start:null,startWorld:null,snap:[],coalesce:null};

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const fmt=(x,n=3)=>x==null||!Number.isFinite(x)?"—":(Math.abs(x)<1e-9?0:x).toFixed(n);
const clone=x=>JSON.parse(JSON.stringify(x));
const state=id=>engine.getState(id);
const node=id=>engine.getNode(id);

const BOX_VERTS=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const BOX_EDGES=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
const SPHERE=[];
for(let j=0;j<9;j++)for(let i=0;i<15;i++){
 const theta=i*Math.PI*2/15,phi=(j/8-0.5)*Math.PI;
 SPHERE.push([Math.cos(theta)*Math.cos(phi),Math.sin(phi),Math.sin(theta)*Math.cos(phi)]);
}

function severityOf(s){
 if(!s||s.issues.some(i=>i.severity==="error"))return "bad";
 if(s.issues.some(i=>i.severity==="warning"))return "warn";
 return "ok";
}
function iconFor(n,s){
 const sev=severityOf(s);
 const status=sev==="bad"?'<span class="badge bad">!</span>':sev==="warn"?'<span class="badge warn">⚠</span>':"";
 return `${n.locked?'<span class="badge lock">🔒</span>':""}${status}`;
}

function renderTree(){
 const root=$("#tree");root.innerHTML="";
 const children=new Map([...engine.nodes.keys()].map(id=>[id,[]]));
 const roots=[];
  const disconnected=[];
  for(const n of engine.nodes.values()){
  const s=state(n.id);
  if(s.structureIssue){disconnected.push(n.id);continue;}
  else if(n.parent==null)roots.push(n.id);
  else if(children.has(n.parent))children.get(n.parent).push(n.id);
 }
 for(const arr of children.values())arr.sort((a,b)=>node(a).name.localeCompare(node(b).name,"zh"));
 roots.sort((a,b)=>node(a).name.localeCompare(node(b).name,"zh"));
 function row(id,depth){
  const n=node(id),s=state(id),sev=severityOf(s);
  const kids=children.get(id)||[];
  const div=document.createElement("div");
  div.className=`tree-row ${selectedId===id?"selected":""} ${sev==="bad"?"bad":sev==="warn"?"warn":""}`;
  div.style.paddingLeft=`${6+depth*16}px`;
  div.draggable=true;div.dataset.id=id;
  div.innerHTML=`<span class="twisty">${kids.length?collapsed.has(id)?"▶":"▼":""}</span>
   <span class="swatch" style="background:${n.color}"></span><span class="tree-name">${escapeHtml(n.name)}</span>
   <span class="tree-meta">${iconFor(n,s)}</span>`;
  div.onclick=e=>{if(e.target.classList.contains("twisty")){collapsed.has(id)?collapsed.delete(id):collapsed.add(id);renderTree();}else{selectedId=id;renderAll();}};
  div.ondragstart=e=>{e.dataTransfer.setData("text/plain",id);e.dataTransfer.effectAllowed="move";};
  div.ondragover=e=>{e.preventDefault();div.classList.add("drop-target");};
  div.ondragleave=()=>div.classList.remove("drop-target");
  div.ondrop=e=>{
   e.preventDefault();const id2=e.dataTransfer.getData("text/plain");div.classList.remove("drop-target");
   if(id2!==id){
    const canPreserve=!!state(id2).world;
    apply(()=>canPreserve?engine.changeParent(id2,id):engine.repairParent(id2,id),canPreserve?"拖拽重挂父级":"修复父子关系");
   }
  };
  root.appendChild(div);
  if(!collapsed.has(id))kids.forEach(k=>row(k,depth+1));
 }
 roots.forEach(id=>row(id,0));
 if(disconnected.length){
  const group=document.createElement("div");
  group.className="tree-row bad";
  group.innerHTML='<span class="twisty">▼</span><span class="tree-name">未接入 / 成环对象</span><span class="badge bad">!</span>';
  group.onclick=()=>collapsed.has("__bad__")?collapsed.delete("__bad__"):collapsed.add("__bad__");
  root.appendChild(group);
  if(!collapsed.has("__bad__"))disconnected.forEach(id=>row(id,1));
 }
 renderSummary();
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function renderSummary(){
 const total=engine.nodes.size;
  const bad=[...engine.nodes.keys()].filter(id=>severityOf(state(id))==="bad").length;
  const warn=[...engine.nodes.keys()].filter(id=>severityOf(state(id))==="warn").length;
  const locked=[...engine.nodes.values()].filter(n=>n.locked).length;
  $("#summary").textContent=`${total} 对象 · ${locked} 锁定 · ${bad} 不可信 · ${warn} 警告`;
}

function vecInputs(label,key,value,disabled=false){
 return `<div class="field"><label>${label}</label><div class="vec">${["X","Y","Z"].map((ax,i)=>
  `<span>${ax}<input data-key="${key}" data-index="${i}" type="number" step="0.1" value="${fmt(value[i],4)}" ${disabled?"disabled":""}></span>`).join("")}</div></div>`;
}
function renderInspector(){
 const box=$("#detail");
 const n=node(selectedId),s=state(selectedId);
 if(!n){box.innerHTML='<div class="empty">选择一个对象查看变换。</div>';return;}
 const parents=[["","（场景根）"],...[...engine.nodes.values()].filter(x=>!engine.isAncestor(selectedId,x.id)&&x.id!==selectedId).map(x=>[x.id,x.name])];
 const trust=t=>`<span class="pill ${t?"good":"danger"}">${t?"可信":"不可信"}</span>`;
 const issues=s.issues.map(i=>`<div class="issue ${i.severity}"><b>${i.severity==="error"?"不可信原因":"提示"}</b>：${escapeHtml(i.message)}</div>`).join("")||'<div class="hint">没有已知问题。</div>';
  box.innerHTML=`
  <div>${s.issues.some(i=>i.severity==="error")?'<span class="pill danger">结论不可信</span>':'<span class="pill good">结论可信</span>'}${n.locked?'<span class="pill purple">最终姿态锁定</span>':""}${s.issues.some(i=>i.code==="mirror")?'<span class="pill gold">镜像</span>':""}</div>
 <div class="section">
  <h3>对象</h3>
  <div class="field"><label>名称</label><input id="fName" value="${escapeHtml(n.name)}"></div>
  <div class="field"><label>父级</label><select id="fParent">${parents.map(([id2,name])=>`<option value="${id2}" ${n.parent===id2?"selected":""}>${escapeHtml(name)}</option>`).join("")}</select></div>
  <div class="field"><label>颜色/形状</label><div style="display:flex;gap:6px"><input id="fColor" type="color" value="${n.color}"><select id="fShape"><option value="box" ${n.shape==="box"?"selected":""}>立方体</option><option value="sphere" ${n.shape==="sphere"?"selected":""}>球体</option></select></div></div>
  <div class="lockbar"><button id="btnLock">${n.locked?"解锁最终姿态":"锁定最终姿态"}</button><span>${n.locked?'<span class="pill purple">世界姿态固定</span>':"锁定后调整祖先会自动寻找可动补偿节点"}</span></div>
 </div>
 <div class="section">
  <h3>局部变换 TRS</h3>
  ${vecInputs("位移 T","translation",n.translation)}${vecInputs("欧拉角 R","rotation",n.rotation,!!n.locked)}${vecInputs("缩放 S","scale",n.scale,!!n.locked)}
  <div class="hint">角度采用 XYZ 欧拉角；缩放可以为负。拖动锁定对象会被拒绝。</div>
 </div>
 <div class="section">
  <h3>推导出的世界姿态</h3>
  <div>位置 ${trust(s.trusted.position)}</div>
  <div class="field"><label>位置</label><div class="value-box ${s.trusted.position?"value-ok":"value-bad"}">${s.position?`${fmt(s.position[0])}, ${fmt(s.position[1])}, ${fmt(s.position[2])}`:"不可解"}</div></div>
  <div>朝向 ${trust(s.trusted.orientation)}</div>
  <div class="field"><label>欧拉角</label><div class="value-box ${s.trusted.orientation?"value-ok":"value-bad"}">${s.euler?`${fmt(s.euler[0])}°, ${fmt(s.euler[1])}°, ${fmt(s.euler[2])}°`:"无法可信分解"}</div></div>
  <div>缩放 ${trust(s.trusted.scale)}</div>
  <div class="field"><label>世界缩放</label><div class="value-box ${s.trusted.scale?"value-ok":"value-bad"}">${s.worldScale?`${fmt(s.worldScale[0])}, ${fmt(s.worldScale[1])}, ${fmt(s.worldScale[2])}`:"无法可信分解"}</div></div>
  <div class="field"><label>行列式</label><div class="value-box ${s.det<0?"value-warn":""}">${fmt(s.det,6)}</div></div>
 </div>
 <div class="section"><h3>矩阵与诊断</h3>${issues}</div>`;
  $("#fName").onchange=e=>apply(()=>engine.setNodeName(selectedId,e.target.value),"重命名");
  $("#fParent").onchange=e=>{
   const canPreserve=state(selectedId).world;
   apply(()=>canPreserve?engine.changeParent(selectedId,e.target.value):engine.repairParent(selectedId,e.target.value),
    canPreserve?"保持姿态重挂父级":"修复父子关系");
  };
  $("#fColor").oninput=e=>{engine.nodes.get(selectedId).color=e.target.value;renderTree();};
  $("#fShape").onchange=e=>{engine.nodes.get(selectedId).shape=e.target.value;renderAll();};
  $("#btnLock").onclick=()=>apply(()=>engine.setLocked(selectedId,!node(selectedId).locked),"锁定状态");
  $$("#detail input[data-key]").forEach(input=>{
   input.onchange=()=>{
    const n2=node(selectedId),key=input.dataset.key,idx=Number(input.dataset.index);
    const arr=n2[key].slice();arr[idx]=Number(input.value);
    apply(()=>engine.updateNode(selectedId,{[key]:arr}),"局部变换");
   };
  });
}

function apply(fn,label){
 const old=engine.version;
 const result=fn();
 if(!result||result.ok===false){
  const msg=Array.isArray(result?.errors)?result.errors.join("\n"):result?.errors||"操作被拒绝";
  renderAll();alert(`${label||"操作"}失败：\n${msg}`);return;
 }
 if(engine.version!==old)renderAll();
 else renderStatus();
}

function resize(){
 const dpr=window.devicePixelRatio||1,r=canvas.getBoundingClientRect();
 canvas.width=Math.max(1,Math.floor(r.width*dpr));canvas.height=Math.max(1,Math.floor(r.height*dpr));
 ctx.setTransform(dpr,0,0,dpr,0,0);draw();
}
window.addEventListener("resize",resize);

function basis(){
 const cp=Math.cos(camera.pitch),sp=Math.sin(camera.pitch),cy=Math.cos(camera.yaw),sy=Math.sin(camera.yaw);
 return {
  right:[cy,0,-sy],
  up:[sy*sp,cp,cy*sp],
  forward:[sy*cp,-sp,cy*cp]
 };
}
function project(p){
 const r=canvas.getBoundingClientRect(),b=basis(),q=M.add(p,M.scaleV(camera.target,-1));
 const z=M.dot(q,b.forward),zoom=r.height/(camera.distance+z*0.22);
 const x=r.width/2+M.dot(q,b.right)*zoom;
 const y=r.height/2-M.dot(q,b.up)*zoom;
 return {x,y,z,zoom};
}
function unprojectScreen(dx,dy){
 const r=canvas.getBoundingClientRect(),b=basis(),zoom=r.height/(camera.distance*1.06);
 return M.add(M.scaleV(b.right,dx/zoom),M.scaleV(b.up,-dy/zoom));
}

function draw(){
 const r=canvas.getBoundingClientRect();
 ctx.clearRect(0,0,r.width,r.height);
 const bg=ctx.createRadialGradient(r.width*.5,r.height*.35,20,r.width*.5,r.height*.5,r.width);
 bg.addColorStop(0,"#12202c");bg.addColorStop(1,"#090d13");ctx.fillStyle=bg;ctx.fillRect(0,0,r.width,r.height);
 drawGrid();
 if($("#showLinks").checked)drawLinks();
 const items=[];
 for(const n of engine.nodes.values()){
  const s=state(n.id);if(!s.world)continue;
 const p=project(s.position);if(p.z>camera.distance+8)continue;
  items.push({id:n.id,depth:p.z,p});
 }
 items.sort((a,b)=>b.depth-a.depth).forEach(i=>drawObject(i.id));
 if(selectedId&&state(selectedId)?.world)drawGizmo(selectedId);
}
function drawGrid(){
 if(!$("#showGrid").checked)return;
 ctx.strokeStyle="rgba(120,150,180,.15)";ctx.lineWidth=1;ctx.beginPath();
 for(let i=-10;i<=10;i++){
  for(const axis of [[[i,-1.4,-10],[i,-1.4,10]],[[-10,-1.4,i],[10,-1.4,i]]]){
   const a=project(axis[0]),b=project(axis[1]);ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
  }
 }
 ctx.stroke();
}
function drawLinks(){
 ctx.lineWidth=1.2;
 for(const n of engine.nodes.values()){
  if(n.parent==null)continue;
  const a=state(n.id),p=state(n.parent);
  if(!a.world||!p.world)continue;
  const pa=project(a.position),pb=project(p.position);
 ctx.strokeStyle=a.issues.some(x=>x.severity==="error")?"rgba(255,122,122,.55)":"rgba(140,180,220,.35)";
 ctx.beginPath();ctx.moveTo(pa.x,pa.y);ctx.lineTo(pb.x,pb.y);ctx.stroke();
}
}

function localPoint(s,lp){return M.transformPoint(s.world.linear,lp,s.world.translation);}
function drawObject(id){
 const n=node(id),s=state(id),r=canvas.getBoundingClientRect(),center=project(s.position);
 const size=Math.max(5,34*center.zoom/Math.max(1,r.height/8));
 const unit=n.shape==="sphere"?SPHERE:BOX_VERTS;
 const pts=unit.map(p=>project(localPoint(s,M.scaleV(p,.34))));
 const bad=s.issues.some(i=>i.severity==="error"),warn=s.issues.some(i=>i.severity==="warning");
 ctx.save();
 if(bad){ctx.shadowColor="#ff7a7a";ctx.shadowBlur=12;}
 ctx.strokeStyle=bad?"#ff7a7a":warn?"#f2d06b":n.color;
 ctx.fillStyle=bad?"rgba(255,122,122,.08)":"rgba(103,183,220,.06)";
 ctx.lineWidth=selectedId===id?2.2:1.2;
 ctx.beginPath();
 if(n.shape==="sphere"){
  for(let i=0;i<pts.length;i++){const p=pts[i],lat=Math.floor(i/15);if(lat%2===0||i%15===0){if(i%15===0)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);}}
 }else{
  for(const [a,b] of BOX_EDGES){ctx.moveTo(pts[a].x,pts[a].y);ctx.lineTo(pts[b].x,pts[b].y);}
 }
 ctx.stroke();ctx.restore();
 const label=`${n.name}${n.locked?" 🔒":""}${bad?" !":warn?" ⚠":""}`;
 ctx.font="12px Segoe UI";ctx.fillStyle=bad?"#ffb7b7":warn?"#ffe39c":"#dcecff";
 ctx.fillText(label,center.x+8,center.y-size-5);
 if(n.locked){ctx.fillStyle="#d8b4fe";ctx.fillText("◆",center.x-5,center.y+4);}
}

function drawGizmo(id){
 const s=state(id),origin=project(s.position);
 const colors=["#ff6b6b","#7bdcb5","#5b8def"],names=["X","Y","Z"];
 [[1,0,0],[0,1,0],[0,0,1]].forEach((axis,i)=>{
  const end=project(M.transformPoint(s.world.linear,M.scaleV(axis,.65),s.position));
  ctx.strokeStyle=colors[i];ctx.lineWidth=drag.axis===i?4:2;
  ctx.beginPath();ctx.moveTo(origin.x,origin.y);ctx.lineTo(end.x,end.y);ctx.stroke();
  ctx.fillStyle=colors[i];ctx.font="bold 12px Segoe UI";ctx.fillText(names[i],end.x+4,end.y+4);
 });
}

function pickObject(x,y){
 let best=null,bestD=18;
 for(const n of engine.nodes.values()){
  const s=state(n.id);if(!s.world)continue;
  const p=project(s.position),d=Math.hypot(p.x-x,p.y-y);
  if(d<bestD){bestD=d;best=n.id;}
 }
 return best;
}
function pickAxis(x,y){
 if(!selectedId)return -1;
 const s=state(selectedId);if(!s.world)return -1;
 const o=project(s.position);
 return [[1,0,0],[0,1,0],[0,0,1]].findIndex((axis)=>{
  const e=project(M.transformPoint(s.world.linear,M.scaleV(axis,.65),s.position));
  const l2=(e.x-o.x)**2+(e.y-o.y)**2,t=Math.max(0,Math.min(1,((x-o.x)*(e.x-o.x)+(y-o.y)*(e.y-o.y))/l2));
  return Math.hypot(o.x+t*(e.x-o.x)-x,o.y+t*(e.y-o.y)-y)<8;
 });
}

canvas.addEventListener("mousedown",e=>{
 const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
 const axis=pickAxis(x,y),hit=pickObject(x,y);
 if(axis>=0&&node(selectedId)&&!node(selectedId).locked){
  drag.active=true;drag.mode="axis";drag.axis=axis;drag.start={x,y};drag.startWorld=state(selectedId).position.slice();drag.session=engine.beginInteraction("拖拽位移");
  canvas.setPointerCapture(e.pointerId);return;
 }
 if(hit){
  selectedId=hit;renderAll();
  if(!node(hit).locked){drag.active=true;drag.mode="body";drag.start={x,y};drag.startWorld=state(hit).position.slice();drag.session=engine.beginInteraction("拖拽位移");canvas.setPointerCapture(e.pointerId);return;}
 }
 orbit.active=true;orbit.x=e.clientX;orbit.y=e.clientY;
});

canvas.addEventListener("mousemove",e=>{
 const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
 if(orbit.active){
  camera.yaw-=(e.clientX-orbit.x)*0.008;
  camera.pitch=Math.max(-1.35,Math.min(1.35,camera.pitch+(e.clientY-orbit.y)*0.008));
  orbit.x=e.clientX;orbit.y=e.clientY;draw();return;
 }
 if(!drag.active)return;
 const delta=unprojectScreen(x-drag.start.x,y-drag.start.y);
 let translation;
 const n0=node(selectedId);
 if(drag.mode==="axis"){
  const s=state(selectedId),axisWorld=M.normalize(M.mulVec(s.world.linear,[drag.axis===0?1:0,drag.axis===1?1:0,drag.axis===2?1:0]));
  const dist=M.dot(delta,axisWorld);
  const ps=n0.parent==null?{linear:M.identity(),translation:[0,0,0]}:state(n0.parent).world;
  translation=M.add(drag.startWorld,M.scaleV(axisWorld,dist));
  translation=M.add(M.mulVec(M.inverse(ps.linear),M.sub(translation,ps.translation)),[0,0,0]);
 }else{
  const s=state(selectedId),ps=n0.parent==null?{linear:M.identity(),translation:[0,0,0]}:state(n0.parent).world;
  translation=M.mulVec(M.inverse(ps.linear),M.sub(M.add(drag.startWorld,delta),ps.translation));
 }
 const live=engine.updateNode(selectedId,{translation},{label:"拖拽位移",history:false});
 if(live.ok){
  renderAll();
 }else{
  engine.cancelInteraction(drag.session);drag.session=null;drag.active=false;
  alert(live.errors);renderAll();
 }
});

window.addEventListener("mouseup",()=>{
 if(drag.active){
  const r=engine.lastResult;
  if(r.ok&&r.changedWorldIds.length)engine.commitInteraction(drag.session,[selectedId]);
  else if(drag.session)engine.cancelInteraction(drag.session);
  drag.active=false;drag.mode=null;drag.axis=null;drag.session=null;renderAll();
 }
 orbit.active=false;
});

canvas.addEventListener("wheel",e=>{
 e.preventDefault();
 camera.distance=Math.max(2.2,Math.min(18,camera.distance*(1+e.deltaY*0.001)));
 draw();
},{passive:false});

function renderStatus(){
 const r=engine.lastResult,box=$("#solverStatus");
 const bad=[...engine.nodes.keys()].filter(id=>state(id).issues.some(i=>i.severity==="error"));
 const warns=[...engine.nodes.keys()].filter(id=>state(id).issues.some(i=>i.severity==="warning"));
 const lines=[];
  if(r.label)lines.push(`<div class="okline">${escapeHtml(r.label)} · 版本 ${engine.version}</div>`);
  if(r.recalculatedIds?.length)lines.push(`<div>只重算 ${r.recalculatedIds.length} 个对象：${r.recalculatedIds.map(escapeHtml).join(", ")}；世界矩阵实际变化 ${r.changedWorldIds.length} 个。</div>`);
  if(r.compensatorIds?.length)lines.push(`<div class="okline">锁定补偿节点：${r.compensatorIds.map(escapeHtml).join(", ")}；被保护锁定：${r.compensatedLockIds.map(escapeHtml).join(", ")}</div>`);
  if(bad.length)lines.push(`<div class="errline">不可信对象：${bad.map(id=>`${id}（${state(id).issues.filter(i=>i.severity==="error").map(i=>i.message).join("；")}）`).map(escapeHtml).join(" ｜ ")}</div>`);
  if(warns.length)lines.push(`<div class="warnline">提示对象：${warns.join(", ")}</div>`);
 box.innerHTML=lines.join("");
 $("#btnUndo").disabled=!engine.canUndo();$("#btnRedo").disabled=!engine.canRedo();
}

function renderAll(){renderTree();renderInspector();draw();renderStatus();}

$("#btnUndo").onclick=()=>{engine.undo();selectedId=node(selectedId)?selectedId:[...engine.nodes.keys()][0];renderAll();};
$("#btnRedo").onclick=()=>{engine.redo();selectedId=node(selectedId)?selectedId:[...engine.nodes.keys()][0];renderAll();};
$("#btnAdd").onclick=()=>{
 const id=`obj_${Date.now().toString(36)}`;
 const parent=selectedId&&node(selectedId)?selectedId:null;
 const r=engine.addNode({id,name:"新对象",parent,translation:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},parent);
 if(r.ok){selectedId=id;renderAll();}
};
$("#btnDelete").onclick=()=>{
 if(!selectedId)return;
 if(confirm(`删除 ${node(selectedId).name} 及其整棵子树？`))apply(()=>engine.deleteNode(selectedId),"删除对象");
};
$("#btnExport").onclick=()=>{
 const blob=new Blob([JSON.stringify(engine.serialize(),null,2)],{type:"application/json"});
 const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="transform-scene.json";a.click();URL.revokeObjectURL(a.href);
};
$("#btnImport").onclick=()=>$("#fileImport").click();
$("#fileImport").onchange=async e=>{
 const file=e.target.files[0];if(!file)return;
 try{
  const data=JSON.parse(await file.text());
  const old=engine.serialize();
  if(engine.loadScene(data)){
   selectedId=data.nodes[0]?.id||null;
   renderAll();
  }else{
   engine.loadScene(old,{snapshot:false});
   alert("导入失败：\n"+engine.lastResult.errors.join("\n"));
  }
 }catch(err){alert("JSON 解析失败："+err.message);}
 e.target.value="";
};
$("#showLinks").onchange=draw;$("#showGrid").onchange=draw;
window.addEventListener("keydown",e=>{
 if(e.target.matches("input,select,textarea"))return;
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();$("#btnUndo").click();}
 if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();$("#btnRedo").click();}
});

resize();
renderAll();
