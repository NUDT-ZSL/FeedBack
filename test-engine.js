// 从 index.html 抽取引擎代码做单元测试(Node 环境,无 DOM)
const fs=require('fs');
const html=fs.readFileSync('index.html','utf8');
const script=html.split('<script>')[1].split('</script>')[0];

// 1) 全脚本语法检查
new Function(script.replace(/renderAll\(\);\s*$/,''));
console.log('PASS 语法检查:整段脚本可解析');

// 2) 抽取纯引擎部分(不依赖 DOM)执行
const start=script.indexOf('const SEP=');
const endAnchor='const affectedCount=';
const end=script.indexOf(endAnchor);
const lineEnd=script.indexOf('\n',end);
const engineSrc=script.slice(start,lineEnd);
const api=(new Function(engineSrc+';return {cache,cacheFor,getEval,invalidateValues,affectedCount,enumerate,evaluate,cycleInfo};'))();
const {cache,cacheFor,getEval,invalidateValues,affectedCount,enumerate,evaluate}=api;

let failed=0;
function eq(name,got,want){const ok=JSON.stringify(got)===JSON.stringify(want);
 console.log((ok?'PASS':'FAIL')+' '+name+(ok?'':' -> got '+JSON.stringify(got)+' want '+JSON.stringify(want)));if(!ok)failed++;}

const c={id:'c1',name:'Button',axes:[
 {id:'a1',name:'尺寸',values:['sm','md','lg']},
 {id:'a2',name:'状态',values:['default','hover','disabled']},
 {id:'a3',name:'主题',values:['light','dark']}],
 constraints:[
  {id:'k1',type:'excludes',a:{axis:'a2',value:'disabled'},b:{axis:'a3',value:'dark'},enabled:true},
  {id:'k2',type:'requires',a:{axis:'a2',value:'hover'},b:{axis:'a3',value:'light'},enabled:true}]};

eq('枚举总数',enumerate(c).length,18);
eq('普通组合有效',evaluate(c,{a1:'sm',a2:'default',a3:'light'}).verdict,'valid');
const r1=evaluate(c,{a1:'sm',a2:'disabled',a3:'dark'});
eq('互斥排除',r1.verdict,'invalid');
eq('互斥依据',r1.reasons.map(r=>r.kind),['violated']);
const r2=evaluate(c,{a1:'md',a2:'hover',a3:'dark'});
eq('依赖未满足',r2.verdict,'invalid');
eq('依赖依据',r2.reasons.map(r=>r.kind),['unmet']);
eq('依赖满足时有效',evaluate(c,{a1:'md',a2:'hover',a3:'light'}).verdict,'valid');

// 多约束同时命中:disabled+dark 且再叠一条 requires
const c2=JSON.parse(JSON.stringify(c));
c2.constraints.push({id:'k3',type:'requires',a:{axis:'a2',value:'disabled'},b:{axis:'a1',value:'lg'},enabled:true});
const r3=evaluate(c2,{a1:'sm',a2:'disabled',a3:'dark'});
eq('多条依据全部保留',r3.reasons.length,2);
eq('多条依据结论',r3.verdict,'invalid');

// 指向不存在取值 -> 不可信
const c3=JSON.parse(JSON.stringify(c));
c3.constraints.push({id:'k4',type:'excludes',a:{axis:'a2',value:'ghost'},b:{axis:'a3',value:'dark'},enabled:true});
eq('失效引用-相关组合不可信',evaluate(c3,{a1:'sm',a2:'default',a3:'dark'}).verdict,'untrusted');
eq('失效引用-无关组合不受影响',evaluate(c3,{a1:'sm',a2:'default',a3:'light'}).verdict,'valid');

// 依赖闭环 -> 不可信
const c4={id:'c4',name:'X',axes:[{id:'x',name:'甲',values:['p','q']},{id:'y',name:'乙',values:['u','v']}],constraints:[
 {id:'k5',type:'requires',a:{axis:'x',value:'p'},b:{axis:'y',value:'u'},enabled:true},
 {id:'k6',type:'requires',a:{axis:'y',value:'u'},b:{axis:'x',value:'p'},enabled:true}]};
eq('闭环-涉及组合不可信',evaluate(c4,{x:'p',y:'u'}).verdict,'untrusted');
eq('闭环-涉及单边也不可信',evaluate(c4,{x:'p',y:'v'}).verdict,'untrusted');
eq('闭环-无关组合有效',evaluate(c4,{x:'q',y:'v'}).verdict,'valid');

// 缓存与增量失效
cache.clear();
getEval(c,{a1:'sm',a2:'default',a3:'light'});
getEval(c,{a1:'sm',a2:'disabled',a3:'dark'});
eq('缓存写入',cacheFor(c).size,2);
invalidateValues(c,['dark']);
eq('只失效受影响组合',cacheFor(c).size,1);
eq('受影响计数',affectedCount(c,['dark']),9);

// 停用约束后结论收敛
const c5=JSON.parse(JSON.stringify(c));
c5.constraints[0].enabled=false;
eq('停用互斥后组合恢复有效',evaluate(c5,{a1:'sm',a2:'disabled',a3:'dark'}).verdict,'valid');

process.exit(failed?1:0);
