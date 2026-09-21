export function seedState() {
  return {
    version: 1,
    counters: { E: 7, link: 5, rev: 9 },
    entries: [
      {
        id: "E001",
        title: "支付接口幂等防重",
        body: "支付下单接口必须使用业务订单号作为幂等键。客户端重试时，服务端先查询幂等记录；重复支付请求返回首次处理结果，不能再次扣款。网络超时后只允许安全重试，避免重复入账。",
        tags: ["支付", "幂等", "重试", "接口"],
        status: "active",
        createdAt: "2026-09-10T08:00:00.000Z",
        updatedAt: "2026-09-12T08:00:00.000Z",
        createdBy: "支付平台组",
        revisions: [
          { id: "rev001", at: "2026-09-10T08:00:00.000Z", by: "支付平台组", action: "create", note: "创建条目" },
          { id: "rev002", at: "2026-09-12T08:00:00.000Z", by: "支付平台组", action: "rewrite", note: "补充网络超时安全重试" }
        ]
      },
      {
        id: "E002",
        title: "支付回调重复通知处理",
        body: "支付渠道可能重复推送回调。消费回调消息时，以渠道流水号和订单号组成幂等键，先确认支付状态再更新订单。重复通知必须返回成功，避免消息队列不断重投。",
        tags: ["支付", "回调", "幂等", "消息队列"],
        status: "active",
        createdAt: "2026-09-11T03:00:00.000Z",
        updatedAt: "2026-09-11T03:00:00.000Z",
        createdBy: "交易组",
        revisions: [
          { id: "rev003", at: "2026-09-11T03:00:00.000Z", by: "交易组", action: "create", note: "创建条目" }
        ]
      },
      {
        id: "E003",
        title: "消息消费失败的指数退避",
        body: "消息队列消费失败时先进入短延迟重试，再按指数退避拉长间隔。达到最大次数后投递死信队列并告警。支付类重试任务必须保证处理逻辑幂等。",
        tags: ["重试", "消息队列", "稳定性"],
        status: "active",
        createdAt: "2026-09-12T02:00:00.000Z",
        updatedAt: "2026-09-12T02:00:00.000Z",
        createdBy: "中间件组",
        revisions: [
          { id: "rev004", at: "2026-09-12T02:00:00.000Z", by: "中间件组", action: "create", note: "创建条目" }
        ]
      },
      {
        id: "E004",
        title: "支付消息顺序消费",
        body: "同一订单的支付消息应按订单号分区，保证创建、扣款、回调顺序执行。顺序消费者依赖支付状态机，异常时暂停分区，避免并发补偿先于回调执行。",
        tags: ["消息队列", "顺序性", "支付", "状态机"],
        status: "active",
        createdAt: "2026-09-13T06:00:00.000Z",
        updatedAt: "2026-09-13T06:00:00.000Z",
        createdBy: "交易组",
        revisions: [
          { id: "rev005", at: "2026-09-13T06:00:00.000Z", by: "交易组", action: "create", note: "创建条目" }
        ]
      },
      {
        id: "E005",
        title: "支付状态最终一致补偿",
        body: "支付状态无法确认时，定时补偿任务主动查询渠道。只有渠道明确成功才能把订单置为成功；渠道未确认前不要强行关闭订单。回调乱序时以支付状态机的当前阶段裁决。",
        tags: ["支付", "补偿", "状态机", "一致性"],
        status: "active",
        createdAt: "2026-09-13T09:00:00.000Z",
        updatedAt: "2026-09-13T09:00:00.000Z",
        createdBy: "交易组",
        revisions: [
          { id: "rev006", at: "2026-09-13T09:00:00.000Z", by: "交易组", action: "create", note: "创建条目" }
        ]
      },
      {
        id: "E006",
        title: "旧版同步扣款兜底（历史方案）",
        body: "历史做法是支付超时后同步重试扣款，并以本地扣款结果为准。该方案在渠道超时时可能重复入账，仅保留用于追溯，不再用于新链路。",
        tags: ["支付", "重试", "历史方案"],
        status: "deprecated",
        deprecatedReason: "渠道超时下存在重复入账风险，改由幂等订单号与渠道查询补偿承接。",
        supersededBy: "E007",
        createdAt: "2026-09-08T01:00:00.000Z",
        updatedAt: "2026-09-15T03:00:00.000Z",
        createdBy: "支付平台组",
        revisions: [
          { id: "rev007", at: "2026-09-08T01:00:00.000Z", by: "支付平台组", action: "create", note: "创建条目" },
          { id: "rev008", at: "2026-09-15T03:00:00.000Z", by: "支付平台组", action: "deprecate", note: "存在重复入账风险" }
        ]
      },
      {
        id: "E007",
        title: "渠道查询补偿替代同步扣款",
        body: "支付请求超时后不要再次发起扣款，应保留订单处理中状态，并使用业务订单号执行幂等查询。查询结果明确后再推进支付状态，必要时进入补偿队列。",
        tags: ["支付", "幂等", "补偿", "重试", "一致性"],
        status: "active",
        createdAt: "2026-09-15T02:00:00.000Z",
        updatedAt: "2026-09-15T02:00:00.000Z",
        createdBy: "支付平台组",
        revisions: [
          { id: "rev009", at: "2026-09-15T02:00:00.000Z", by: "支付平台组", action: "create", note: "创建条目" }
        ]
      }
    ],
    links: [
      { id: "link001", source: "E001", target: "E002", relation: "supports", note: "两者共同构成支付请求与回调的幂等闭环", createdAt: "2026-09-12T09:00:00.000Z", createdBy: "支付平台组" },
      { id: "link002", source: "E002", target: "E003", relation: "supports", note: "回调重投需要消费侧幂等和退避重试配合", createdAt: "2026-09-12T10:00:00.000Z", createdBy: "交易组" },
      { id: "link003", source: "E004", target: "E005", relation: "refines", note: "顺序消费方案细化了状态机对乱序回调的裁决", createdAt: "2026-09-14T01:00:00.000Z", createdBy: "交易组" },
      { id: "link004", source: "E005", target: "E004", relation: "contradicts", note: "补偿团队认为严格顺序消费会阻断必要的乱序补偿，双方策略待裁决", createdAt: "2026-09-14T04:00:00.000Z", createdBy: "稳定性负责人" },
      { id: "link005", source: "E006", target: "E007", relation: "supersedes", note: "旧同步扣款方案被幂等查询补偿替代", createdAt: "2026-09-15T03:00:00.000Z", createdBy: "支付平台组" }
    ],
    decisions: []
  };
}
