# 本地交互式装载规划台

一个零第三方依赖的本地 Web 应用。导入货物、容器和关系数据后，系统自动生成三维装载方案，并支持直接调整参数后重新规划。

## 启动

```powershell
npm start
```

然后打开：

```text
http://localhost:5173
```

也可以直接双击 `index.html` 离线打开。

## 验证

```powershell
npm test
```

测试覆盖基础装箱、互斥分箱、必须相邻、不可堆叠承重校验和补箱建议。

## 数据格式

导入 JSON 需要包含 `containers`、`cargos`、`relations` 三个数组。可参考 [sample-data.json](sample-data.json)。

```json
{
  "containers": [
    {"id":"B1","name":"托盘箱","l":120,"w":80,"h":100,"maxWeight":650,"count":2}
  ],
  "cargos": [
    {"id":"C1","name":"机柜","l":55,"w":45,"h":60,"weight":95,
     "loadCapacity":40,"stackable":true,"rotatable":true,"flippable":false}
  ],
  "relations": [
    {"id":"R1","a":"C1","b":"C2","type":"incompatible"},
    {"id":"R2","a":"C2","b":"C3","type":"adjacent"}
  ],
  "supportRatio": 0.9
}
```

字段说明：

- `l/w/h`：长、宽、高；长度单位只需在全部数据中保持一致，界面示例按厘米解释。
- `weight`：货物自重；`maxWeight`：容器总承重；`loadCapacity`：货物顶面可承载重量。
- `stackable=false`：该货物既不能压在其他货物上方，也不能承托其他货物。
- `rotatable=true`：允许在水平面交换长宽；`flippable=true`：进一步允许六面姿态组合。
- `supportRatio`：上层底面必须获得的支撑比例，默认 0.9。
- 关系类型：`incompatible` 为不可同放，`adjacent` 为必须在同一容器且至少一个面贴合。

## 功能

- 自动生成初始方案，显示容器归属、坐标、姿态、容积和重量利用率。
- 逐层列出货物，三维图和清单可点选查看具体落点。
- 每次试放即检查边界、碰撞、支撑面积、上下层堆叠属性、载荷分配和容器总重。
- 调整容器数量、尺寸、承重或货物参数后自动重算，并标识原位、换位、移出和新放入。
- 容器不足时给出最少追加数量、推荐容器型号以及一键应用补箱重算。
- 不可行时列出具体货物、关系和物理原因；硬冲突不会被误报为“再加箱即可”。

## 算法说明

求解器使用多策略排序、姿态枚举、角落坐标枚举、约束剪枝和有限深度回溯。它会优先使用已有容器并以“启用容器数最少”为目标。三维装箱和最少箱数本质上是 NP-hard 问题，本实现适合调度台交互式规划和可解释校验；若后续需要生产级最优证明，可在此约束模型后接入 OR-Tools 或专用 CP/MIP 求解器。
