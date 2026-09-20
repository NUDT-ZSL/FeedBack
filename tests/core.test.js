const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../src/math.js");
const Core = require("../src/core.js");

function scene(){
 return {nodes:[
  {id:"a",translation:[0,0,0],scale:[1,1,1]},
  {id:"b",parent:"a",translation:[1,0,0],rotation:[0,0,90],scale:[1,1,1]},
  {id:"c",parent:"b",translation:[0,1,0],scale:[1,1,1]},
  {id:"d",parent:"a",translation:[5,0,0],scale:[1,1,1]},
  {id:"e",translation:[9,0,0],scale:[1,1,1]}
 ]};
}
function state(e,id){return e.getState(id);}

test("逐级合成基础旋转",()=>{
 const e=new Core(scene());
 assert.ok(M.affineEqual(state(e,"c").world,{linear:[[0,-1,0],[1,0,0],[0,0,1]],translation:[0,0,0]},1e-9));
});

test("增量结果与同操作全新求解一致，且只重算子树",()=>{
 const inc=new Core(scene());
 inc.updateNode("a",{rotation:[10,20,30]});
 assert.deepEqual(inc.lastResult.recalculatedIds.sort(),["a","b","c","d"]);
 const fresh=new Core(scene());
 fresh.nodes.get("a").rotation=[10,20,30];fresh._rebuildAll();
 for(const id of ["a","b","c","d"])assert.ok(M.affineEqual(state(inc,id).world,state(fresh,id).world,1e-9));
 assert.deepEqual(inc.debugFullRecompute().mismatch,[]);
});

test("普通变换不会重算无关的缺失/成环对象",()=>{
 const e=new Core({nodes:[
  {id:"a"},{id:"b",parent:"a"},
  {id:"broken",parent:"missing"},{id:"p",parent:"q"},{id:"q",parent:"p"}
 ]});
 e.updateNode("a",{translation:[1,0,0]},{force:true});
 assert.deepEqual(e.lastResult.recalculatedIds.sort(),["a","b"]);
});

test("锁定后代时通过最近可动补偿节点保持世界姿态",()=>{
 const e=new Core(scene());
 assert.equal(e.setLocked("c",true).ok,true);
 const locked=JSON.parse(JSON.stringify(state(e,"c").world));
 const outside=JSON.parse(JSON.stringify(state(e,"e").world));
 const r=e.updateNode("a",{rotation:[0,35,0],translation:[0.2,0,0]});
 assert.equal(r.ok,true);
 assert.ok(r.compensatorIds.includes("b"));
 assert.ok(M.affineEqual(state(e,"c").world,locked,1e-6));
 assert.ok(M.affineEqual(state(e,"e").world,outside,1e-9));
 assert.ok(!M.affineEqual(state(e,"b").world,locked,1e-6));
});

test("目标与锁之间没有可动对象时拒绝并回滚",()=>{
 const e=new Core(scene());
 e.setLocked("b",true);
 const before=JSON.stringify(e.serialize());
 const r=e.updateNode("a",{rotation:[1,2,3]});
 assert.equal(r.ok,false);
 assert.equal(JSON.stringify(e.serialize()),before);
});

test("非均匀缩放父级叠加子级旋转被标为剪切且姿态不可信",()=>{
 const e=new Core(scene());
 e.updateNode("a",{scale:[2,0.5,1],rotation:[0,0,30]},{force:true});
 e.updateNode("b",{rotation:[45,0,0]});
 const s=state(e,"b");
 assert.ok(s.issues.some(x=>x.code==="shear"));
 assert.equal(s.trusted.orientation,false);
 assert.equal(s.trusted.scale,false);
 assert.equal(s.trusted.position,true);
});

test("镜像显式警告但不丢失原始矩阵",()=>{
 const e=new Core(scene());
 e.updateNode("a",{scale:[-1,1,1]},{force:true});
 const s=state(e,"b");
 assert.ok(s.issues.some(x=>x.code==="mirror"&&x.severity==="warning"));
 assert.equal(s.trusted.orientation,true);
 assert.ok(s.det<0);
});

