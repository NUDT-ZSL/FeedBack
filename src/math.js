/* Offline 3D transform primitives. Matrices are row-major 3x3. */
(function(root, factory){
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TransformMath = factory();
})(typeof self !== "undefined" ? self : this, function(){
"use strict";
const DEG=Math.PI/180, RAD=180/Math.PI, EPS=1e-8;
const I3=[[1,0,0],[0,1,0],[0,0,1]], Z=[0,0,0];
const v=(x=0,y=0,z=0)=>[x,y,z];
const cloneV=a=>[a[0],a[1],a[2]];
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const scaleV=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
const length=a=>Math.hypot(a[0],a[1],a[2]);
function normalize(a){const n=length(a);return n?scaleV(a,1/n):[0,0,0];}
const cloneM=m=>[m[0].slice(),m[1].slice(),m[2].slice()];
const identity=()=>cloneM(I3);
const zeroMatrix=()=>[[0,0,0],[0,0,0],[0,0,0]];
function transpose(m){return [[m[0][0],m[1][0],m[2][0]],[m[0][1],m[1][1],m[2][1]],[m[0][2],m[1][2],m[2][2]]];}
function mul(a,b){
 const r=zeroMatrix();
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)
  r[i][j]=a[i][0]*b[0][j]+a[i][1]*b[1][j]+a[i][2]*b[2][j];
 return r;
}
function mulVec(m,p){
 return [m[0][0]*p[0]+m[0][1]*p[1]+m[0][2]*p[2],
  m[1][0]*p[0]+m[1][1]*p[1]+m[1][2]*p[2],
  m[2][0]*p[0]+m[2][1]*p[1]+m[2][2]*p[2]];
}
const transformPoint=(m,p,t)=>add(mulVec(m,p),t||Z);
function det3(m){
 return m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])
  -m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])
  +m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
}
function inverse(m){
 const d=det3(m);
 if(!Number.isFinite(d)||Math.abs(d)<EPS*1e-4)return null;
 const r=[[m[1][1]*m[2][2]-m[1][2]*m[2][1],m[0][2]*m[2][1]-m[0][1]*m[2][2],m[0][1]*m[1][2]-m[0][2]*m[1][1]],
  [m[1][2]*m[2][0]-m[1][0]*m[2][2],m[0][0]*m[2][2]-m[0][2]*m[2][0],m[0][2]*m[1][0]-m[0][0]*m[1][2]],
  [m[1][0]*m[2][1]-m[1][1]*m[2][0],m[0][1]*m[2][0]-m[0][0]*m[2][1],m[0][0]*m[1][1]-m[0][1]*m[1][0]]];
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)r[i][j]/=d;
 return r;
}

function eulerXYZ(e){
 const cx=Math.cos(e[0]*DEG),sx=Math.sin(e[0]*DEG);
 const cy=Math.cos(e[1]*DEG),sy=Math.sin(e[1]*DEG);
 const cz=Math.cos(e[2]*DEG),sz=Math.sin(e[2]*DEG);
 return [
  [cy*cz, sx*sy*cz-cx*sz, cx*sy*cz+sx*sz],
  [cy*sz, sx*sy*sz+cx*cz, cx*sy*sz-sx*cz],
  [-sy, sx*cy, cx*cy]
 ];
}
function rotationToEulerXYZ(r){
 const y=Math.asin(Math.min(1,Math.max(-1,-r[2][0])));
 let x,z;
 if(Math.abs(Math.cos(y))>1e-10){
  x=Math.atan2(r[2][1],r[2][2]);
  z=Math.atan2(r[1][0],r[0][0]);
 }else{
  x=Math.atan2(-r[1][2],r[1][1]);
  z=0;
 }
 return [x*RAD,y*RAD,z*RAD];
}
function composeTRS(t){
 const s=diag(t.scale&&isFinite(t.scale[0])?t.scale:[1,1,1]);
 return {linear:mul(eulerXYZ(t.rotation||[0,0,0]),s),translation:cloneV(t.translation||Z)};
}
function diag(s){return [[s[0],0,0],[0,s[1],0],[0,0,s[2]]];}
function composeAffine(parent,local){
 return {linear:mul(parent.linear,local.linear),
  translation:add(mulVec(parent.linear,local.translation),parent.translation)};
}
function inverseAffine(a){
 const lin=inverse(a.linear);
 if(!lin)return null;
 return {linear:lin,translation:scaleV(mulVec(lin,a.translation),-1)};
}
function relativeAffine(parentWorld,childWorld){
 const ip=inverseAffine(parentWorld);
 if(!ip)return null;
 return {linear:mul(ip.linear,childWorld.linear),
  translation:add(mulVec(ip.linear,childWorld.translation),ip.translation)};
}
function matrixNorm(m){
 return Math.sqrt(m[0].concat(m[1],m[2]).reduce((a,x)=>a+x*x,0));
}
function gramOffAxis(m){
 const cols=[[m[0][0],m[1][0],m[2][0]],[m[0][1],m[1][1],m[2][1]],[m[0][2],m[1][2],m[2][2]]];
 const n=Math.max(1,matrixNorm(m));
 let max=0;
 for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)max=Math.max(max,Math.abs(dot(cols[i],cols[j]))/(n*n));
 return max;
}
function analyzeLinear(m){
 const n=Math.max(1,matrixNorm(m));
 const cols=[[m[0][0],m[1][0],m[2][0]],[m[0][1],m[1][1],m[2][1]],[m[0][2],m[1][2],m[2][2]]];
 const lens=cols.map(length);
 const det=det3(m);
 const shear=gramOffAxis(m)>1e-7;
 const singular=lens.some(x=>x<EPS*n)||Math.abs(det)<EPS*n*n*n;
 let rotation=null,scale=cloneV(lens);
 if(!shear&&!singular){
  if(det<0)scale[0]=-scale[0];
  const q=zeroMatrix();
  for(let c=0;c<3;c++){
   const s=scale[c];
   for(let row=0;row<3;row++)q[row][c]=cols[c][row]/s;
  }
  rotation=q;
 }
 return {det,shear,singular,rotation,scale,columns:cols};
}

function decomposeLinear(m){
 const a=analyzeLinear(m);
 if(a.singular)return {ok:false,reason:"singular",analysis:a};
 if(a.shear)return {ok:false,reason:"shear",analysis:a};
 return {ok:true,rotation:a.rotation,euler:rotationToEulerXYZ(a.rotation),
  scale:a.scale,analysis:a};
}

function affineEqual(a,b,tol=1e-8){
 const n=Math.max(1,matrixNorm(a.linear),matrixNorm(b.linear),length(a.translation),length(b.translation));
 for(let i=0;i<3;i++){
  if(Math.abs(a.translation[i]-b.translation[i])>tol*n)return false;
  for(let j=0;j<3;j++)if(Math.abs(a.linear[i][j]-b.linear[i][j])>tol*n)return false;
 }
 return true;
}

function localTrsValid(t){
 const vals=(t.translation||[]).concat(t.rotation||[],t.scale||[]);
 return vals.every(Number.isFinite)&&(t.scale||[1,1,1]).every(x=>x!==0);
}

return {
 DEG,RAD,EPS,v,cloneV,add,sub,scaleV,dot,cross,length,normalize,
 cloneM,identity,zeroMatrix,transpose,mul,mulVec,transformPoint,
 det3,inverse,eulerXYZ,rotationToEulerXYZ,composeTRS,diag,
 composeAffine,inverseAffine,relativeAffine,matrixNorm,gramOffAxis,
 analyzeLinear,decomposeLinear,affineEqual,localTrsValid
};
});
