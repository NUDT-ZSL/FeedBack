import { openPage, startOperation } from "./actions.js";

export function seedDemo(store) {
  const at1 = "2026-09-19T05:30:00.000Z";
  const aliceOrders = openPage(store, {
    memberId: "alice",
    page: "orders",
    label: "Alice · 标签页 A：订单队列"
  }, at1);
  startOperation(store, {
    pageId: aliceOrders.id,
    itemId: "ORD-101",
    action: "approve",
    form: { note: "预置：旧权限下发起，尚未确认" }
  }, "2026-09-19T05:31:00.000Z");
  openPage(store, {
    memberId: "alice",
    page: "finance",
    label: "Alice · 标签页 B：财务复核"
  }, "2026-09-19T05:32:00.000Z");
  openPage(store, {
    memberId: "bob",
    page: "finance",
    label: "Bob · 财务复核"
  }, "2026-09-19T05:33:00.000Z");
}