test("导入零缩放会被标为奇异/非法而不是静默正常",()=>{
 const e=new Core({nodes:[{id:"z",scale:[1,0,1]}]});
 const s=state(e,"z");
 assert.ok(s.issues.some(x=>x.code==="singular"||x.code==="invalid-local"));
 assert.equal(s.trusted.orientation,false);
});

test("缺失父级和父子环被标记",()=>{
 const bad={nodes:[{id:"x",parent:"missing"},{id:"p",parent:"q"},{id:"q",parent:"p"},{id:"z",parent:"p"}]};
 const e=new Core(bad);
 assert.equal(state(e,"x").issues.some(i=>i.code==="missing-parent"),true);
 assert.equal(state(e,"p").issues.some(i=>i.code==="cycle"),true);
 assert.equal(state(e,"q").issues.some(i=>i.code==="cycle"),true);
 assert.equal(state(e,"z").issues.some(i=>i.code==="cycle-descendant"),true);
});

test("重挂父级保持世界变换",()=>{
 const e=new Core(scene());
 e.updateNode("a",{rotation:[12,25,-9]},{force:true});
 const old=JSON.parse(JSON.stringify(state(e,"c").world));
 const r=e.changeParent("c","d");
 assert.equal(r.ok,true);
 assert.ok(M.affineEqual(state(e,"c").world,old,1e-6));
});

test("撤销恢复受影响对象并同步锁和警告",()=>{
 const e=new Core(scene());
  const old=JSON.stringify(state(e,"b").world);
 e.updateNode("b",{translation:[2,3,4]});
 assert.equal(e.undo(),true);
 assert.equal(JSON.stringify(state(e,"b").world),old);
 assert.equal(e.canRedo(),true);
});

test("剪切结论向后代传播但位置仍可解",()=>{
 const e=new Core(scene());
 e.updateNode("a",{scale:[2,.5,1],rotation:[0,0,30]},{force:true});
 e.updateNode("b",{rotation:[45,0,0]});
 const c=state(e,"c");
 assert.ok(c.issues.some(x=>x.code==="shear"));
 assert.equal(c.trusted.position,true);
 assert.equal(c.trusted.orientation,false);
 assert.equal(c.trusted.scale,false);
});

test("单一可动中间节点可以补偿锁定",()=>{
 const e=new Core(scene());
 e.setLocked("c",true);
 const locked=JSON.parse(JSON.stringify(state(e,"c").world));
 const r=e.updateNode("a",{rotation:[15,0,-20],translation:[.4,.2,.1]});
 assert.equal(r.ok,true);
 assert.deepEqual(r.compensatorIds,["b"]);
 assert.ok(M.affineEqual(state(e,"c").world,locked,1e-6));
});

test("修复缺失父级后增量清除不可信标记",()=>{
 const e=new Core({nodes:[{id:"x",parent:"p"},{id:"p"}]});
 assert.equal(state(e,"x").trusted.position,false);
 const r=e.repairParent("x",null);
 assert.equal(r.ok,true);
 assert.equal(state(e,"x").issues.length,0);
 assert.equal(state(e,"x").trusted.position,true);
});

test("修复父子环后环上对象和环外后代同步恢复",()=>{
 const e=new Core({nodes:[
  {id:"p",parent:"q"},{id:"q",parent:"p"},{id:"z",parent:"p"},{id:"root"}
 ]});
 assert.ok(state(e,"p").issues.some(i=>i.code==="cycle"));
 assert.ok(state(e,"z").issues.some(i=>i.code==="cycle-descendant"));
 const r=e.repairParent("p","root");
 assert.equal(r.ok,true);
 assert.equal(state(e,"p").issues.length,0);
 assert.equal(state(e,"q").issues.length,0);
 assert.equal(state(e,"z").issues.length,0);
});

test("锁定节点重挂后姿态和锁定状态都保持",()=>{
 const e=new Core(scene());
 e.setLocked("c",true);
 const locked=JSON.parse(JSON.stringify(state(e,"c").world));
 const r=e.changeParent("c","e");
 assert.equal(r.ok,true);
 assert.equal(nodeData(e,"c").locked,true);
 assert.ok(M.affineEqual(state(e,"c").world,locked,1e-6));
});

function nodeData(e,id){return e.getNode(id);}
