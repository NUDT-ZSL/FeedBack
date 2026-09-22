const fs = require("fs");
const html = fs.readFileSync("index.html", "utf8");
const m = html.match(/<script>([\s\S]*)<\/script>/);
if(!m){ console.error("no script block"); process.exit(1); }

// ---- DOM / storage stubs ----
const elems = {};
function fakeEl(){ return {innerHTML:"", textContent:"", className:"", value:"", style:{}, dataset:{},
  addEventListener(){}, }; }
global.document = { getElementById:id=> elems[id] || (elems[id]=fakeEl()) };
global.localStorage = { _d:{}, getItem(k){return this._d[k]||null;}, setItem(k,v){this._d[k]=v;} };
global.prompt = ()=>null;

(0,eval)(m[1].replace('"use strict";', "") +
  ";globalThis.__T={get state(){return state;},set state(v){state=v;}," +
  "get cache(){return cache;},get consistency(){return consistency;}," +
  "detectConflicts,activeObs,authoritativeObs,recomputeAffected,recomputeAll,compare,lockShift,varById};");
const T = globalThis.__T;

let fail = 0;
function ok(cond, name){ console.log((cond?"PASS":"FAIL")+" "+name); if(!cond) fail++; }

// 1. seed loads, conflicts detected (segA has 2 active sources; shared segments exist)
const c0 = T.detectConflicts();
ok(c0.some(c=>c.type==="multi-source" && c.segId==="segA" && !c.resolved), "multi-source conflict on segA");
ok(c0.some(c=>c.type==="shared"), "shared segment conflict flagged");

// 2. adjudicate segA -> only affected variants recomputed, equals full recompute
const obs = T.state.observations.find(o=>o.segmentId==="segA");
T.activeObs("segA").forEach(x=>x.authoritative=false);
obs.authoritative = true;
T.recomputeAffected(["segA"], "test");
ok(T.consistency.ok, "incremental == full after adjudication");
ok(T.consistency.affected.slice().sort().join()===["vA","vB","vC"].slice().sort().join(), "affected set = variants covering segA");

// 3. compare: vB vs vA should produce a verdict with confidence
const r1 = T.compare("vA","vB");
ok(r1.zt && r1.conf!=null, "z-test produced for vA vs vB");
ok(r1.issues.length===0, "vA vs vB has no blocking issues (same defs, overlapping windows)");

// 4. vC includes segC (non-overlapping window, different defs)
const r2 = T.compare("vA","vC");
const kinds = r2.issues.map(i=>i.kind);
ok(kinds.includes("时段不重叠"), "non-overlapping window detected");
ok(kinds.includes("分组口径不一致"), "definition mismatch detected");
ok(r2.verdict==="na", "vC not judgeable");

// 4b. narrow vC to only the tiny segC -> insufficient sample
T.varById("vC").segmentIds = ["segC"];
T.recomputeAffected(["segC"], "narrow");
const r2b = T.compare("vA","vC");
ok(r2b.issues.some(i=>i.kind==="样本量不足"), "insufficient sample detected");
ok(T.consistency.ok, "consistent after narrowing");
T.varById("vC").segmentIds = ["segA","segC"];
T.recomputeAffected(["segA","segC"], "restore");

// 5. baseline lock: lock segB, verify consistency + shift marking
T.state.baselineSegmentId = "segB";
T.recomputeAll("lock");
ok(T.consistency.ok, "consistent after lock");
ok(T.cache["vA"].entries===2600, "locked metrics use only segB");
ok(T.cache["vC"].uncovered===true, "vC flagged uncovered under lock");
ok(T.lockShift(T.varById("vA"))!==null, "lock shift marked for vA");
T.state.baselineSegmentId = null;
T.recomputeAll("unlock");

// 6. edit observation -> incremental equals full
const o3 = T.state.observations.find(o=>o.id==="o3");
o3.conversions = 300;
T.recomputeAffected(["segB"], "edit");
ok(T.consistency.ok, "incremental == full after observation edit");
ok(T.cache["vA"].conversions === 96+300, "vA conversions updated via adjudicated obs");

// 7. void one segA source -> single active becomes authoritative automatically
obs.status="void"; obs.authoritative=false;
T.recomputeAffected(["segA"], "void");
ok(T.consistency.ok, "consistent after void");
ok(T.authoritativeObs("segA")!==null, "single remaining source auto-authoritative");

console.log(fail? ("FAILED: "+fail) : "ALL PASS");
process.exit(fail?1:0);
