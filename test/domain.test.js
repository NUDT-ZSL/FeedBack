import test from "node:test";
import assert from "node:assert/strict";
import { buildConflicts, findCycle, scopeClosure } from "../src/domain.js";

test("范围继承按父子方向计算闭包", () => {
  const edges = [
    { parent: "root", child: "cn" },
    { parent: "cn", child: "east" },
    { parent: "east", child: "vip" }
  ];
  assert.deepEqual([...scopeClosure(["root"], edges)].sort(), ["cn", "east", "root", "vip"]);
  assert.deepEqual([...scopeClosure(["east"], edges)].sort(), ["east", "vip"]);
});

test("继承图中的环会被找到并返回链条", () => {
  const cycle = findCycle([
    { parent: "a", child: "b" },
    { parent: "b", child: "c" },
    { parent: "c", child: "a" }
  ]);
  assert.deepEqual(cycle, ["a", "b", "c", "a"]);
});

test("互相矛盾的角色和范围都保留双方且生成可读记录", () => {
  const conflicts = buildConflicts([
    {
      memberId: "u1",
      roleId: "admin",
      source: { type: "hr", id: "hr", label: "HR 系统" },
      content: "HR：u1=admin"
    },
    {
      memberId: "u1",
      roleId: "viewer",
      source: { type: "it", id: "it", label: "IT 资产系统" },
      content: "IT：u1=viewer"
    }
  ], [
    {
      memberId: "u1",
      scopeId: "eu",
      effect: "allow",
      source: { type: "contract", id: "c", label: "合同系统" },
      content: "合同：allow eu"
    },
    {
      memberId: "u1",
      scopeId: "eu",
      effect: "deny",
      source: { type: "risk", id: "r", label: "风控系统" },
      content: "风控：deny eu"
    }
  ]);
  assert.equal(conflicts.length, 2);
  assert.match(conflicts[0].message, /成员 u1/);
  assert.match(conflicts[0].message, /HR 系统/);
  assert.match(conflicts[0].message, /IT 资产系统/);
  assert.equal(conflicts[1].sources.length, 2);
  assert.deepEqual(conflicts[1].sources.map((item) => item.effect).sort(), ["allow", "deny"]);
});
