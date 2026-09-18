(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const wb = new DemoCore.Workbench();
  let selectedId = null;
  let camera = { yaw: -0.78, pitch: 0.52, zoom: 34, panX: 0, panY: 0 };
  let drag = null;
  const canvas = $('view'), ctx = canvas.getContext('2d');

  function toast(msg, type='ok', ms=3800) {
    const t=$('toast'); t.textContent=msg; t.className='toast '+type; t.hidden=false;
    clearTimeout(toast._timer); toast._timer=setTimeout(()=>t.hidden=true,ms);
  }
  function fmt(v,n=3){ return Number(v).toFixed(n).replace(/\.?0+$/,''); }
  function v3(v){ return `[${v.map(x=>fmt(x,2)).join(', ')}]`; }
  function esc(s){ return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function optionList(sel){ return Array.from(wb.records.keys()).sort().map(id=>`<option value="${esc(id)}">${esc(id)}</option>`).join(''); }
  function showResult(r, okText='已应用') { if(r.ok){toast(okText);renderAll();return true;} toast(r.errors.map(e=>e.message).join('\n'),'bad',7000);renderAll();return false;}

  function init() {
    const r=wb.loadGroups(window.DEMO_DATA,{replace:true});
    wb.setPlane({normal:[1,0,0],offset:2});
    wb.addMeasurement({id:'M1',type:'point-point',pointA:[-6.6,-2.5,0.35],pointB:[6.6,-2.5,0.35],label:'西墙至东墙'});
    wb.addMeasurement({id:'M2',type:'object-object',objectA:'PUMP-01',objectB:'WALL-E',label:'泵到东墙'});
    wb.addMeasurement({id:'M3',type:'point-point',pointA:[-3,3.1,2.8],pointB:[4,-2.1,1.0],label:'跨截面复核线'});
    wb.recomputeAll(true);
    if(!r.ok)toast(r.errors.map(e=>e.message).join('\n'),'bad',6000);
    syncPlaneInputs(); bindEvents(); setMeasureMode(); fitCamera(); renderAll();
  }

  function bindEvents() {
    $('btnReset').onclick=()=>init();
    $('btnBad').onclick=()=>{ const r=wb.loadGroups(window.DEMO_BAD,{replace:false}); showResult(r,'已追加'); };
    $('btnExport').onclick=()=>{ const blob=new Blob([wb.exportProject()],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='autodemo-project.json'; a.click(); URL.revokeObjectURL(a.href); };
    $('btnImport').onclick=()=>$('fileImport').click();
    $('fileImport').onchange=async e=>{ const f=e.target.files[0]; if(!f)return; try{showResult(wb.importProject(await f.text(),true),'项目已导入');}catch(err){toast('JSON 无法解析：'+err.message,'bad');} e.target.value=''; };
    $('applyPlane').onclick=()=>showResult(wb.setPlane({normal:[+$('nx').value,+$('ny').value,+$('nz').value],offset:+$('off').value}),'剖切面已移动，截面与相关测量已增量重算');
    for(const id of ['nx','ny','nz','off']) $(id).addEventListener('change',()=>$('applyPlane').click());
    $('measureType').onchange=setMeasureMode;
    $('addMeasure').onclick=addMeasurement;
    $('bulkAdd').onclick=bulkAdd;
    canvas.addEventListener('mousedown',e=>{drag={x:e.clientX,y:e.clientY,button:e.button,moved:false};});
    window.addEventListener('mousemove',e=>{ if(!drag)return; const dx=e.clientX-drag.x,dy=e.clientY-drag.y; if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true; if(drag.button===2){camera.panX+=dx;camera.panY+=dy;}else{camera.yaw+=dx*.008;camera.pitch=Math.max(-1.45,Math.min(1.45,camera.pitch+dy*.008));} drag.x=e.clientX;drag.y=e.clientY;drawScene(); });
    window.addEventListener('mouseup',e=>{ if(drag&&!drag.moved)pick(e); drag=null; });
    canvas.addEventListener('contextmenu',e=>e.preventDefault());
    canvas.addEventListener('wheel',e=>{e.preventDefault();camera.zoom*=Math.exp(-e.deltaY*.001);drawScene();},{passive:false});
    window.addEventListener('resize',drawScene);
  }
  function syncPlaneInputs(){ $('nx').value=fmt(wb.plane.normal[0],3); $('ny').value=fmt(wb.plane.normal[1],3); $('nz').value=fmt(wb.plane.normal[2],3); $('off').value=fmt(wb.plane.offset,3); }
  function setMeasureMode(){ const t=$('measureType').value; const objs=optionList(''); $('objA').innerHTML=objs; $('objB').innerHTML=objs; $('pointA').classList.toggle('hidden-control',t==='object-object'); $('objA').classList.toggle('hidden-control',t!=='object-object'); $('pointB').classList.toggle('hidden-control',t==='object-object'); $('objB').classList.toggle('hidden-control',t==='point-point'); $('pointA').placeholder=t==='point-object'?'点A x,y,z':'点A x,y,z'; }
  function parsePoint(s){ const parts=s.split(',').map(Number); if(parts.length!==3||parts.some(x=>!Number.isFinite(x)))throw new Error('点必须写成 x,y,z 三个数字'); return parts; }
  function addMeasurement() {
    const type=$('measureType').value, id='M'+Date.now().toString(36).toUpperCase();
    try {
      const def={id,type,label:id};
      if(type==='point-point'){def.pointA=parsePoint($('pointA').value);def.pointB=parsePoint($('pointB').value);}
      if(type==='point-object'){def.pointA=parsePoint($('pointA').value);def.objectB=$('objB').value;}
      if(type==='object-object'){def.objectA=$('objA').value;def.objectB=$('objB').value;}
      showResult(wb.addMeasurement(def),'测量已创建；遮挡和跨截面状态已标记');
    } catch(e){toast(e.message,'bad');}
  }
  function bulkAdd(){ try{const raw=JSON.parse($('bulkInput').value); const groups=Array.isArray(raw)?{name:'批量来源',objects:raw}:(raw.objects?raw:{name:raw.name||'批量来源',objects:raw}); showResult(wb.loadGroups(groups,{replace:false}),'来源已追加并完成冲突比对');}catch(e){toast('JSON 无法解析：'+e.message,'bad',7000);} }  function renderTree() {
    const h=wb.hierarchy();
    function node(id,depth){
      const r=wb.activeRecord(id), bad=wb.conflicts.has(id);
      return `<div class="node ${selectedId===id?'active':''}" data-id="${esc(id)}"><span class="conflict-dot ${bad?'bad':''}"></span><span class="id">${esc(id)}</span><span class="meta">${r&&r.parentId?esc(r.parentId):'根'}</span></div><ul>${h.children.get(id).map(c=>node(c,depth+1)).join('')}</ul>`;
    }
    $('tree').innerHTML='<ul>'+h.roots.map(id=>node(id,0)).join('')+'</ul>';
    $('tree').querySelectorAll('.node').forEach(el=>el.onclick=()=>{selectedId=el.dataset.id;renderTree();renderEditor();});
  }
  function renderEditor() {
    if(!selectedId||!wb.activeRecord(selectedId)){$('editor').innerHTML='<p class="kv">选择左侧对象以调整局部变换或尺寸。</p>';return;}
    const r=wb.activeRecord(selectedId);
    $('editor').innerHTML = `
      <div class="kv">对象 <b>${esc(r.id)}</b> / 父对象 <b>${esc(r.parentId||'无')}</b></div>
      <label>父对象 ID<input id="edParent" value="${esc(r.parentId||'')}" placeholder="留空为根对象"/></label>
      <div class="grid3"><label>X<input id="px" value="${r.position[0]}"/></label><label>Y<input id="py" value="${r.position[1]}"/></label><label>Z<input id="pz" value="${r.position[2]}"/></label></div>
      <div class="grid3"><label>RX°<input id="rx" value="${r.rotationEuler[0]}"/></label><label>RY°<input id="ry" value="${r.rotationEuler[1]}"/></label><label>RZ°<input id="rz" value="${r.rotationEuler[2]}"/></label></div>
      <div class="grid3"><label>长<input id="sx" value="${r.size[0]}"/></label><label>宽<input id="sy" value="${r.size[1]}"/></label><label>高<input id="sz" value="${r.size[2]}"/></label></div>
      <div class="row-actions"><button id="saveObject">应用修改</button><button class="danger" id="clearSelect">取消选择</button></div>`;
    $('saveObject').onclick=()=>{
      const nums=ids=>ids.map(id=>Number($(id).value));
      const patch={parentId:$('edParent').value.trim()||null,position:nums(['px','py','pz']),rotationEuler:nums(['rx','ry','rz']),size:nums(['sx','sy','sz'])};
      showResult(wb.updateObject(selectedId,patch),'对象已修改；父子闭包、截面与测量已增量重算');
    };
    $('clearSelect').onclick=()=>{selectedId=null;renderTree();renderEditor();};
  }
  function renderConflicts() {
    const cids=Array.from(wb.conflicts.keys()).sort();
    $('badgeState').className='badge '+(wb.rejections.length?'bad':cids.length?'warn':'ok');
    $('badgeState').textContent=wb.rejections.length?`${wb.rejections.length} 条拒绝`:cids.length?`${cids.length} 个冲突`:'已校验';
    $('conflicts').innerHTML=cids.length?cids.map(id=>{
      const c=wb.conflicts.get(id);
      return `<div class="card"><h3>${esc(id)}<span class="badge warn">冲突保留</span></h3><p class="kv">${esc(c.message)}</p>${c.pairs.map(p=>`<div class="card"><div class="source">${esc(p.a.label)} / ${esc(p.b.label)}</div><div class="kv">A：${esc(describe(p.a))}</div><div class="kv">B：${esc(describe(p.b))}</div></div>`).join('')}<div>${wb.conflictAlternatives(id).map(a=>`<button class="small" data-accept="${esc(id)}|${esc(a.source)}|${a.index}">采用 ${esc(a.label)}</button>`).join(' ')}</div></div>`;
    }).join(''):'<p class="kv">没有未解决的来源冲突。</p>';
    $('conflicts').querySelectorAll('[data-accept]').forEach(b=>b.onclick=()=>{const [id,source,index]=b.dataset.accept.split('|');showResult(wb.setAccepted(id,source,Number(index)),'已切换采用值；另一方来源仍保留');});
    $('rejections').innerHTML=wb.rejections.length?`<h2 class="badge bad" style="display:inline-block">最近一批被拒绝</h2>`+wb.rejections.map(e=>`<div class="card"><h3>${esc(e.code)}${e.objectId?` · ${esc(e.objectId)}`:''}</h3><div class="reason">${esc(e.message)}</div>${e.source?`<div class="kv">位置：来源 ${esc(e.source)}，第 ${e.index+1} 条</div>`:''}${e.chain?`<div class="chain">链条：${e.chain.map(esc).join(' → ')}</div>`:''}</div>`).join(''):'';
  }
  function describe(r){return `位置 ${v3(r.position)}，朝向 ${v3(r.rotationEuler)}°，尺寸 ${v3(r.size)}${r.parentId?`，父对象 ${r.parentId}`:''}`;}
  function renderSections() {
    const ids=Array.from(wb.sections.keys()).sort();
    $('sections').innerHTML=ids.length?ids.map(id=>{const s=wb.sections.get(id);const conflictBadge=s.conflicting?'<span class="badge warn">来源冲突</span> ':'';return `<div class="card" data-section="${esc(id)}"><h3>${esc(id)}<span>${conflictBadge}<span class="badge info">${s.polygon.length} 边形</span></span></h3><div class="kv">面积：<b>${fmt(s.area,4)}</b> m²</div><div class="kv">中心：<span class="mono">${v3(s.center)}</span></div><div class="kv">法向：<span class="mono">${v3(s.normal)}</span></div><details><summary>轮廓点</summary><div class="chain">${s.polygon.map(v3).join('<br>')}</div></details></div>`;}).join(''):'<p class="kv">当前剖切面没有严格切开对象；相切接触不会生成截面。</p>';
  }
  function statusBadge(m){ if(m.status==='blocked')return '<span class="badge bad">被遮挡</span>'; if(m.status==='intersecting')return '<span class="badge warn">对象相交</span>'; if(m.crossesPlane)return '<span class="badge warn">跨剖切面</span>'; return '<span class="badge ok">无遮挡</span>'; }
  function renderMeasurements() {
    $('objA').innerHTML=optionList(); $('objB').innerHTML=optionList();
    const ids=Array.from(wb.measurements.keys()).sort();
    $('measurements').innerHTML=ids.map(id=>{const m=wb.measurements.get(id);return `<div class="card ${m.blocked?'blocked':'visible'} ${m.crossesPlane?'crossing':''}"><h3>${esc(m.label||id)} ${statusBadge(m)}</h3><div class="kv">几何距离：<b>${m.distance==null?'—':fmt(m.distance,4)} m</b></div><div class="kv">起点后首段可见距离：<b>${fmt(m.visibleDistance,4)} m</b></div>${m.blocked?`<div class="reason">遮挡物：${m.blockers.slice(0,3).map(b=>esc(b.objectId)+' @'+fmt(b.enter,3)).join('；')}</div>`:'<div class="kv">路径未穿过其他对象实体。</div>'}${m.crossesPlane?'<div class="reason">该测量跨越剖切面：数值保留，但必须结合截面复核。</div>':''}<div class="kv mono">${v3(m.endpointA||[0,0,0])} → ${v3(m.endpointB||[0,0,0])}</div><button class="small danger" data-del="${esc(id)}">删除</button></div>`;}).join('');
    $('measurements').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>{wb.removeMeasurement(b.dataset.del);renderAll();});
  }
  function renderStats() { const s=wb.stats; $('incrementInfo').textContent=`增量：截面 ${s.sectionsRecomputed}，测量 ${s.measurementsRecomputed} / ${wb.measurements.size}`; }
  function renderAll(){ syncPlaneInputs(); renderTree(); renderEditor(); renderConflicts(); renderSections(); renderMeasurements(); renderStats(); drawScene(); }  function resizeCanvas(){ const r=canvas.getBoundingClientRect(); const dpr=window.devicePixelRatio||1; canvas.width=Math.max(300,Math.floor(r.width*dpr)); canvas.height=Math.max(300,Math.floor(r.height*dpr)); canvas._dpr=dpr; }
  function cameraAxes(){
    const cp=Math.cos(camera.pitch),sp=Math.sin(camera.pitch),cy=Math.cos(camera.yaw),sy=Math.sin(camera.yaw);
    const forward=[cp*cy,cp*sy,sp];
    let right=[-sy,cy,0]; if(DemoCore?false:false){}
    const m=(a,b)=>Math.hypot(...a)<1?a:a; right=m(right,right);
    const up=cameraUp(forward,right);
    return {forward,right,up};
  }
  function cameraUp(f,r){ const up=[f[2]*r[1]-f[1]*r[2],f[0]*r[2]-f[2]*r[0],f[1]*r[0]-f[0]*r[1]]; const l=Math.hypot(...up)||1; return up.map(x=>x/l); }
  function project(p){
    const dpr=canvas._dpr||1; const {right,up,forward}=cameraAxes();
    const x=dot3(p,right), y=dot3(p,up), depth=dot3(p,forward);
    return {x:canvas.width/2+x*camera.zoom+camera.panX*dpr,y:canvas.height/2-y*camera.zoom+camera.panY*dpr,depth};
  }
  function dot3(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
  function line3(a,b,color,width=1,dash=[]) { const A=project(a),B=project(b); ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.lineCap='round';ctx.stroke();ctx.setLineDash([]); return (A.depth+B.depth)/2; }
  function boxVertices(box){ const v=[]; for(const z of [-1,1])for(const y of [-1,1])for(const x of [-1,1])v.push([0,1,2].map(k=>box.center[k]+box.axes[0][k]*x*box.half[0]+box.axes[1][k]*y*box.half[1]+box.axes[2][k]*z*box.half[2])); return v; }
  const BOX_EDGES=[[0,1],[1,3],[3,2],[2,0],[4,5],[5,7],[7,6],[6,4],[0,4],[1,5],[2,6],[3,7]];
  function drawBox(box,color='#78c8ff',fillAlpha=.045) {
    const vs=boxVertices(box), ps=vs.map(project);
    const faces=[[0,1,3,2],[4,6,7,5],[0,2,6,4],[1,3,7,5],[0,4,6,2],[1,5,7,3]];
    ctx.save(); faces.forEach((f)=>{ ctx.beginPath(); f.forEach((vi,i)=>i?ctx.lineTo(ps[vi].x,ps[vi].y):ctx.moveTo(ps[vi].x,ps[vi].y)); ctx.closePath(); ctx.fillStyle='rgba(120,200,255,'+fillAlpha+')'; ctx.fill(); }); ctx.restore();
    BOX_EDGES.forEach(e=>line3(vs[e[0]],vs[e[1]],color,1.2));
  }
  function drawPoly(poly,color,fill='rgba(255,80,100,.22)',width=2.4) { const ps=poly.map(project); ctx.save();ctx.beginPath();ps.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle=fill;ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();ctx.restore(); }
  function drawPlane() {
    const n=wb.plane.normal,off=wb.plane.offset; const ref=Math.abs(n[2])<.9?[0,0,1]:[1,0,0]; let u=sub3(ref,mul3(n,dot3(ref,n))); u=mul3(normalize3(u),9); const v=mul3(normalize3(cross3(n,u)),7); const c=mul3(n,off);
    const corners=[add3(add3(c,mul3(u,-1)),mul3(v,-1)),add3(add3(c,u),mul3(v,-1)),add3(add3(c,u),v),add3(add3(c,mul3(u,-1)),v)];
    ctx.save(); ctx.beginPath(); corners.map(project).forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); ctx.closePath(); ctx.fillStyle='rgba(185,140,255,.075)'; ctx.fill(); ctx.strokeStyle='rgba(185,140,255,.7)'; ctx.setLineDash([7,5]); ctx.lineWidth=1.2; ctx.stroke(); ctx.restore();
  }
  const sub3=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], add3=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]], mul3=(a,s)=>a.map(x=>x*s);
  function cross3(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];} function normalize3(a){const l=Math.hypot(...a)||1;return a.map(x=>x/l);}
  function drawMeasurements(){
    for(const m of wb.measurements.values()){ if(!m.endpointA)continue; const color=m.blocked?'#ffb84d':m.crossesPlane?'#ff8bd2':'#4fd08b';
      line3(m.endpointA,m.endpointB,color,m.blocked?2.4:2,m.blocked?[8,4]:[]);
      if(m.blocked&&m.blockers[0]){line3(m.endpointA,m.blockers[0].enterPoint,'#4fd08b',3); [m.endpointA,m.endpointB,m.blockers[0].enterPoint].forEach(drawPoint);}
      else [m.endpointA,m.endpointB].forEach(drawPoint);
      const p=project(m.endpointB); ctx.save();ctx.fillStyle=color;ctx.font='12px Consolas';ctx.fillText((m.label||m.id)+' '+fmt(m.distance,2)+'m',p.x+7,p.y-7);ctx.restore();
    }
  }
  function drawPoint(p,color='#e8eef7'){const q=project(p);ctx.save();ctx.fillStyle=color;ctx.strokeStyle='#0b1018';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(q.x,q.y,4,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore();}
  function drawGrid(){ ctx.save(); ctx.strokeStyle='rgba(120,160,200,.12)'; ctx.lineWidth=1; for(let x=-7;x<=7;x++)line3([x,-4.5,0],[x,4.5,0],'rgba(120,160,200,.12)',1); for(let y=-4;y<=4;y++)line3([-7,y,0],[7,y,0],'rgba(120,160,200,.12)',1); ctx.restore(); }
  function drawLabels(){ ctx.save();ctx.font='11px Segoe UI'; for(const [id,box] of wb.obbs){ const p=project(add3(box.center,[0,0,box.half[2]+.22])); ctx.fillStyle=id===selectedId?'#fff':'rgba(232,238,247,.72)'; ctx.fillText(id,p.x+5,p.y-5); } ctx.restore(); }
  function drawScene(){ requestAnimationFrame(()=>{ resizeCanvas(); ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height); drawGrid(); drawPlane(); const sorted=Array.from(wb.obbs.entries()).sort((a,b)=>project(b[1].center).depth-project(a[1].center).depth); for(const [id,box] of sorted){ drawBox(box,id===selectedId?'#53c4ff':'rgba(120,200,255,1)',id===selectedId?.12:.045); } for(const s of wb.sections.values())drawPoly(s.polygon,'#ff6677'); drawMeasurements(); drawLabels(); }); }
  function fitCamera(){ camera.zoom=34;camera.panX=0;camera.panY=0; }
  function screenRay(mx,my){ const dpr=canvas._dpr||1; const x=(mx-canvas.width/2-camera.panX*dpr)/(camera.zoom*dpr), y=-(my-canvas.height/2-camera.panY*dpr)/(camera.zoom*dpr); const {right,up,forward}=cameraAxes(); return {origin:add3(add3(mul3(right,x),mul3(up,y)),mul3(forward,-100)), dir:forward}; }
  function rayBox(ray,box){ const d=ray.dir,o=sub3(ray.origin,box.center), ad=[dot3(d,box.axes[0]),dot3(d,box.axes[1]),dot3(d,box.axes[2])], oc=[dot3(o,box.axes[0]),dot3(o,box.axes[1]),dot3(o,box.axes[2])]; let t0=-Infinity,t1=Infinity; for(let i=0;i<3;i++){if(Math.abs(ad[i])<1e-9){if(Math.abs(oc[i])>box.half[i])return null;}else{let ta=(-box.half[i]-oc[i])/ad[i],tb=(box.half[i]-oc[i])/ad[i];if(ta>tb)[ta,tb]=[tb,ta];t0=Math.max(t0,ta);t1=Math.min(t1,tb);}} return t1>=t0?t0:null; }
  function pick(e){ const rect=canvas.getBoundingClientRect(); const dpr=canvas._dpr||1; const ray=screenRay((e.clientX-rect.left)*dpr,(e.clientY-rect.top)*dpr); let best=null,bd=Infinity; for(const [id,box] of wb.obbs){const t=rayBox(ray,box); if(t!==null&&t>=0&&t<bd){bd=t;best=id;}} if(best){selectedId=best;renderTree();renderEditor();drawScene();} }
  init();
})();
