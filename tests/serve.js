const http = require('http');
const fs = require('fs');
const path = require('path');
const types = {'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.json':'application/json;charset=utf-8'};
http.createServer((req,res)=>{
  const urlPath=decodeURIComponent(req.url.split('?')[0]);
  const file=path.join(process.cwd(), urlPath === '/' ? 'index.html' : urlPath);
  if(!file.startsWith(process.cwd())){res.writeHead(403);return res.end('forbidden');}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);return res.end('not found');}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});res.end(data);});
}).listen(8765,()=>console.log('http://localhost:8765/'));