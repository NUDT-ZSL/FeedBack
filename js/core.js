(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DemoCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-9;
  const ANG_EPS = 1e-8;
  const DIST_EPS = 1e-7;

  function add(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
  function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
  function mul(a,s){return [a[0]*s,a[1]*s,a[2]*s];}
  function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
  function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
  function length(a){return Math.hypot(a[0],a[1],a[2]);}
  function norm(a){const l=length(a)||1;return [a[0]/l,a[1]/l,a[2]/l];}
  function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
  function round(x, n=12){const f=Math.pow(10,n);return Math.abs(x)<Math.pow(10,-n)/2?0:Math.round(x*f)/f;}
  function vecRound(v,n=12){return v.map(x=>round(x,n));}
  function cloneDeep(v){return v===undefined?v:JSON.parse(JSON.stringify(v));}
  function eulerToQuat(e) {
    const d=e||[], x=((Number(d[0])||0)*Math.PI)/180, y=((Number(d[1])||0)*Math.PI)/180, z=((Number(d[2])||0)*Math.PI)/180;
    const cx=Math.cos(x/2),sx=Math.sin(x/2),cy=Math.cos(y/2),sy=Math.sin(y/2),cz=Math.cos(z/2),sz=Math.sin(z/2);
    return [cx*cy*cz+sx*sy*sz, sx*cy*cz-cx*sy*sz, cx*sy*cz+sx*cy*sz, cx*cy*sz-sx*sy*cz];
  }
  function qNormalize(q){const l=Math.hypot(q[0],q[1],q[2],q[3])||1;return [q[0]/l,q[1]/l,q[2]/l,q[3]/l];}
  function qRotate(q,v){
    const x=v[0],y=v[1],z=v[2], qw=q[0],qx=q[1],qy=q[2],qz=q[3];
    const ix=qw*x+qy*z-qz*y, iy=qw*y+qz*x-qx*z, iz=qw*z+qx*y-qy*x, iw=-qx*x-qy*y-qz*z;
    return [ix*qw+iw*-qx+iy*-qz-iz*-qy, iy*qw+iw*-qy+iz*-qx-ix*-qz, iz*qw+iw*-qz+ix*-qy-iy*-qx];
  }
  function localMatrix(rec) {
    const t=rec.position||[0,0,0], q=qNormalize(eulerToQuat(rec.rotationEuler||[0,0,0]));
    return {t:[Number(t[0])||0,Number(t[1])||0,Number(t[2])||0], q};
  }
  function qMul(a,b){return [a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3], a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2], a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1], a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]];}
  function composeWorld(records, id, worldCache, guard=new Set()) {
    if (worldCache.has(id)) return worldCache.get(id);
    const rec=records.get(id);
    let t=[0,0,0], q=[1,0,0,0];
    if (rec && rec.parentId && records.has(rec.parentId) && !guard.has(rec.parentId)) {
      guard.add(rec.parentId);
      const p=composeWorld(records, rec.parentId, worldCache, guard);
      t=p.t.slice(); q=p.q.slice();
    }
    if (rec) { const m=localMatrix(rec); t=add(t,qRotate(q,m.t)); q=qMul(q,m.q); }
    const out={t,q}; worldCache.set(id,out); return out;
  }
  function makeObbs(records, worldCache) {
    const out=new Map();
    for (const [id,r] of records) {
      const w=composeWorld(records,id,worldCache), s=r.size;
      out.set(id,{id, center:w.t, axes:[qRotate(w.q,[1,0,0]),qRotate(w.q,[0,1,0]),qRotate(w.q,[0,0,1])], half:[s[0]/2,s[1]/2,s[2]/2], size:s.slice()});
    }
    return out;
  }
  function worldSig(rec,w){return {id:rec.id, parentId:rec.parentId||null, position:(rec.position||[]).map(Number), rotationEuler:(rec.rotationEuler||[0,0,0]).map(Number), size:rec.size.slice(), worldT:vecRound(w.t), worldQ:vecRound(w.q,14)};}
  function sameValue(a,b,tol=DIST_EPS){return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tol;}
  function sameVec(a,b,tol=DIST_EPS,ang=false){return a.length===b.length&&a.every((x,i)=>sameValue(Number(x),Number(b[i]),ang?ANG_EPS:tol));}

  function validateSource(group, allRecords, seenGlobal) {
    const errors=[], g=group||{};
    const sourceName=g.name||g.id||'(未命名来源)';
    const records=Array.isArray(g.objects)?g.objects:[];
    const local=new Map();
    function locate(i){return {source:String(sourceName), index:i+1, objectId: records[i]&&records[i].id ? String(records[i].id) : null};}
    if (!Array.isArray(g.objects)) errors.push({code:'INVALID_SOURCE', source:sourceName, message:`来源“${sourceName}”缺少 objects 数组。`, chain:[sourceName]});
    records.forEach((r0,i)=>{
      const r=r0||{}, id=String(r.id==null?'':r.id);
      if (!id) errors.push(Object.assign({code:'MISSING_ID', message:`${sourceName} 第 ${i+1} 条记录缺少唯一标识。`},locate(i)));
      else {
        if (local.has(id)) errors.push(Object.assign({code:'DUPLICATE_ID', objectId:id, message:`对象标识“${id}”在来源“${sourceName}”内重复：第 ${local.get(id)+1} 行与第 ${i+1} 行。`, chain:[sourceName,`#${local.get(id)+1} ${id}`,`#${i+1} ${id}`]},locate(i)));
      }
      if (id) local.set(id, local.has(id)?local.get(id):i);
      ['position','rotationEuler','size'].forEach(k=>{ if(r[k]!==undefined&&!Array.isArray(r[k])) errors.push(Object.assign({code:'INVALID_FIELD', objectId:id||null, field:k, message:`对象“${id||i+1}”的 ${k} 必须是长度为 3 的数组。`, chain:[sourceName,id||`#${i+1}`,k]},locate(i))); });
      if (Array.isArray(r.position)&&r.position.length!==3) errors.push(Object.assign({code:'INVALID_FIELD', objectId:id||null, field:'position', message:`对象“${id||i+1}”的 position 必须恰好包含 x,y,z。`, chain:[sourceName,id||`#${i+1}`,'position']},locate(i)));
      if (Array.isArray(r.rotationEuler)&&r.rotationEuler.length!==3) errors.push(Object.assign({code:'INVALID_FIELD', objectId:id||null, field:'rotationEuler', message:`对象“${id||i+1}”的 rotationEuler 必须恰好包含 rx,ry,rz（度）。`, chain:[sourceName,id||`#${i+1}`,'rotationEuler']},locate(i)));
      const badSize=!Array.isArray(r.size)||r.size.length!==3||r.size.some(v=>!Number.isFinite(Number(v))||Number(v)<=0);
      if (badSize) errors.push(Object.assign({code:'INVALID_SIZE', objectId:id||null, field:'size', value:Array.isArray(r.size)?r.size.slice():r.size, message:`对象“${id||i+1}”的包围尺寸必须是三个严格大于 0 的数字；收到 ${Array.isArray(r.size)?'['+r.size.join(', ')+']':String(r.size)}。`, chain:[sourceName,id||`#${i+1}`,'size']},locate(i)));
      ['position','rotationEuler'].forEach(k=>{ if(Array.isArray(r[k])&&r[k].some(v=>!Number.isFinite(Number(v)))) errors.push(Object.assign({code:'INVALID_FIELD', objectId:id||null, field:k, message:`对象“${id||i+1}”的 ${k} 包含非有限数字。`, chain:[sourceName,id||`#${i+1}`,k]},locate(i))); });
      if (r.parentId!==undefined&&r.parentId!==null&&String(r.parentId)===id) errors.push(Object.assign({code:'SELF_PARENT', objectId:id, parentId:id, message:`对象“${id}”不能把自己声明为父对象。`, chain:[id,id]},locate(i)));
    });
    const ids=new Set(); records.forEach(r=>{if(r&&r.id!=null)ids.add(String(r.id));});
    records.forEach((r,i)=>{ if(r&&r.parentId!=null) { const p=String(r.parentId), id=String(r.id); if(!ids.has(p)&&!(allRecords&&allRecords.has(p))) errors.push(Object.assign({code:'MISSING_PARENT', objectId:id, parentId:p, message:`对象“${id}”引用了不存在的父对象“${p}”。涉及链条：${id} → ${p}（终点缺失）。`, chain:[id,p,'<不存在>']},locate(i))); }});
    return errors;
  }

  function detectCycles(records) {
    const errors=[], state=new Map(), safe=new Set();
    function walk(id) {
      if (safe.has(id)) return [];
      const st=state.get(id);
      if (st===1) {
        const rec=records.get(id), chain=[]; let cur=id;
        do { chain.push(cur); const r=records.get(cur); if(!r||!r.parentId) break; cur=String(r.parentId); } while(cur!==id&&records.has(cur));
        chain.push(id); return chain;
      }
      if (st===2) return [];
      state.set(id,1); const r=records.get(id);
      if (r&&r.parentId&&records.has(r.parentId)) { const c=walk(r.parentId); if(c.length){ if(!safe.has(id)) errors.push({code:'PARENT_CYCLE', objectId:id, parentId:r.parentId, chain:c, message:`父子关系不允许成环：${c.join(' → ')}。`}); state.set(id,2); return c; } }
      state.set(id,2); safe.add(id); return [];
    }
    Array.from(records.keys()).sort().forEach(walk); return errors;
  }
  function normalizeGroup(g) {
    const objects=(g.objects||[]).map((r,i)=>({id:String(r.id), parentId:r.parentId==null?null:String(r.parentId), position:Array.isArray(r.position)?r.position.map(Number):[0,0,0], rotationEuler:Array.isArray(r.rotationEuler)?r.rotationEuler.map(Number):[0,0,0], size:Array.isArray(r.size)?r.size.map(Number):[0,0,0], _index:i}));
    return {name:String(g.name||g.id||'未命名来源'), objects};
  }
  function describeValue(rec){return `位置=[${rec.position.map(n=>round(Number(n),6)).join(', ')}]，朝向(°)=[${rec.rotationEuler.map(n=>round(Number(n),6)).join(', ')}]，尺寸=[${rec.size.map(n=>round(Number(n),6)).join(', ')}]`;}
  function conflicting(a,b) {
    if (!sameVec(a.size,b.size)) return true;
    if (!sameVec(a.position,b.position)) return true;
    if (!sameVec(a.rotationEuler,b.rotationEuler,ANG_EPS,true)) return true;
    if (a.parentId!==b.parentId) return true;
    return false;
  }
  function sourceLabel(group,rec){return `${group.name}#${rec._index+1}`;}

  class Workbench {
    constructor(){ this.reset(); }
    reset() {
      this.groups=[]; this.groupsByName=new Map(); this.records=new Map(); this.activeRecords=new Map(); this.sourcesById=new Map();
      this.accepted=new Map(); this.conflicts=new Map(); this.rejections=[];
      this.plane={normal:[1,0,0], offset:2};
      this.measurements=new Map(); this.sections=new Map(); this.worldCache=new Map(); this.obbs=new Map();
      this.stats={sectionsRecomputed:0,measurementsRecomputed:0,lastScope:'empty'};
      this._seq=1;
    }
    static deriveFull(groups, plane, measurements, accepted) {
      const wb=new Workbench();
      wb.groups=cloneDeep(groups||[]); wb.plane=cloneDeep(plane||{normal:[1,0,0],offset:0});
      wb.measurements=new Map(Object.entries(measurements||{}).map(([id,m])=>[id,cloneDeep(m)]));
      wb.buildModel(false); if(accepted)for(const [id,a] of accepted)if(a&&a.manual&&wb.sourcesById.has(id))wb.setAccepted(id,a.source,a.index); wb.recomputeAll(false);
      return wb.snapshot();
    }
    loadGroups(input, {replace=true}={}) {
      const incoming=Array.isArray(input)?input:[input];
      const candidate=replace?[]:this.groups.map(cloneDeep);
      const usedNames=new Set(candidate.map(g=>g.name));
      incoming.forEach(g0=>{
        const name=String(g0.name||g0.id||'未命名来源');
        if (usedNames.has(name)) throw new Error(`来源名称“${name}”重复；请为每批数据指定不同 name。`);
        usedNames.add(name); candidate.push(normalizeGroup(g0));
      });
      const allRecords=new Map(), seenGlobal=new Map(), rejections=[];
      for (const g of candidate) {
        const errs=validateSource(g, allRecords, seenGlobal);
        if (errs.length) rejections.push(...errs);
        for (const r of g.objects) { if(!allRecords.has(r.id)){allRecords.set(r.id,r);seenGlobal.set(r.id,g.name);} }
      }
      const cycleErrors=detectCycles(allRecords); rejections.push(...cycleErrors);
      if (rejections.length) { this.rejections=rejections; return {ok:false, errors:rejections}; }
      this.groups=candidate; this.rejections=[]; this.buildModel(true,true);
      this.sections.clear(); this.measurements.forEach((m,id)=>this.measurements.set(id,m));
      this.recomputeAll(true);
      return {ok:true, errors:[]};
    }
    buildModel(keepAccepted, preserveAccepted) {
      this.groupsByName=new Map(this.groups.map(g=>[g.name,g]));
      this.records=new Map(); this.activeRecords=new Map(); this.sourcesById=new Map();
      const sourceOrder=[];
      this.groups.forEach(g=>g.objects.forEach(r=>{
        if(!this.records.has(r.id)) this.records.set(r.id,r);
        if(!this.sourcesById.has(r.id)) this.sourcesById.set(r.id,[]);
        const rec=Object.assign({},r,{source:g.name,label:sourceLabel(g,r)});
        this.sourcesById.get(r.id).push(rec); sourceOrder.push([g.name,r._index,r.id,rec]);
      }));
      sourceOrder.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:a[1]-b[1]);
      this.accepted=new Map(); this.conflicts=new Map();
      for (const [gname,idx,id,rec] of sourceOrder) {
        if(!this.accepted.has(id)) this.accepted.set(id,{source:gname,index:idx,manual:false});
      }
      if (preserveAccepted) { const previous=this.accepted; for (const [id,a] of previous) if(this.sourcesById.has(id)&&this.sourcesById.get(id).some(s=>s.source===a.source&&s._index===a.index)) this.accepted.set(id,Object.assign({},a)); for (const [id,a] of Array.from(this.accepted.entries())) if(!this.sourcesById.has(id)||!this.sourcesById.get(id).some(s=>s.source===a.source&&s._index===a.index)) this.accepted.set(id,this.chooseAccepted(id)); }
      this.activeRecords=new Map();
      for (const [id,a] of this.accepted) { const r=this.sourcesById.get(id).find(s=>s.source===a.source&&s._index===a.index); if(r)this.activeRecords.set(id,r); }
      const conflictIds=[];
      for (const id of Array.from(this.sourcesById.keys()).sort()) {
        const ss=this.sourcesById.get(id), records=[];
        for(let i=0;i<ss.length;i++) for(let j=i+1;j<ss.length;j++) if(conflicting(ss[i],ss[j])) records.push({a:ss[i],b:ss[j]});
        if(records.length){ const acc=this.accepted.get(id); this.conflicts.set(id,{id, acceptedSource:acc.source, acceptedIndex:acc.index, pairs:records, message:`对象“${id}”有 ${ss.length} 个来源且取值互相矛盾；当前采用 ${acc.source}#${acc.index+1}，另一方数据仍保留。`}); conflictIds.push(id); }
      }
      return conflictIds;
    }
    chooseAccepted(id) { const s=(this.sourcesById.get(id)||[]).slice().sort((a,b)=>a.source<b.source?-1:a.source>b.source?1:a._index-b._index)[0]; return s?{source:s.source,index:s._index,manual:false}:null; }
    activeRecord(id){ const a=this.accepted.get(id); return (this.sourcesById.get(id)||[]).find(s=>s.source===a.source&&s._index===a.index)||null; }
    setAccepted(id,source,index) {
      if(!this.sourcesById.has(id)) throw new Error(`对象 ${id} 不存在`);
      const old=this.activeRecord(id), found=this.sourcesById.get(id).find(s=>s.source===source&&s._index===Number(index));
      if(!found) throw new Error('指定的冲突来源不存在');
      this.accepted.set(id,{source,index:Number(index),manual:true});
      this.activeRecords.set(id,found);
      const changed=this.refreshAfterChange({changed:[id], reason:'conflict-accepted', oldBoxes:old?new Map([[id,this.obbs.get(id)]]):new Map(), oldPlane:cloneDeep(this.plane)}, true);
      return changed;
    }
    updateObject(id, patch, sourceName='人工修订') {
      const old=this.activeRecord(id);
      if(!old) return {ok:false,errors:[{code:'MISSING_OBJECT',objectId:id,message:`对象“${id}”不存在。`,chain:[id]}]};
      const gname=String(sourceName||'人工修订');
      if(!this.groupsByName.has(gname)) {
        const g={name:gname,objects:[]};
        this.groups.push(g); this.groupsByName.set(gname,g);
      }
      const g=this.groupsByName.get(gname);
      const rec={id:String(id), parentId:patch.parentId===undefined?old.parentId:patch.parentId==null?null:String(patch.parentId), position:patch.position?patch.position.map(Number):old.position.slice(), rotationEuler:patch.rotationEuler?patch.rotationEuler.map(Number):old.rotationEuler.slice(), size:patch.size?patch.size.map(Number):old.size.slice()};
      const validation=validateSource(normalizeGroup({name:gname,objects:[rec]}),this.records,new Map());
      const testRecords=new Map(this.records); testRecords.set(id,rec);
      validation.push(...detectCycles(testRecords));
      if(validation.length) return {ok:false,errors:validation};
      rec._index=g.objects.length; g.objects.push(rec);
      const committed=this.commitGroups(cloneDeep(this.groups),{changed:[id],reason:'object-edit'},{id,source:gname,index:rec._index})
      if(committed.ok) this.setAccepted(id,gname,rec._index);
      return committed;
    }
    commitGroups(nextGroups, change, acceptChoice) {
      const oldBoxes=new Map(), oldWorldParents=new Map();
      for (const id of change.changed||[]) { oldBoxes.set(id,this.obbs.get(id)); const r=this.activeRecord(id); if(r) oldWorldParents.set(id,r.parentId); }
      const oldPlane=cloneDeep(this.plane), oldGroups=this.groups;
      this.groups=nextGroups;
      const rejections=[]; const allRecords=new Map(), seen=new Map();
      for(const g of this.groups){ const errs=validateSource(g,allRecords,seen); if(errs.length)rejections.push(...errs); g.objects.forEach(r=>{if(!allRecords.has(r.id)){allRecords.set(r.id,r);seen.set(r.id,g.name);}}); }
      rejections.push(...detectCycles(allRecords));
      if(rejections.length){ this.groups=oldGroups; this.rejections=rejections; return {ok:false,errors:rejections}; }
      this.rejections=[];
      const oldAccepted=cloneDeep(Array.from(this.accepted.entries()));
      this.buildModel(true,false); if(acceptChoice) this.accepted.set(acceptChoice.id,{source:acceptChoice.source,index:acceptChoice.index,manual:true});
      for(const [id,a] of oldAccepted){ const n=this.accepted.get(id); if(n&&JSON.stringify(a)!==JSON.stringify(n)) (change.changed=change.changed||[],change.changed.includes(id)||change.changed.push(id)); }
      this.activeRecords=new Map(); for(const [id,a] of this.accepted){const r=this.sourcesById.get(id).find(s=>s.source===a.source&&s._index===a.index); if(r)this.activeRecords.set(id,r);}
      const affected=this.refreshAfterChange(Object.assign({},change,{oldBoxes,oldWorldParents,oldPlane}),true);
      return {ok:true, errors:[], affected};
    }    recomputeWorld(affectedSet) {
      this.worldCache=new Map();
      const order=[]; const visiting=new Set(), done=new Set();
      const visit=(id)=>{
        if(done.has(id))return; if(visiting.has(id))return;
        visiting.add(id); const r=this.records.get(id); if(r&&r.parentId&&this.records.has(r.parentId))visit(r.parentId);
        visiting.delete(id); done.add(id); order.push(id);
      };
      const ids=affectedSet?Array.from(affectedSet):Array.from(this.records.keys());
      ids.forEach(visit);
      for(const id of order){ const r=this.activeRecord(id); if(!r)continue; const w=composeWorld(this.activeRecords,id,this.worldCache); }
      // composeWorld needs active records: keep compatible lookup proxy below.
      return order;
    }
    refreshWorldAffected(changedIds, oldParents) {
      const changed=new Set(changedIds);
      for(const id of changed){ const op=oldParents&&oldParents.get(id); if(op&&this.records.has(op))changed.add(op); }
      const affected=new Set(changed);
      let added=true;
      while(added){ added=false; for(const [id,r] of this.records){ if(r.parentId&&affected.has(r.parentId)&&!affected.has(id)){affected.add(id);added=true;} } }
      for(const id of affected)this.worldCache.delete(id);
      const ordered=[]; const visiting=new Set(), done=new Set();
      const visit=(id)=>{ if(done.has(id)||!this.records.has(id))return; if(visiting.has(id))return; visiting.add(id); const r=this.activeRecord(id); if(r&&r.parentId)visit(r.parentId); visiting.delete(id); done.add(id); ordered.push(id); };
      Array.from(affected).sort().forEach(visit);
      for(const id of ordered){ const old=this.obbs.get(id); if(old)this._oldBoxes=this._oldBoxes||new Map(); if(old&&!this._oldBoxes.has(id))this._oldBoxes.set(id,old); const r=this.activeRecord(id); if(r){ const w=composeWorld(this.activeRecords,id,this.worldCache); this.obbs.set(id,makeObbs(new Map([[id,r]]),this.worldCache).get(id)); } else this.obbs.delete(id); }
      return affected;
    }
    refreshAfterChange(change={}, useIncremental=true) {
      this._oldBoxes=change.oldBoxes?new Map(change.oldBoxes):this._oldBoxes||new Map();
      const changedIds=(change.changed||[]).filter(id=>this.records.has(id));
      const affected=this.refreshWorldAffected(changedIds,change.oldWorldParents);
      this.refreshSections(affected,useIncremental);
      this.refreshMeasurements(affected,change.oldPlane,useIncremental);
      const scope={changedIds:Array.from(new Set(change.changed||[])).sort(), affectedObjects:Array.from(affected).sort(), reason:change.reason||'change'};
      this.stats.lastScope=scope;
      this._oldBoxes=undefined;
      return scope;
    }
    recomputeAll(track=true) {
      this.worldCache=new Map(); this.obbs=makeObbs(this.activeRecords,this.worldCache);
      this.sections=new Map();
      for(const id of Array.from(this.records.keys()).sort()) {
        if(this.planeCuts(this.obbs.get(id))) { const s=this.computeSection(id); if(s)this.sections.set(id,s); }
      }
      for(const id of Array.from(this.measurements.keys()).sort()) this.measurements.set(id,this.evaluateMeasurement(id,this.measurements.get(id)));
      this.stats={sectionsRecomputed:this.sections.size, measurementsRecomputed:this.measurements.size, lastScope:track?'full-recompute':'full-derive'};
      return this.stats;
    }
    setPlane(patchOrValue) {
      const np=patchOrValue&&patchOrValue.normal?{normal:patchOrValue.normal.map(Number),offset:Number(patchOrValue.offset)}:{normal:this.plane.normal.slice(),offset:patchOrValue===undefined?this.plane.offset:Number(patchOrValue)};
      if(!Array.isArray(np.normal)||np.normal.length!==3||np.normal.some(v=>!Number.isFinite(v))) return {ok:false,errors:[{code:'INVALID_PLANE_NORMAL',message:'剖切面朝向必须是三个有限数字组成的向量。',chain:['剖切面','normal']}]};
      if(Math.hypot(...np.normal)<EPS) return {ok:false,errors:[{code:'ZERO_PLANE_NORMAL',message:'剖切面朝向不能为零向量。',chain:['剖切面','normal']}]};
      if(!Number.isFinite(np.offset)) return {ok:false,errors:[{code:'INVALID_PLANE_OFFSET',message:'剖切面偏移必须是有限数字。',chain:['剖切面','offset']}]};
      np.normal=norm(np.normal); const old=cloneDeep(this.plane);
      if(sameVec(np.normal,old.normal,1e-10)&&sameValue(np.offset,old.offset,1e-10))return {ok:true,unchanged:true};
      this.plane=np;
      this.refreshSections(null,true);
      this.refreshMeasurements(null,old,true);
      this.stats.lastScope={changedIds:[],affectedObjects:[],reason:'plane-move',oldPlane:old,newPlane:cloneDeep(np)};
      return {ok:true};
    }
    planeD(box){return dot(this.plane.normal,box.center)-this.plane.offset;}
    planeIntersects(box){ const r=box.half[0]*Math.abs(dot(this.plane.normal,box.axes[0]))+box.half[1]*Math.abs(dot(this.plane.normal,box.axes[1]))+box.half[2]*Math.abs(dot(this.plane.normal,box.axes[2])); return Math.abs(this.planeD(box))<=r+EPS; }
    planeCuts(box){ const r=box.half[0]*Math.abs(dot(this.plane.normal,box.axes[0]))+box.half[1]*Math.abs(dot(this.plane.normal,box.axes[1]))+box.half[2]*Math.abs(dot(this.plane.normal,box.axes[2])); return Math.abs(this.planeD(box))<r-EPS; }    refreshSections(affectedSet, incremental=true) {
      let ids=Array.from(this.records.keys()).sort();
      if(incremental&&affectedSet) ids=ids.filter(id=>affectedSet.has(id)||this.sections.has(id)===false);
      if(incremental&&!affectedSet) ids=Array.from(this.records.keys()).sort();
      let count=0;
      for(const id of ids){ const box=this.obbs.get(id); if(!box)continue; const cut=this.planeCuts(box);
        if(!cut){ if(this.sections.has(id))this.sections.delete(id); continue; }
        const sig={id, plane:{normal:vecRound(this.plane.normal,14),offset:round(this.plane.offset,14)}, center:vecRound(box.center,14), axes:box.axes.map(a=>vecRound(a,14)), half:box.half.map(v=>round(v,14))};
        const old=this.sections.get(id);
        if(old&&JSON.stringify(old.signature)===JSON.stringify(sig))continue;
        this.sections.set(id,this.computeSection(id,box,sig)); count++;
      }
      this.stats.sectionsRecomputed=count;
    }
    computeSection(id,boxArg,sigArg) {
      const box=boxArg||this.obbs.get(id); if(!box)return null;
      const n=this.plane.normal, d=this.plane.offset;
      const verts=[];
      for(const z of [-1,1]) for(const y of [-1,1]) for(const x of [-1,1]) {
        const v=[0,1,2].map(k=>box.center[k]+box.axes[0][k]*x*box.half[0]+box.axes[1][k]*y*box.half[1]+box.axes[2][k]*z*box.half[2]); verts.push(v);
      }
      const edges=[[0,1],[1,3],[3,2],[2,0],[4,6],[6,7],[7,5],[5,4],[0,4],[1,5],[2,6],[3,7]];
      const poly=[];
      function put(p){ if(p&&p.every(Number.isFinite)&&!poly.some(q=>length(sub(q,p))<1e-8)) poly.push(p); }
      for(const [i,j] of edges) {
        const a=verts[i],b=verts[j], da=dot(n,a)-d, db=dot(n,b)-d;
        if(Math.abs(da)<=EPS)put(a);
        if(Math.abs(db)<=EPS)put(b);
        if((da<-EPS&&db>EPS)||(da>EPS&&db<-EPS)){ const t=da/(da-db); put(add(a,mul(sub(b,a),t))); }
      }
      const clean=poly.filter(p=>p&&p.every&&p.every(Number.isFinite)); poly.length=0; clean.forEach(p=>poly.push(p));
      let center=poly.reduce(add,[0,0,0]); center=mul(center,1/poly.length);
      let ref,side; const ni=[0,1,2].sort((a,b)=>Math.abs(n[b])-Math.abs(n[a]))[0]; const axesList=[[1,0,0],[0,1,0],[0,0,1]]; ref=axesList[(ni+1)%3]; side=axesList[(ni+2)%3]; if(dot(cross(n,ref),side)<0){const tmp=ref;ref=side;side=tmp;} ref=norm(sub(ref,mul(n,dot(ref,n)))); side=norm(cross(n,ref));
      poly.sort((a,b)=>{const ua=sub(a,center),ub=sub(b,center); const aa=Math.atan2(dot(ua,side),dot(ua,ref)); const ab=Math.atan2(dot(ub,side),dot(ub,ref)); return aa-ab;});
      const world=poly.map(p=>vecRound(p,10));
      const local=world.map(p=>{const u=sub(p,box.center); return [round(dot(u,box.axes[0]),10),round(dot(u,box.axes[1]),10),round(dot(u,box.axes[2]),10)];});
      let area=0; for(let i=0;i<poly.length;i++){const pa=poly[i],pb=poly[(i+1)%poly.length]; if(pa&&pb)area+=dot(cross(sub(pa,center),sub(pb,center)),n);} area=Math.abs(area)/2;
      const signature=sigArg||{id, plane:{normal:vecRound(n,14),offset:round(d,14)},center:vecRound(box.center,14),axes:box.axes.map(a=>vecRound(a,14)),half:box.half.map(v=>round(v,14))};
      return {id, polygon:world, localPolygon:local, center:vecRound(center,10), normal:vecRound(n,10), area:round(area,10), conflicting:this.conflicts.has(id), signature};
    }
    addMeasurement(def) {
      const id=def.id||('M'+String(this._seq++));
      const m={id,type:def.type==='object-object'?'object-object':def.type==='point-object'?'point-object':'point-point', pointA:def.pointA?def.pointA.map(Number):null, pointB:def.pointB?def.pointB.map(Number):null, objectA:def.objectA||null, objectB:def.objectB||null, label:def.label||id};
      const e=this.validateMeasurement(m); if(e.length)return {ok:false,errors:e};
      this.measurements.set(id,m); this.measurements.set(id,this.evaluateMeasurement(id,m));
      this.stats.measurementsRecomputed=1; this.stats.lastScope={changedIds:[],affectedObjects:[],reason:'measurement-add',measurementId:id};
      return {ok:true,id,result:this.measurements.get(id)};
    }
    removeMeasurement(id){const ok=this.measurements.delete(id);return {ok};}
    validateMeasurement(m) {
      const e=[]; const needObj=id=>{if(!this.records.has(id))e.push({code:'MEASURE_MISSING_OBJECT',objectId:id,message:`测量引用的对象“${id}”不存在。`,chain:['测量',m.id,id,'<不存在>']});};
      const needPoint=p=>{if(!p||!Array.isArray(p)||p.length!==3||p.some(v=>!Number.isFinite(Number(v))))e.push({code:'INVALID_POINT',message:`测量“${m.id}”包含无效三维点。`,chain:['测量',m.id,'point']});};
      if(m.type==='point-point'){needPoint(m.pointA);needPoint(m.pointB);}
      if(m.type==='point-object'){needPoint(m.pointA);needObj(m.objectB);}
      if(m.type==='object-object'){needObj(m.objectA);needObj(m.objectB);}
      return e;
    }    segmentBoxInfo(a,b,box,includeEnds=true) {
      const d=sub(b,a), ad=[dot(d,box.axes[0]),dot(d,box.axes[1]),dot(d,box.axes[2])], ac=[dot(sub(a,box.center),box.axes[0]),dot(sub(a,box.center),box.axes[1]),dot(sub(a,box.center),box.axes[2])], h=box.half;
      let t0=0,t1=1;
      for(let i=0;i<3;i++){
        if(Math.abs(ad[i])<EPS){ if(ac[i]<-h[i]-EPS||ac[i]>h[i]+EPS)return null; }
        else { let ta=(-h[i]-ac[i])/ad[i], tb=(h[i]-ac[i])/ad[i]; if(ta>tb)[ta,tb]=[tb,ta]; t0=Math.max(t0,ta); t1=Math.min(t1,tb); if(t0>t1+EPS)return null; }
      }
      const enter=clamp(t0,0,1), exit=clamp(t1,0,1);
      if(!includeEnds&&exit<=EPS)return null;
      return {enter,exit, enterPoint:add(a,mul(d,enter)), exitPoint:add(a,mul(d,exit))};
    }
    segmentCrossesPlane(a,b){const va=dot(this.plane.normal,a)-this.plane.offset,vb=dot(this.plane.normal,b)-this.plane.offset;return Math.abs(va)<=DIST_EPS&&Math.abs(vb)<=DIST_EPS?false:(va<=-EPS&&vb>=EPS)||(va>=EPS&&vb<=-EPS);}
    pointInBox(p,box){const u=sub(p,box.center);return [0,1,2].every(i=>Math.abs(dot(u,box.axes[i]))<=box.half[i]+DIST_EPS);}
    closestPointOnBox(p,box){const u=sub(p,box.center),c=[0,0,0],outside=false;
      for(let i=0;i<3;i++){let x=clamp(dot(u,box.axes[i]),-box.half[i],box.half[i]);if(Math.abs(dot(u,box.axes[i]))>box.half[i]+DIST_EPS)outside=true;c=add(c,mul(box.axes[i],x));}
      return {point:add(box.center,c),outside};
    }
    boxOverlap(a,b){
      const axes=[]; a.axes.forEach(x=>axes.push(x)); b.axes.forEach(x=>axes.push(x));
      a.axes.forEach(x=>b.axes.forEach(y=>axes.push(cross(x,y))));
      for(const ax0 of axes){const ax=norm(ax0); if(length(ax0)<EPS)continue; const ca=dot(a.center,ax),cb=dot(b.center,ax); const ra=a.half[0]*Math.abs(dot(ax,a.axes[0]))+a.half[1]*Math.abs(dot(ax,a.axes[1]))+a.half[2]*Math.abs(dot(ax,a.axes[2])); const rb=b.half[0]*Math.abs(dot(ax,b.axes[0]))+b.half[1]*Math.abs(dot(ax,b.axes[1]))+b.half[2]*Math.abs(dot(ax,b.axes[2])); if(Math.abs(ca-cb)>ra+rb+DIST_EPS)return false;}
      return true;
    }
    closestBoxPoints(A,B) {
      if(this.boxOverlap(A,B)) return {distance:0,pointA:A.center,pointB:A.center,overlap:true};
      const alpha=[0,0,0], beta=[0,0,0];
      const pointA=()=>add(A.center,A.axes.reduce((acc,ax,i)=>add(acc,mul(ax,alpha[i])),[0,0,0]));
      const pointB=()=>add(B.center,B.axes.reduce((acc,ax,i)=>add(acc,mul(ax,beta[i])),[0,0,0]));
      for(let k=0;k<240;k++){
        let move=0; let r=sub(pointA(),pointB());
        for(let i=0;i<3;i++){const delta=clamp(-dot(r,A.axes[i]),-A.half[i]-alpha[i],A.half[i]-alpha[i]); alpha[i]+=delta; r=add(r,mul(A.axes[i],delta)); move=Math.max(move,Math.abs(delta));}
        for(let i=0;i<3;i++){const delta=clamp(dot(r,B.axes[i]),-B.half[i]-beta[i],B.half[i]-beta[i]); beta[i]+=delta; r=sub(r,mul(B.axes[i],delta)); move=Math.max(move,Math.abs(delta));}
        if(move<1e-12)break;
      }
      const a=pointA(),b=pointB();
      return {distance:length(sub(a,b)),pointA:a,pointB:b,overlap:false};
    }
    evaluateMeasurement(id,m0) {
      const m=cloneDeep(m0); const errors=this.validateMeasurement(m);
      if(errors.length)return Object.assign({},m,{id,status:'rejected',errors,distance:null,visibleDistance:null,blocked:false,crossesPlane:false});
      let a,b,objectA=null,objectB=null;
      if(m.type==='point-point'){a=m.pointA.map(Number);b=m.pointB.map(Number);}
      if(m.type==='point-object'){a=m.pointA.map(Number);objectB=this.obbs.get(m.objectB); const cp=this.closestPointOnBox(a,objectB);b=cp.point; if(cp.outside===false&&!this.pointInBox(a,objectB))b=a.slice();}
      if(m.type==='object-object'){objectA=this.obbs.get(m.objectA);objectB=this.obbs.get(m.objectB); if(this.boxOverlap(objectA,objectB)){const p=this.pointInBox(objectA.center,objectB)?objectA.center:objectB.center;a=p.slice();b=p.slice();}else{const cp=this.closestBoxPoints(objectA,objectB);a=cp.pointA;b=cp.pointB;}}
      const segmentLength=length(sub(b,a));
      const blockers=[];
      for(const box of this.obbs.values()){
        if(m.objectA===box.id||m.objectB===box.id)continue;
        const hit=this.segmentBoxInfo(a,b,box,false);
        if(hit&&hit.enter>1e-8&&hit.exit-hit.enter>1e-8)blockers.push({objectId:box.id,enter:round(hit.enter,10),exit:round(hit.exit,10),enterPoint:vecRound(hit.enterPoint,8),exitPoint:vecRound(hit.exitPoint,8)});
      }
      blockers.sort((x,y)=>x.enter-y.enter||x.objectId.localeCompare(y.objectId));
      const crosses=this.segmentCrossesPlane(a,b);
      let visibleDistance=segmentLength;
      if(blockers.length){ const first=blockers[0]; visibleDistance=Math.max(0,segmentLength*first.enter); }
      const overlap=!!(m.type==='object-object'&&this.boxOverlap(objectA,objectB));
      let status='visible'; if(errors.length)status='rejected'; else if(overlap)status='intersecting'; else if(blockers.length)status='blocked';
      return Object.assign({},m,{id, endpointA:vecRound(a,8), endpointB:vecRound(b,8), distance:round(segmentLength,8), visibleDistance:round(visibleDistance,8), blocked:blockers.length>0, blockers, crossesPlane:crosses, status, conflict:crosses?'测量线段跨越当前剖切面，长度只表示原始模型几何距离，请结合截面复核。':null});
    }    measurementTouchesObject(m,id){return m.objectA===id||m.objectB===id;}
    segmentMayTouchBox(a,b,box,pad=0.05){const sLo=[Infinity,Infinity,Infinity],sHi=[-Infinity,-Infinity,-Infinity],bLo=[Infinity,Infinity,Infinity],bHi=[-Infinity,-Infinity,-Infinity]; function eat(lo,hi,p){for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],p[i]-pad);hi[i]=Math.max(hi[i],p[i]+pad);}} eat(sLo,sHi,a);eat(sLo,sHi,b);for(const sx of [-1,1])for(const sy of [-1,1])for(const sz of [-1,1]){const p=box.center.map((c,i)=>c+box.axes[0][i]*sx*box.half[0]+box.axes[1][i]*sy*box.half[1]+box.axes[2][i]*sz*box.half[2]);eat(bLo,bHi,p);} return sLo[0]<=bHi[0]&&bLo[0]<=sHi[0]&&sLo[1]<=bHi[1]&&bLo[1]<=sHi[1]&&sLo[2]<=bHi[2]&&bLo[2]<=sHi[2];}
    refreshMeasurements(affectedSet, oldPlane, incremental=true) {
      const dirty=new Set();
      if(!incremental){ for(const id of this.measurements.keys())dirty.add(id); }
      else if(!affectedSet && oldPlane) {
        for(const [id,m] of this.measurements){ const r=m.status?m:this.evaluateMeasurement(id,m); const ep=[r.endpointA,r.endpointB]; const oldNorm=oldPlane.normal,oldOff=oldPlane.offset;
          const oldCross=()=>{const va=dot(oldNorm,ep[0])-oldOff,vb=dot(oldNorm,ep[1])-oldOff;return (va<=-EPS&&vb>=EPS)||(va>=EPS&&vb<=-EPS);};
          if(oldCross()||this.segmentCrossesPlane(ep[0],ep[1]))dirty.add(id);
        }
      } else {
        for(const [id,m] of this.measurements){
          let touched=false;
          for(const oid of affectedSet){ if(this.measurementTouchesObject(m,oid))touched=true; const boxes=[this._oldBoxes&&this._oldBoxes.get(oid),this.obbs.get(oid)].filter(Boolean); const prev=this.measurements.get(id); const eps2=prev.endpointA?[prev.endpointA,prev.endpointB]:[];
            for(const box of boxes){ if(prev.endpointA&&(this.segmentBoxInfo(prev.endpointA,prev.endpointB,box,false)!==null||this.segmentMayTouchBox(prev.endpointA,prev.endpointB,box)))touched=true; }
          }
          if(touched)dirty.add(id);
        }
      }
      let count=0;
      for(const id of Array.from(dirty).sort()){ const def=this.measurements.get(id); this.measurements.set(id,this.evaluateMeasurement(id,def));count++; }
      this.stats.measurementsRecomputed=count;
    }
    hierarchy() {
      const children=new Map(); const roots=[];
      for(const id of this.records.keys())children.set(id,[]);
      for(const [id,r] of this.records){ if(r.parentId&&children.has(r.parentId))children.get(r.parentId).push(id); else roots.push(id); }
      children.forEach(v=>v.sort()); roots.sort();
      return {roots,children};
    }
    chain(id){const out=[];let cur=id,guard=0;while(cur&&this.records.has(cur)&&guard++<1000){out.unshift(cur);cur=this.records.get(cur).parentId;}return out;}
    conflictAlternatives(id){ const arr=this.sourcesById.get(id)||[]; return arr.map(r=>({source:r.source,index:r._index,label:r.label,record:{id:r.id,parentId:r.parentId,position:r.position,rotationEuler:r.rotationEuler,size:r.size},description:describeValue(r)})); }
    snapshot() {
      const stableMeasurements={}; for(const id of Array.from(this.measurements.keys()).sort())stableMeasurements[id]=this.measurements.get(id);
      return {
        plane:cloneDeep(this.plane), groups:cloneDeep(this.groups), measurements:stableMeasurements,
        sections:Object.fromEntries(Array.from(this.sections.entries()).sort()),
        conflicts:Object.fromEntries(Array.from(this.conflicts.entries()).sort()),
        hierarchy:this.hierarchy(), stats:cloneDeep(this.stats)
      };
    }
    exportProject(){return JSON.stringify({version:1,groups:this.groups,plane:this.plane,measurements:Array.from(this.measurements.values()).map(m=>{const x=cloneDeep(m);delete x.blockers;delete x.endpointA;delete x.endpointB;delete x.distance;delete x.visibleDistance;delete x.status;delete x.crossesPlane;delete x.conflict;return x;}),accepted:Array.from(this.accepted.entries()).map(([id,a])=>[id,a])},null,2);}
    importProject(json,replace=true){ const data=JSON.parse(json); const r=this.loadGroups(data.groups,{replace}); if(!r.ok)return r; if(data.plane)this.setPlane(data.plane); if(Array.isArray(data.measurements))data.measurements.forEach(m=>this.addMeasurement(m)); if(data.accepted)for(const [id,a]of data.accepted){if(this.sourcesById.has(id)&&a&&a.manual)this.setAccepted(id,a.source,a.index);} return {ok:true}; }
  }

  return {Workbench, validateSource, detectCycles, eulerToQuat, qRotate, makeObbs, composeWorld, math:{add,sub,mul,dot,cross,length,norm,clamp,round,vecRound,closestBoxPoints:null}, EPS};
}));
