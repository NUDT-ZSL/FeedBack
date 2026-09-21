(function initSeed(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.createSeedState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createSeedFactory() {
  "use strict";

  function isoAt(base, hourOffset, minuteOffset = 0) {
    return new Date(base.getTime() + hourOffset * 3600000 + minuteOffset * 60000).toISOString();
  }

  function createSeedState(nowInput = new Date()) {
    const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
    return {
      schemaVersion: 1,
      selectedActivityId: "a-launch",
      activities: [
        { id: "a-launch", name: "产品发布材料", description: "被会议打断，准备恢复到发布页与发布检查。", createdAt: isoAt(now, -10) },
        { id: "a-research", name: "用户访谈结论", description: "存在两条相互矛盾的上下文口径，等待裁决。", createdAt: isoAt(now, -9) },
        { id: "a-integration", name: "接口联调", description: "依赖记录缺失并形成闭环，当前不可信。", createdAt: isoAt(now, -8) },
        { id: "a-resolved", name: "周报续写", description: "演示冲突裁决后如何恢复结论。", createdAt: isoAt(now, -7) }
      ],
      entries: [
        {
          id: "e-launch-progress",
          activityId: "a-launch",
          type: "progress",
          title: "发布页主标题已定稿",
          content: "主标题采用“10分钟恢复现场”，副标题还差一个数据点。",
          source: "周会纪要",
          status: "active",
          expiresAt: isoAt(now, 30),
          updatedAt: isoAt(now, -2, -10),
          dependsOn: []
        },
        {
          id: "e-launch-material",
          activityId: "a-launch",
          type: "material",
          title: "新版功能截图包",
          content: "三张截图已导出，需要核对空态截图是否替换。",
          source: "设计稿评论",
          status: "active",
          expiresAt: isoAt(now, 8),
          updatedAt: isoAt(now, -3),
          dependsOn: []
        },
        {
          id: "e-launch-todo",
          activityId: "a-launch",
          type: "todo",
          title: "补齐副标题数据点",
          content: "从增长看板取近7日激活率，回填发布页。",
          source: "发布检查清单",
          status: "active",
          expiresAt: isoAt(now, 12),
          updatedAt: isoAt(now, -1),
          dependsOn: ["e-launch-material"]
        },
        {
          id: "e-interview-a",
          activityId: "a-research",
          type: "material",
          title: "访谈口径：导出 PDF 最常用",
          content: "3 位用户明确提到需要把访谈摘录导出为 PDF。",
          source: "访谈记录 A",
          status: "active",
          expiresAt: isoAt(now, 20),
          updatedAt: isoAt(now, -4),
          dependsOn: []
        },
        {
          id: "e-interview-b",
          activityId: "a-research",
          type: "material",
          title: "访谈口径：只需要 Markdown",
          content: "后续补录的两位用户表示 Markdown 更方便二次编辑。",
          source: "访谈记录 B",
          status: "active",
          expiresAt: isoAt(now, 5),
          updatedAt: isoAt(now, -2),
          dependsOn: []
        },
        {
          id: "e-integration-progress",
          activityId: "a-integration",
          type: "progress",
          title: "鉴权回调已改到新端点",
          content: "等待支付服务确认新回调是否兼容沙箱。",
          source: "联调日志",
          status: "active",
          expiresAt: isoAt(now, 2),
          updatedAt: isoAt(now, -1),
          dependsOn: ["e-missing-contract", "e-integration-todo"]
        },
        {
          id: "e-integration-todo",
          activityId: "a-integration",
          type: "todo",
          title: "复测支付回调签名",
          content: "回调签名和沙箱订单状态需要一起复测。",
          source: "缺陷单 #218",
          status: "active",
          expiresAt: isoAt(now, 6),
          updatedAt: isoAt(now, -1, -30),
          dependsOn: ["e-integration-progress"]
        },
        {
          id: "e-weekly-a",
          activityId: "a-resolved",
          type: "material",
          title: "旧数据：本周激活 820",
          content: "已被晚间补数修正。",
          source: "临时表格",
          status: "superseded",
          expiresAt: isoAt(now, 18),
          updatedAt: isoAt(now, -5),
          dependsOn: []
        },
        {
          id: "e-weekly-b",
          activityId: "a-resolved",
          type: "material",
          title: "新数据：本周激活 876",
          content: "晚间补数后的最终口径。",
          source: "增长看板",
          status: "active",
          expiresAt: isoAt(now, 18),
          updatedAt: isoAt(now, -2),
          dependsOn: []
        },
        {
          id: "e-weekly-todo",
          activityId: "a-resolved",
          type: "todo",
          title: "把周报数字改成 876",
          content: "同步修改风险段落中的环比描述。",
          source: "周报草稿",
          status: "active",
          expiresAt: isoAt(now, 4),
          updatedAt: isoAt(now, -1),
          dependsOn: ["e-weekly-b"]
        }
      ],
      conflicts: [
        {
          id: "c-interview-format",
          activityId: "a-research",
          entryAId: "e-interview-a",
          entryBId: "e-interview-b",
          reason: "访谈结论对首选导出格式判断相反",
          createdAt: isoAt(now, -2),
          resolution: null,
          resolvedAt: null
        },
        {
          id: "c-weekly-number",
          activityId: "a-resolved",
          entryAId: "e-weekly-a",
          entryBId: "e-weekly-b",
          reason: "周报激活数字存在两个口径",
          createdAt: isoAt(now, -3),
          resolution: "choose-b",
          resolvedAt: isoAt(now, -2)
        }
      ]
    };
  }

  return createSeedState;
});
