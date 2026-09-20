import {spawn} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import assert from "node:assert/strict";

const chrome=process.env.CHROME||"C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile=await mkdtemp(join(tmpdir(),"transform-lab-"));
const url=new URL("../index.html",import.meta.url).href;
const child=spawn(chrome,[
 "--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check",
 "--remote-debugging-port=9223",`--user-data-dir=${profile}`,"about:blank"
],{stdio:["ignore","pipe","pipe"]});
let stderr="";child.stderr.on("data",d=>stderr+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getJson(path){return (await fetch(`http://127.0.0.1:9223${path}`)).json();}
for(let i=0;i<50;i++){try{await getJson("/json/version");break;}catch{await sleep(100);}}
const tabs=await getJson("/json/list");
const tab=tabs.find(t=>t.type==="page");
const ws=new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
let id=0;const pending=new Map();
ws.onmessage=e=>{
 const msg=JSON.parse(e.data);
 if(msg.id&&pending.has(msg.id)){pending.get(msg.id)(msg);pending.delete(msg.id);}
};
function send(method,params={}){
 const mid=++id;
 ws.send(JSON.stringify({id:mid,method,params}));
 return new Promise(resolve=>pending.set(mid,resolve));
}
const errors=[];
send("Runtime.enable");send("Page.enable");
ws.addEventListener("message",e=>{
 const m=JSON.parse(e.data);
 if(m.method==="Runtime.exceptionThrown")errors.push(m.params.exceptionDetails.text);
});
await send("Page.navigate",{url});
await sleep(700);
async function evalJs(expression){
 const r=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
 if(r.result.exceptionDetails)throw new Error(JSON.stringify(r.result.exceptionDetails));
 return r.result.result.value;
}
try{
 const initialRows=await evalJs("document.querySelectorAll('.tree-row').length");
 assert.equal(initialRows,12);
 assert.ok((await evalJs("document.getElementById('summary').textContent")).includes("不可信"));
 await evalJs("document.getElementById('btnAdd').click()");
 await sleep(100);
 assert.equal(await evalJs("document.querySelectorAll('.tree-row').length"),13);
 const payload=await evalJs(`
  selectedId='arm'; renderAll();
  ({ok:(r=engine.updateNode('arm',{rotation:[25,35,10]}),r.ok),text:(renderAll(),document.getElementById('solverStatus').textContent)})
  `);
 if(!payload.ok)throw new Error("lock compensation failed");
 assert.equal(payload.ok,true);
 assert.match(payload.text,/锁定补偿节点/);
 assert.match(payload.text,/wrist/);
 assert.deepEqual(errors,[]);
 console.log("browser smoke passed");
}finally{
 child.kill();
 await sleep(300);
 await rm(profile,{recursive:true,force:true}).catch(()=>{});
 ws.close();
}
