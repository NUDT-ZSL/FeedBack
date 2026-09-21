/* 示例数据：交接事项 + 上下文条目
 * item:  { id, title, role, dependsOn[], deadline, sourceNote }
 * ctx:   { id, itemId, key, value, source, expiresAt, status }
 * status: active | superseded（被裁决弃用，保留展示）
 */
function makeSampleData() {
  const items = [
    { id: "H-01", title: "生产数据库主从切换演练", role: "DBA 值班",
      dependsOn: [], deadline: "2026-10-01T18:00",
      sourceNote: "季度演练计划 Q3-2026" },
    { id: "H-02", title: "订单服务发布窗口确认", role: "后端负责人",
      dependsOn: ["H-01"], deadline: "2026-09-30T12:00",
      sourceNote: "发布协调会纪要 09-18" },
    { id: "H-03", title: "监控告警阈值调整", role: "SRE",
      dependsOn: ["H-02"], deadline: null,
      sourceNote: "SRE 周报 #37" },
    { id: "H-04", title: "客户数据导出审批", role: "数据合规",
      dependsOn: ["H-09"], deadline: "2026-09-25T00:00",
      sourceNote: "合规工单 CMP-2210" },
    { id: "H-05", title: "缓存集群扩容", role: "中间件组",
      dependsOn: ["H-06"], deadline: null,
      sourceNote: "容量评估报告" },
    { id: "H-06", title: "缓存集群容量基线确认", role: "中间件组",
      dependsOn: ["H-05"], deadline: null,
      sourceNote: "容量评估报告" },
    { id: "H-07", title: "旧客服系统下线", role: "应用运维",
      dependsOn: [], deadline: "2026-08-01T00:00",
      sourceNote: "下线公告 2026-06" },
  ];
  const contexts = [
    { id: "C-01", itemId: "H-01", key: "切换窗口", value: "周六 02:00-04:00",
      source: "DBA 交班记录", expiresAt: null, status: "active" },
    { id: "C-02", itemId: "H-01", key: "回滚方案", value: "binlog 点位回滚",
      source: "演练手册 v3", expiresAt: "2026-12-31T00:00", status: "active" },
    { id: "C-03", itemId: "H-02", key: "发布窗口", value: "周三 20:00",
      source: "发布协调会纪要", expiresAt: null, status: "active" },
    { id: "C-04", itemId: "H-02", key: "发布窗口", value: "周四 20:00",
      source: "项目经理口头确认", expiresAt: null, status: "active" },
    { id: "C-05", itemId: "H-03", key: "CPU 告警阈值", value: "85%",
      source: "SRE 周报", expiresAt: "2026-09-20T00:00", status: "active" },
    { id: "C-06", itemId: "H-04", key: "审批编号", value: "CMP-2210-A",
      source: "合规系统", expiresAt: null, status: "active" },
    { id: "C-07", itemId: "H-05", key: "目标容量", value: "32 节点",
      source: "容量评估报告", expiresAt: null, status: "active" },
    { id: "C-08", itemId: "H-07", key: "数据归档位置", value: "冷存储 bucket-legacy",
      source: "下线公告", expiresAt: "2026-07-01T00:00", status: "active" },
  ];
  return { items, contexts };
}
