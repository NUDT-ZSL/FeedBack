(function(root,factory){
 if(typeof module==="object"&&module.exports)module.exports=factory();
 else root.DemoScene=factory();
})(typeof self!=="undefined"?self:this,function(){
"use strict";
return {
 name:"Transform Chain Lab",
 nodes:[
  {id:"root",name:"世界根节点",parent:null,translation:[0,0,0],rotation:[0,0,0],scale:[1,1,1],color:"#8bd17c",shape:"box"},
  {id:"arm",name:"均匀缩放机械臂",parent:"root",translation:[-1.1,0.15,0],rotation:[18,28,0],scale:[1.25,1.25,1.25],color:"#67b7dc",shape:"box"},
  {id:"wrist",name:"旋转腕部",parent:"arm",translation:[1.35,0.1,0],rotation:[0,0,38],scale:[0.8,0.8,0.8],color:"#f6a96b",shape:"sphere"},
  {id:"tool",name:"末端工具（可锁定）",parent:"wrist",translation:[1.15,0,0],rotation:[12,0,18],scale:[0.55,0.55,0.55],color:"#d883ff",shape:"box",locked:true},
  {id:"risk",name:"非均匀缩放父级",parent:"root",translation:[1.45,-0.1,0.2],rotation:[24,0,18],scale:[1.8,0.55,1.15],color:"#f2d06b",shape:"box"},
  {id:"risk_child",name:"带旋转的子级",parent:"risk",translation:[1.2,0.35,0],rotation:[35,18,0],scale:[0.7,0.9,0.7],color:"#ff8f70",shape:"box"},
  {id:"mirror",name:"镜像父级 X=-1",parent:"root",translation:[0.6,-1.25,-0.4],rotation:[10,18,-8],scale:[-1,1,1],color:"#7bdcb5",shape:"box"},
  {id:"mirror_child",name:"镜像下的子级",parent:"mirror",translation:[1.1,0,0],rotation:[20,0,25],scale:[0.7,0.7,0.7],color:"#5b8def",shape:"sphere"},
  {id:"broken",name:"缺失父级示例",parent:"deleted_parent",translation:[2.4,-1.2,0],color:"#ff6b6b",shape:"box"},
  {id:"cycle_a",name:"环 A",parent:"cycle_b",translation:[-2.5,1.2,0],color:"#ff6b6b",shape:"sphere"},
  {id:"cycle_b",name:"环 B",parent:"cycle_a",translation:[1,0,0],color:"#ff6b6b",shape:"sphere"}
 ]
};
});
