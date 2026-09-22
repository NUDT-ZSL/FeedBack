'use strict';
// ===== 画布渲染：地图、视野、单位、计划路径 =====
const cv=document.getElementById('map'), ctx=cv.getContext('2d');

function squadVisible(x,y){
  return S.squad.some(u=>u.hp>0&&dist(u,{x,y})<=u.vision&&losGrid(S.grid,u.x,u.y,x,y));
}

function draw(){
  ctx.clearRect(0,0,cv.width,cv.height);
  for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
    const px=x*CELL, py=y*CELL;
    ctx.fillStyle='#1a2230';
    if(x>=COLS-2) ctx.fillStyle='#17301f';            // 撤离区
    if(S.grid[y][x]===T.WALL) ctx.fillStyle='#3a4356';
    if(S.grid[y][x]===T.COVER) ctx.fillStyle='#2a3a2e';
    ctx.fillRect(px+1,py+1,CELL-2,CELL-2);
    if(S.grid[y][x]===T.COVER){
      ctx.strokeStyle='#4c6b52'; ctx.beginPath();
      ctx.moveTo(px+6,py+CELL-6); ctx.lineTo(px+CELL-6,py+6); ctx.stroke();
    }
    if(S.showVision && !squadVisible(x,y)){
      ctx.fillStyle='rgba(6,8,12,.62)';
      ctx.fillRect(px+1,py+1,CELL-2,CELL-2);
    }
  }
  // 选中角色的计划路径
  const sel=S.squad.find(u=>u.id===S.selected);
  const P=sel&&S.plans[sel.id];
  if(P&&P.current){
    ctx.strokeStyle='#ffd479'; ctx.lineWidth=2; ctx.setLineDash([5,4]);
    ctx.beginPath();
    let cx=sel.x*CELL+CELL/2, cy=sel.y*CELL+CELL/2;
    ctx.moveTo(cx,cy);
    for(const st of P.current.steps.slice(P.stepIdx))
      if(st.type==='move') for(const p of st.path)
        ctx.lineTo(p.x*CELL+CELL/2,p.y*CELL+CELL/2);
    ctx.stroke(); ctx.setLineDash([]);
  }
  // 敌人（仅可见时显示）
  for(const e of S.enemies){
    if(e.hp<=0) continue;
    if(S.showVision && !squadVisible(e.x,e.y)) continue;
    drawUnit(e,'#d65a5a','#7a2c2c');
  }
  for(const u of S.squad){
    if(u.hp<=0) continue;
    drawUnit(u, u.id===S.selected?'#ffd479':'#6fb7ff', '#274a77');
  }
}

function drawUnit(u,ring,fill){
  const cx=u.x*CELL+CELL/2, cy=u.y*CELL+CELL/2;
  ctx.beginPath(); ctx.arc(cx,cy,13,0,7);
  ctx.fillStyle=fill; ctx.fill();
  ctx.lineWidth=u.id===S.selected?3:2; ctx.strokeStyle=ring; ctx.stroke();
  ctx.fillStyle='#fff'; ctx.font='bold 12px sans-serif';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(u.id,cx,cy);
  // 生命条
  ctx.fillStyle='#222'; ctx.fillRect(cx-14,cy-21,28,4);
  ctx.fillStyle='#5fc26e'; ctx.fillRect(cx-14,cy-21,28*Math.max(0,u.hp/u.maxHp),4);
  if(u.overwatch){ ctx.fillStyle='#ffd479'; ctx.font='10px sans-serif'; ctx.fillText('监视',cx,cy+22); }
}
