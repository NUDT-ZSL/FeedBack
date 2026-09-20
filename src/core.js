/* Hierarchical transform solver with lock compensation and incremental updates. */
(function(root,factory){
 if(typeof module==="object"&&module.exports)module.exports=factory(require("./math"));
 else root.TransformCore=factory(root.TransformMath);
})(typeof self!=="undefined"?self:this,function(M){
"use strict";

const ISSUE={
 CYCLE:"cycle",
 CYCLE_DESCENDANT:"cycle-descendant",
 MISSING_PARENT:"missing-parent",
 INVALID_LOCAL:"invalid-local",
 SINGULAR:"singular",
 SHEAR:"shear",
 MIRROR:"mirror"
};

class TransformEngine{
 constructor(scene){
  this.nodes=new Map();
  this.states=new Map();
  this.order=[];
  this.version=0;
  this.history=[];this.future=[];
  this.lastResult={ok:true,affectedIds:[],changedWorldIds:[],recalculatedIds:[],errors:[],warnings:[]};
  this.loadScene(scene||{nodes:[]},{snapshot:false});
 }

 _defaultNode(n={}){
  const num=(a,d)=>Array.isArray(a)&&a.length===3?a.map(x=>Number.isFinite(Number(x))?Number(x):NaN):d;
  return {
   id:String(n.id||""),name:String(n.name||n.id||"Object"),
   parent:n.parent==null?null:String(n.parent),
   translation:num(n.translation,[0,0,0]),
   rotation:num(n.rotation,[0,0,0]),
   scale:num(n.scale,[1,1,1]),
   locked:!!n.locked,lockReason:n.lockReason==null?undefined:String(n.lockReason),color:String(n.color||"#67b7dc"),
   shape:n.shape==="sphere"?"sphere":"box"
  };
 }
 _cloneData(){return new Map([...this.nodes].map(([id,n])=>[id,{...n,translation:n.translation.slice(),rotation:n.rotation.slice(),scale:n.scale.slice()}]));}
 _restoreData(map){
  this.nodes=new Map([...map].map(([id,n])=>[id,{...n,translation:n.translation.slice(),rotation:n.rotation.slice(),scale:n.scale.slice()}]));
 }
 serialize(){return {nodes:[...this.nodes.values()].map(n=>({...n,translation:n.translation.slice(),rotation:n.rotation.slice(),scale:n.scale.slice()}))};}
 toJSON(){return this.serialize();}

 validateScene(scene){
  const errors=[];
  if(!scene||typeof scene!=="object"||!Array.isArray(scene.nodes)){errors.push("场景必须包含 nodes 数组");return errors;}
  const ids=new Set();
  for(const raw of scene.nodes){
   const n=this._defaultNode(raw);
   if(!n.id)errors.push("存在没有 id 的对象");
   else if(ids.has(n.id))errors.push(`重复 id: ${n.id}`);
   ids.add(n.id);
  }
  return errors;
 }

 loadScene(scene,opts={}){
  const errors=this.validateScene(scene);
  if(errors.length){
   this.lastResult={ok:false,affectedIds:[],changedWorldIds:[],recalculatedIds:[],errors,warnings:[]};
   return false;
  }
  if(opts.snapshot!==false)this._pushHistory();
  this.nodes=new Map(scene.nodes.map(n=>{const x=this._defaultNode(n);return [x.id,x];}));
  this.future=[];
  this._rebuildAll();
  this.version++;
  const initIds=[...this.nodes.keys()];
  this.lastResult={ok:true,label:"加载场景",affectedIds:initIds,changedWorldIds:initIds,
   recalculatedIds:initIds,errors:[],warnings:this._allWarnings()};
  return true;
 }

 _allWarnings(){
  const w=[];for(const s of this.states.values())for(const i of s.issues)if(i.severity==="warning")w.push(`${s.id}: ${i.message}`);
  return w;
 }

 _resolveStructure(dirtyIds=null,includeStructural=true){
  const ids=[...this.nodes.keys()], dirty=dirtyIds instanceof Set?dirtyIds:new Set(ids);
  const indegree=new Map(),children=new Map(),order=[];
  for(const id of ids){indegree.set(id,0);children.set(id,[]);}
  for(const id of ids){
   const p=this.nodes.get(id).parent;
   if(p!=null&&this.nodes.has(p)){indegree.set(id,indegree.get(id)+1);children.get(p).push(id);}
  }
  const q=ids.filter(id=>indegree.get(id)===0);
  while(q.length){
   const id=q.shift(),n=this.nodes.get(id);order.push(id);
   for(const c of children.get(id)){
    const d=indegree.get(c)-1;indegree.set(c,d);
    if(d===0)q.push(c);
   }
  }
  const unresolved=new Set(order.length===ids.length?[]:ids.filter(id=>indegree.get(id)>0));
  const affected=dirtyIds instanceof Set
   ? this._structuralAffected(dirty,unresolved,children,includeStructural)
   : new Set(ids);
  for(const id of affected){
   if(!this.states.has(id))this.states.set(id,this._blankState(id));
   this.states.get(id).structureIssue=null;
  }
  for(const id of affected){
   const n=this.nodes.get(id),p=n.parent;
   const s=this.states.get(id)||this._blankState(id);this.states.set(id,s);
  if(p==null){s.structureIssue=null;s.parentId=null;}
  else if(!this.nodes.has(p)){s.structureIssue={code:ISSUE.MISSING_PARENT,severity:"error",message:`父级 “${p}” 不存在或已删除`};s.parentId=null;}
   else if(unresolved.has(id)){
    const seen=new Set();let cur=id,cycleEntry=null;
    while(cur!=null&&this.nodes.has(cur)){
     if(seen.has(cur)){cycleEntry=cur;break;}
     seen.add(cur);cur=this.nodes.get(cur).parent;
    }
    if(cycleEntry===id){s.structureIssue={code:ISSUE.CYCLE,severity:"error",message:"对象参与了父子环"};s.parentId=null;}
    else {s.structureIssue={code:ISSUE.CYCLE_DESCENDANT,severity:"error",message:"祖先路径包含父子环"};s.parentId=null;}
   }
  else {
    s.parentId=p;
   }
  }
  return {order,children,unresolved,dirty:affected};
  }
  _structuralAffected(roots,unresolved,children,includeStructural=true){
  const affected=new Set(roots);
  this._subtreeIds(roots,children,affected);
  if(includeStructural){
   for(const [id,s] of this.states)if(s.structureIssue)affected.add(id);
   for(const id of unresolved)affected.add(id);
  }
   let grew=true,passes=0;
   while(grew&&passes++<20){
    grew=false;
    for(const n of this.nodes.values()){
     if(n.parent!=null&&affected.has(n.parent)&&!affected.has(n.id)){affected.add(n.id);grew=true;}
    }
   }
   return affected;
  }

 _blankState(id){
  return {id,parentId:null,structureIssue:null,world:null,localAffine:null,
   position:null,euler:null,worldScale:null,rotation:null,det:1,mirrorCount:0,
   issues:[],trusted:{position:false,orientation:false,scale:false}};
 }

 _makeIssues(s){
  const issues=[];
  if(s.structureIssue)issues.push(s.structureIssue);
  if(!s.structureIssue&&s.localInvalid)issues.push({code:ISSUE.INVALID_LOCAL,severity:"error",message:"局部 T/R/S 包含非法数值或零缩放"});
  if(s.parentUnresolved)issues.push({code:ISSUE.MISSING_PARENT,severity:"error",message:"无法经过完整父子链求解"});
  if(s.world){
   if(s.analysis.singular)issues.push({code:ISSUE.SINGULAR,severity:"error",message:"世界变换奇异：缩放为零或矩阵不可逆"});
   if(!s.analysis.singular&&s.analysis.shear)issues.push({code:ISSUE.SHEAR,severity:"error",message:"非均匀缩放与旋转混合产生剪切，无法可信分解为位置/朝向/缩放"});
   if(s.mirrorCount)issues.push({code:ISSUE.MIRROR,severity:"warning",message:`检测到镜像（负缩放累计 ${s.mirrorCount} 个轴）；显示采用规范轴向，原矩阵仍保留`});
  }
  s.issues=issues;
  s.trusted={
   position:!!s.world&&!s.structureIssue&&!s.localInvalid&&!s.parentUnresolved,
   orientation:!!s.world&&!s.analysis.singular&&!s.analysis.shear&&!s.structureIssue&&!s.localInvalid&&!s.parentUnresolved,
   scale:!!s.world&&!s.analysis.singular&&!s.analysis.shear&&!s.structureIssue&&!s.localInvalid&&!s.parentUnresolved
  };
 }

 _subtreeIds(roots,children,out=new Set()){
  const stack=[...roots];
  while(stack.length){
   const id=stack.pop();
   if(out.has(id)||!this.nodes.has(id))continue;
   out.add(id);
   for(const c of children.get(id)||[])stack.push(c);
  }
  return out;
 }

 _rebuildAll(){
  this.states=new Map();
  for(const id of this.nodes.keys())this.states.set(id,this._blankState(id));
  const {order,children}=this._resolveStructure(null);
  this.order=order;
  for(const id of this.nodes.keys())this._computeNode(id,children);
 }

 _recomputeDirty(roots,includeStructural=true){
  const rootSet=roots instanceof Set?roots:new Set(roots);
  const {order,children}=this._resolveStructure(rootSet,includeStructural);
  this.order=order;
  const affected=this._subtreeIds(rootSet,children),recalculated=new Set(),changed=new Set();
  for(const id of order){
   if(!affected.has(id))continue;
   const before=this.states.get(id)?.world||null;
   this._computeNode(id,children);
   recalculated.add(id);
   const s=this.states.get(id);
   if(!before||!s.world||!M.affineEqual(before,s.world))changed.add(id);
  }
  // Kahn order excludes cycles and their descendants; structure resolution has
  // already assigned their structural state, so compute them separately.
  for(const id of affected){
   if(recalculated.has(id))continue;
   const before=this.states.get(id)?.world||null;
   this._computeNode(id,children);
   recalculated.add(id);
   const s=this.states.get(id);
   if(!before||!s.world||!M.affineEqual(before,s.world))changed.add(id);
  }
  return {affected:[...affected],recalculatedIds:[...recalculated],changedWorldIds:[...changed],children};
 }

 _computeNode(id,children){
  const n=this.nodes.get(id);
  let s=this.states.get(id);
  if(!s){s=this._blankState(id);this.states.set(id,s);}
  s.id=id;s.parentId=n.parent;
  const valid=M.localTrsValid(n);
  s.localInvalid=!valid;
  s.parentUnresolved=false;
  if(s.structureIssue||s.localInvalid){
   s.localAffine=valid?M.composeTRS(n):null;s.world=null;s.position=null;s.euler=null;
   s.worldScale=null;s.rotation=null;s.det=1;s.mirrorCount=0;s.analysis={singular:true,shear:false};
   this._makeIssues(s);return s;
  }
  const local=M.composeTRS(n);s.localAffine=local;
  const ps=n.parent==null?null:this.states.get(n.parent);
  if(n.parent!=null&&(!ps||ps.structureIssue||ps.localInvalid||ps.parentUnresolved||!ps.world)){
   s.parentUnresolved=true;s.world=null;s.position=null;s.euler=null;s.worldScale=null;s.rotation=null;
   s.analysis={singular:true,shear:false};
   this._makeIssues(s);return s;
  }
  const parentWorld=ps?ps.world:{linear:M.identity(),translation:[0,0,0]};
  const world=M.composeAffine(parentWorld,local);
  const analysis=M.analyzeLinear(world.linear),dec=M.decomposeLinear(world.linear);
  s.world=world;s.analysis=analysis;s.det=analysis.det;
  s.mirrorCount=(ps?ps.mirrorCount:0)+n.scale.filter(x=>x<0).length;
  if(dec.ok){
   s.position=world.translation.slice();s.rotation=dec.rotation;s.euler=dec.euler;s.worldScale=dec.scale;
  }else{
   s.position=world.translation.slice();s.rotation=null;s.euler=null;s.worldScale=null;
  }
  this._makeIssues(s);
  return s;
 }

 getNode(id){return this.nodes.get(id)?{...this.nodes.get(id)}:null;}
 getState(id){return this.states.get(id)?JSON.parse(JSON.stringify(this.states.get(id))):null;}
getTree(){const children=new Map([...this.nodes.keys()].map(id=>[id,this._directChildren(id)]));return this.order.map(id=>({node:this.getNode(id),state:this.getState(id),children:children.get(id).slice()}));}
descendants(id){
 const out=[id],seen=new Set([id]),stack=[id];
 while(stack.length){
  for(const c of this._directChildren(stack.pop())){
   if(seen.has(c))continue;
   seen.add(c);out.push(c);stack.push(c);
  }
 }
 return out;
}
_directChildren(id){return [...this.nodes.values()].filter(n=>n.parent===id).map(n=>n.id);}
 isAncestor(maybeAncestor,id){return this.descendants(maybeAncestor).includes(id);}
 canReparent(id,parentId){
  if(id===parentId)return false;
  if(parentId!=null&&!this.nodes.has(parentId))return false;
  if(parentId!=null&&this.isAncestor(id,parentId))return false;
  return true;
 }

 _pushHistory(label){
  this.history.push({label:label||"编辑",data:this._cloneData()});
  if(this.history.length>100)this.history.shift();
  this.future=[];
 }
 canUndo(){return this.history.length>0;}
 canRedo(){return this.future.length>0;}
 undo(){
  const h=this.history.pop();if(!h)return false;
  this.future.push({label:h.label,data:this._cloneData()});
  this._restoreData(h.data);this._rebuildAll();this.version++;
  this.lastResult={ok:true,affectedIds:[...this.nodes.keys()],changedWorldIds:[...this.nodes.keys()],
   recalculatedIds:[...this.nodes.keys()],errors:[],warnings:this._allWarnings(),label:`撤销: ${h.label}`};
  return true;
 }
 redo(){
  const f=this.future.pop();if(!f)return false;
  this.history.push({label:f.label,data:this._cloneData()});
  this._restoreData(f.data);this._rebuildAll();this.version++;
  this.lastResult={ok:true,affectedIds:[...this.nodes.keys()],changedWorldIds:[...this.nodes.keys()],
   recalculatedIds:[...this.nodes.keys()],errors:[],warnings:this._allWarnings(),label:`重做: ${f.label}`};
  return true;
 }

 _commit(label,roots,extra={}){
  const r=this._recomputeDirty(roots,extra.includeStructural!==false);
  this.version++;
  const errors=[];for(const id of r.affected){const st=this.states.get(id);for(const i of st.issues)if(i.severity==="error")errors.push({id,...i});}
  this.lastResult={ok:true,label,affectedIds:r.affected,changedWorldIds:r.changedWorldIds,
   recalculatedIds:r.recalculatedIds,errors,warnings:this._allWarnings(),...extra};
  return this.lastResult;
 }

 _fail(messages,extra={}){
  const errors=Array.isArray(messages)?messages:[messages];
  this.lastResult={ok:false,affectedIds:[],changedWorldIds:[],recalculatedIds:[],errors,warnings:this._allWarnings(),...extra};
  return this.lastResult;
 }

 addNode(node,parentId=node&&node.parent){
  const n=this._defaultNode(node);
  if(!n.id)n.id=`obj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
  if(this.nodes.has(n.id))return this._fail(`id 已存在: ${n.id}`);
  if(!M.localTrsValid(n))return this._fail("新对象的局部变换非法");
  if(parentId!=null){
   if(!this.nodes.has(parentId))return this._fail(`父级不存在: ${parentId}`);
   const ps=this.states.get(parentId);
   if(!ps.world||ps.analysis.singular||ps.analysis.shear)return this._fail("父级当前不可信：新对象需要可逆且无剪切的父级世界变换");
   n.parent=parentId;
  }else n.parent=null;
  this._pushHistory(`添加 ${n.name}`);
  this.nodes.set(n.id,n);
  return this._commit("添加对象",[n.id]);
 }

 deleteNode(id,opts={}){
  const n=this.nodes.get(id);if(!n)return this._fail("对象不存在");
  const ids=this.descendants(id);
  const locked=ids.filter(x=>this.nodes.get(x).locked);
  if(locked.length&&!opts.force)return this._fail(`拒绝删除：子树包含锁定对象 ${locked.join(", ")}`);
  const before=this._cloneData();this._pushHistory(`删除 ${n.name}`);
  for(const x of ids){this.nodes.delete(x);this.states.delete(x);}
  const referrers=[...this.nodes.values()].filter(x=>ids.includes(x.parent)).map(x=>x.id);
  for(const rid of referrers)this.nodes.get(rid).parent=null;
  return this._commit("删除对象",new Set(referrers));
 }

 _mergePatch(n,patch){
  const x={...n};
  if(patch.name!==undefined)x.name=String(patch.name);
  if(patch.color!==undefined)x.color=String(patch.color);
  if(patch.shape!==undefined)x.shape=patch.shape;
  for(const k of ["translation","rotation","scale"]){
   if(patch[k]!==undefined){
    if(!Array.isArray(patch[k])||patch[k].length!==3||!patch[k].every(Number.isFinite))return {error:`${k} 必须是 3 个有限数`};
    x[k]=patch[k].map(Number);
   }
  }
  return {value:x};
 }

 updateNode(id,patch={},opts={}){
  const n=this.nodes.get(id);if(!n)return this._fail("对象不存在");
  const merged=this._mergePatch(n,patch);
  if(merged.error)return this._fail(merged.error);
  const transformChanged=["translation","rotation","scale"].some(k=>patch[k]!==undefined);
  if(transformChanged&&n.locked&&!opts.force)return this._fail(`对象 ${n.name} 已锁定最终姿态；请先解锁，或调整其可动祖先/后代`);
  if(transformChanged&&!M.localTrsValid(merged.value))return this._fail("局部变换包含非法数值或零缩放");
  if(!transformChanged){
   this.nodes.set(id,merged.value);this.version++;
   return {ok:true,affectedIds:[id],changedWorldIds:[],recalculatedIds:[],errors:[],warnings:this._allWarnings(),label:"修改对象属性"};
  }
  const oldData=this._cloneData(),oldWorlds=new Map();
  for(const x of this.nodes.keys()){const w=this.states.get(x)?.world;oldWorlds.set(x,w?JSON.parse(JSON.stringify(w)):null);}
  if(opts.history!==false)this._pushHistory(opts.label||`调整 ${n.name}`);
  this.nodes.set(id,merged.value);
  const first=this._recomputeDirty([id],false);
  const locks=first.affected.filter(x=>x!==id&&this.nodes.get(x).locked);
  const candidates=new Map();
  for(const lockId of locks){
   let p=this.nodes.get(lockId).parent,candidate=null;
   while(p&&p!==id){
    if(!this.nodes.get(p).locked){candidate=p;break;}
    p=this.nodes.get(p).parent;
   }
   if(!candidate){this._restoreData(oldData);this._rebuildAll();return this._fail(`锁定链 ${lockId} 与 ${id} 之间没有可动补偿对象，操作已回滚`);}
   candidates.set(candidate,lockId);
  }
  for(const [c,lockId] of [...candidates]){
   const covered=[...candidates.keys()].some(other=>other!==c&&this.descendants(other).includes(c)&&this.descendants(other).includes(lockId));
   if(covered)candidates.delete(c);
  }
  const compensations=[];
  for(const candidateId of candidates.keys()){
   const parentId=this.nodes.get(candidateId).parent;
   const parentWorld=parentId==null?{linear:M.identity(),translation:[0,0,0]}:this.states.get(parentId).world;
   const desired=oldWorlds.get(candidateId);
   if(!parentWorld||!desired)return this._rollbackLock(oldData,"锁定补偿缺少可逆父级或旧姿态",opts.history!==false);
   const local=M.relativeAffine(parentWorld,desired),dec=M.decomposeLinear(local.linear);
    if(!dec.ok||!M.localTrsValid({translation:local.translation,scale:dec.scale}))
    return this._rollbackLock(oldData,`锁定补偿会让 ${candidateId} 产生${dec.reason==="shear"?"剪切":"奇异"}局部变换，操作已回滚`,opts.history!==false);
   const c=this.nodes.get(candidateId);
   c.translation=local.translation;c.rotation=dec.euler;c.scale=dec.scale;
   compensations.push(candidateId);
  }
  const roots=new Set([id,...compensations]);
  const result=this._commit(opts.label||`调整 ${n.name}`,roots,{includeStructural:false,compensatedLockIds:locks,compensatorIds:compensations});
  for(const lockId of locks){
   const now=this.states.get(lockId)?.world,old=oldWorlds.get(lockId);
   if(!now||!old||!M.affineEqual(now,old,1e-6))return this._rollbackLock(oldData,"锁定姿态数值校验失败，操作已回滚",opts.history!==false);
  }
  return result;
 }

 _rollbackLock(data,message,dropHistory=false){
  if(dropHistory)this.history.pop();
  this._restoreData(data);this._rebuildAll();this.version++;
  return this._fail(message);
 }

 changeParent(id,parentId,opts={}){
  const n=this.nodes.get(id);
  if(!n)return this._fail("对象不存在");
  parentId=parentId==null||parentId===""?null:String(parentId);
  if(id===parentId)return this._fail("对象不能成为自己的父级");
  if(parentId!=null&&!this.nodes.has(parentId))return this._fail(`新父级不存在: ${parentId}`);
  if(parentId!=null&&this.isAncestor(id,parentId))return this._fail("不能把对象移动到自己的后代下，这会形成父子环");
  if(n.parent===parentId)return {ok:true,affectedIds:[],changedWorldIds:[],recalculatedIds:[],errors:[],warnings:[],label:"父级未变化"};
  const oldData=this._cloneData();
  const oldWorld=this.states.get(id).world;
  if(!oldWorld)return this._fail("对象当前世界姿态不可解，不能在保持姿态时重挂父级");
  const parentNode=parentId==null?null:this.nodes.get(parentId);
  const parentState=parentId==null?null:this.states.get(parentId);
  if(parentId!=null&&(!parentState.world||parentState.analysis.singular||parentState.analysis.shear))
   return this._fail("新父级不可信：需要可逆且无剪切的世界变换才能计算保持姿态的局部 TRS");
  const parentWorld=parentId==null?{linear:M.identity(),translation:[0,0,0]}:parentState.world;
  const local=M.relativeAffine(parentWorld,oldWorld),dec=M.decomposeLinear(local.linear);
  if(!dec.ok)return this._fail(`保持世界姿态需要在 ${n.name} 上引入${dec.reason==="shear"?"剪切":"奇异"}局部变换，已拒绝`);
  this._pushHistory(opts.label||`重挂 ${n.name}`);
  n.parent=parentId;n.translation=local.translation;n.rotation=dec.euler;n.scale=dec.scale;
  const result=this._commit("修改父子关系",[id],{preservedWorld:true});
  const now=this.states.get(id).world;
  if(!M.affineEqual(oldWorld,now,1e-6)){
   this._restoreData(oldData);this._rebuildAll();
   return this._fail("重挂后世界姿态校验失败，操作已回滚");
  }
  return result;
 }

 setLocked(id,locked,reason=""){
  const n=this.nodes.get(id);if(!n)return this._fail("对象不存在");
  if(!!n.locked===!!locked)return {ok:true,affectedIds:[],changedWorldIds:[],recalculatedIds:[],errors:[],warnings:[],label:"锁定状态未变化"};
  const s=this.states.get(id);
  if(locked&&(!s||!s.world||s.structureIssue||s.localInvalid||s.parentUnresolved||s.analysis.singular))
   return this._fail("当前对象没有可信、可逆的最终姿态，不能锁定；请先修复层级或奇异变换");
  this._pushHistory(locked?`锁定 ${n.name}`:`解锁 ${n.name}`);
  n.locked=!!locked;n.lockReason=reason||undefined;this.version++;
  const warnings=locked&&s.analysis.shear?[`${id}: 已锁定原始仿射矩阵；因存在剪切，位置可信，朝向/缩放不可信`]:this._allWarnings();
  return {ok:true,affectedIds:[id],changedWorldIds:[],recalculatedIds:[],errors:[],warnings,label:locked?"锁定最终姿态":"解除锁定"};
 }

  setNodeName(id,name){return this.updateNode(id,{name},{label:"重命名"});}

  repairParent(id,parentId){
   const n=this.nodes.get(id);
   if(!n)return this._fail("对象不存在");
   parentId=parentId==null||parentId===""?null:String(parentId);
   if(id===parentId)return this._fail("对象不能成为自己的父级");
   if(parentId!=null&&!this.nodes.has(parentId))return this._fail("目标父级不存在");
   if(parentId!=null&&this.isAncestor(id,parentId))return this._fail("目标父级位于该对象子树中，会形成环");
   if(n.parent===parentId)return {ok:true,affectedIds:[],changedWorldIds:[],recalculatedIds:[],errors:[],warnings:[],label:"父级未变化"};
   this._pushHistory(`修复 ${n.name} 父级`);
   n.parent=parentId;
   return this._commit("修复父子关系",[id]);
  }

  beginInteraction(label){
   return {label:label||"交互调整",data:this._cloneData()};
  }
  commitInteraction(session,roots){
   const result=this._commit(session.label,roots);
   this.history.push({label:session.label,data:session.data});
   if(this.history.length>100)this.history.shift();
   this.future=[];
   return result;
  }
  cancelInteraction(session){
   this._restoreData(session.data);this._rebuildAll();this.version++;
  }

 debugFullRecompute(){
  const saved=new Map();
  for(const [id,s] of this.states)saved.set(id,JSON.stringify({world:s.world,issues:s.issues,trusted:s.trusted}));
  this._rebuildAll();
  const mismatch=[];
  for(const [id,raw] of saved){
   const old=JSON.parse(raw),cur=this.states.get(id);
   const sameWorld=(!old.world&&!cur.world)||(old.world&&cur.world&&M.affineEqual(old.world,cur.world,1e-7));
   const oldCodes=old.issues.map(x=>x.code).sort().join(",");
   const curCodes=cur.issues.map(x=>x.code).sort().join(",");
   if(!sameWorld||oldCodes!==curCodes)mismatch.push(id);
  }
  return {mismatch};
 }
}

TransformEngine.ISSUE=ISSUE;
return TransformEngine;
});
