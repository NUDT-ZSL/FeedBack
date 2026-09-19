export const sampleData = {
  config: {
    finalTurnSettlement: true,
    numberScale: 1000
  },
  effects: {
    guard: {
      name: "护盾",
      kind: "shield",
      stacking: "refresh",
      duration: 2
    },
    vulnerable: {
      name: "易伤",
      kind: "vulnerable",
      stacking: "stack",
      duration: 2,
      maxStacks: 3,
      value: 15
    },
    weakened: {
      name: "减伤",
      kind: "reduction",
      stacking: "refresh",
      duration: 2,
      value: 20
    },
    rage: {
      name: "狂暴",
      kind: "outgoingIncrease",
      stacking: "refresh",
      duration: 2,
      value: 25
    },
    burn: {
      name: "灼烧",
      kind: "damageOverTime",
      stacking: "refresh",
      duration: 2,
      value: 28
    },
    mending: {
      name: "持续治疗",
      kind: "healOverTime",
      stacking: "stack",
      maxStacks: 2,
      duration: 2,
      value: 20
    }
  },
  rules: [
    {
      id: "weak-point",
      name: "弱点联动",
      stage: "vulnerability",
      target: "target",
      requireOn: "actor",
      requiredEffects: ["rage"],
      value: 10,
      priority: 50
    },
    {
      id: "bulwark-mastery",
      name: "壁垒精研",
      stage: "reduction",
      target: "target",
      requiredEffects: ["guard"],
      value: 10,
      priority: 50
    },
    {
      id: "warding-discipline",
      name: "护体反应",
      stage: "shield",
      target: "target",
      requiredEffects: ["guard"],
      value: 20,
      priority: 40
    },
    {
      id: "missing-link",
      name: "缺失引用规则",
      stage: "vulnerability",
      target: "target",
      requiredEffects: ["does-not-exist"],
      value: 50
    },
    {
      id: "cycle-a",
      name: "循环规则甲",
      stage: "vulnerability",
      target: "target",
      requiredRules: ["cycle-b"],
      value: 5
    },
    {
      id: "cycle-b",
      name: "循环规则乙",
      stage: "vulnerability",
      target: "target",
      requiredRules: ["cycle-a"],
      value: 5
    }
  ],
  units: [
    {
      id: "hero",
      name: "先锋",
      team: "A",
      hp: 300,
      maxHp: 300,
      initialStatuses: [
        {
          effectId: "mending",
          duration: 2,
          stacks: 1
        }
      ]
    },
    {
      id: "goblin",
      name: "哥布林",
      team: "B",
      hp: 260,
      maxHp: 260
    }
  ],
  skills: {
    slash: {
      name: "斩击",
      hitRate: 90,
      basePower: 60
    },
    strongSlash: {
      name: "强攻",
      hitRate: 75,
      basePower: 90,
      effects: [
        {
          effectId: "rage",
          target: "actor",
          duration: 2
        }
      ]
    },
    guard: {
      name: "部署护盾",
      hitRate: 100,
      basePower: 0,
      effects: [
        {
          effectId: "guard",
          target: "actor",
          duration: 2,
          value: 80
        },
        {
          effectId: "mending",
          target: "actor",
          duration: 2,
          stacks: 1
        }
      ]
    },
    brace: {
      name: "戒备",
      hitRate: 100,
      basePower: 0,
      effects: [
        {
          effectId: "guard",
          target: "actor",
          duration: 2,
          value: 70
        },
        {
          effectId: "weakened",
          target: "target",
          duration: 2
        }
      ]
    },
    flame: {
      name: "附焰斩",
      hitRate: 85,
      basePower: 55,
      effects: [
        {
          effectId: "burn",
          target: "target",
          duration: 2
        },
        {
          effectId: "vulnerable",
          target: "target",
          duration: 2,
          stacks: 1
        },
        {
          effectId: "rage",
          target: "actor",
          duration: 2
        }
      ]
    },
    exposeGuard: {
      name: "破阵架势",
      hitRate: 100,
      basePower: 0,
      effects: [
        {
          effectId: "guard",
          target: "target",
          duration: 2,
          value: 70
        },
        {
          effectId: "burn",
          target: "target",
          duration: 2
        },
        {
          effectId: "vulnerable",
          target: "target",
          duration: 2,
          stacks: 1
        }
      ]
    }
  },
  actions: [
    {
      turn: 1,
      actorId: "goblin",
      targetId: "goblin",
      skillId: "brace"
    },
    {
      turn: 1,
      actorId: "hero",
      targetId: "goblin",
      skillId: "strongSlash"
    },
    {
      turn: 1,
      actorId: "hero",
      targetId: "goblin",
      skillId: "flame"
    },
    {
      turn: 2,
      actorId: "hero",
      targetId: "goblin",
      skillId: "exposeGuard"
    },
    {
      turn: 2,
      actorId: "hero",
      targetId: "goblin",
      skillId: "strongSlash"
    },
    {
      turn: 3,
      actorId: "hero",
      targetId: "goblin",
      skillId: "flame"
    }
  ]
};
