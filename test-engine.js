// 引擎回归测试：node test-engine.js
// 从 index.html 提取脚本，在桩环境下验证调度引擎行为
const storeMap = {};
global.localStorage = { getItem: k => storeMap[k] ?? null, setItem: (k,v) => storeMap[k]=v };
const elStub = () => ({ innerHTML:"", textContent:"", value:"", classList:{add(){},remove(){}}, querySelectorAll:()=>[], querySelector:()=>null, onclick:null, dataset:{}, style:{} });
global.document = { getElementById: elStub, querySelectorAll: () => [] };
global.alert = ()=>{}; global.confirm = ()=>true; global.prompt = ()=>"10";
const fs = require("fs");
const html = fs.readFileSync("index.html","utf8");
const src = html.match(/<script>([\s\S]*)<\/script>/)[1].replace(/render\(\);\s*$/, "");
const body = fs.readFileSync("test.body.js","utf8");
eval(src + "\n" + body);