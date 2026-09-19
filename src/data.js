export const PAGES = {
  orders: { id: "orders", name: "订单队列", actions: ["view", "approve", "refund"] },
  finance: { id: "finance", name: "财务复核", actions: ["view", "audit"] },
  settings: { id: "settings", name: "成员设置", actions: ["view", "manage"] }
};

export const SCOPES = {
  root: { id: "root", name: "全公司" },
  cn: { id: "cn", name: "中国区" },
  eu: { id: "eu", name: "欧洲区" },
  cn_east: { id: "cn_east", name: "华东" },
  cn_south: { id: "cn_south", name: "华南" },
  cn_east_vip: { id: "cn_east_vip", name: "华东 VIP" }
};

export const INITIAL_EDGES = [
  { parent: "root", child: "cn" },
  { parent: "root", child: "eu" },
  { parent: "cn", child: "cn_east" },
  { parent: "cn", child: "cn_south" },
  { parent: "cn_east", child: "cn_east_vip" }
];

export const ITEMS = [
  { id: "ORD-101", page: "orders", scopeId: "cn_east", title: "华东退款申请", amount: 380 },
  { id: "ORD-102", page: "orders", scopeId: "cn_east_vip", title: "VIP 紧急审批", amount: 9800 },
  { id: "ORD-103", page: "orders", scopeId: "cn_south", title: "华南订单复核", amount: 620 },
  { id: "ORD-104", page: "orders", scopeId: "eu", title: "欧洲订单审批", amount: 1250 },
  { id: "FIN-201", page: "finance", scopeId: "cn_east", title: "华东对账批次", amount: 12000 },
  { id: "FIN-202", page: "finance", scopeId: "cn_south", title: "华南发票核对", amount: 4300 },
  { id: "SET-301", page: "settings", scopeId: "root", title: "组织与授权策略", amount: 0 }
];

export const INITIAL_ROLES = {
  hr_operator: {
    id: "hr_operator",
    name: "运营专员",
    grants: [
      { page: "orders", action: "view", scopeId: "cn_east" },
      { page: "orders", action: "approve", scopeId: "cn_east" },
      { page: "finance", action: "view", scopeId: "cn_east" }
    ]
  },
  finance_auditor: {
    id: "finance_auditor",
    name: "财务复核",
    grants: [
      { page: "orders", action: "view", scopeId: "cn" },
      { page: "finance", action: "view", scopeId: "cn" },
      { page: "finance", action: "audit", scopeId: "cn" }
    ]
  },
  admin: {
    id: "admin",
    name: "组织管理员",
    grants: [
      { page: "orders", action: "view", scopeId: "root" },
      { page: "finance", action: "view", scopeId: "root" },
      { page: "settings", action: "view", scopeId: "root" },
      { page: "settings", action: "manage", scopeId: "root" }
    ]
  },
  viewer: {
    id: "viewer",
    name: "只读访客",
    grants: [
      { page: "orders", action: "view", scopeId: "eu" },
      { page: "finance", action: "view", scopeId: "eu" }
    ]
  }
};

export const INITIAL_MEMBERS = [
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
  { id: "carol", name: "Carol" },
  { id: "dave", name: "Dave" }
];

export function adminSource(label = "管理控制台") {
  return { type: "admin", id: "console", label };
}

export const INITIAL_ASSIGNMENTS = [
  {
    id: "asg-alice",
    memberId: "alice",
    roleId: "hr_operator",
    source: { type: "seed", id: "seed", label: "初始化花名册" },
    content: "初始化花名册：Alice=运营专员"
  },
  {
    id: "asg-bob",
    memberId: "bob",
    roleId: "finance_auditor",
    source: { type: "seed", id: "seed", label: "初始化花名册" },
    content: "初始化花名册：Bob=财务复核"
  },
  {
    id: "asg-carol",
    memberId: "carol",
    roleId: "admin",
    source: { type: "seed", id: "seed", label: "初始化花名册" },
    content: "初始化花名册：Carol=管理员"
  },
  {
    id: "asg-dave",
    memberId: "dave",
    roleId: "viewer",
    source: { type: "seed", id: "seed", label: "初始化花名册" },
    content: "初始化花名册：Dave=只读访客"
  }
];
