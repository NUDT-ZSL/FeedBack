import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  ActionResult,
  CargoItem,
  Finding,
  Ship,
  TariffRule,
} from '@/domain/types';
import { pendingOf, recompute } from '@/domain/recompute';
import {
  adjudicate,
  applyManifestEdit,
  genId,
  initiateInspection,
  voidInspection,
} from '@/domain/operations';

const T0 = Date.parse('2026-10-01T08:00:00+08:00');
const H = 3600_000;

function buildSeed(): { ships: Ship[]; rules: TariffRule[] } {
  const rules: TariffRule[] = [
    { id: 'rule-fine', registry: '*', category: '细色', rate: 0.1 },
    { id: 'rule-coarse', registry: '*', category: '粗色', rate: 0.15 },
    { id: 'rule-dashi-fine', registry: '大食', category: '细色', rate: 0.08 },
    { id: 'rule-gaoli-coarse', registry: '高丽', category: '粗色', rate: 0.12 },
  ];

  const mk = (
    id: string,
    name: string,
    registry: string,
    captain: string,
    origin: string,
    arrivedAt: number,
    manifest: CargoItem[],
  ): Ship => {
    const ship: Ship = {
      id,
      name,
      registry,
      captain,
      origin,
      arrivedAt,
      manifest,
      manifestVersion: 1,
      inspections: [],
      conclusion: undefined as never,
    };
    return { ...ship, conclusion: recompute(ship, rules) };
  };

  const ships: Ship[] = [
    mk('ship-yongchang', '永昌号', '南宋', '陈阿福', '泉州', T0, [
      { id: 'yc-1', name: '丝绸', category: '细色', quantity: 200, unitPrice: 3 },
      { id: 'yc-2', name: '瓷器', category: '粗色', quantity: 500, unitPrice: 0.8 },
      { id: 'yc-3', name: '茶叶', category: '粗色', quantity: 300, unitPrice: 0.5 },
    ]),
    mk('ship-haidongqing', '海东青号', '高丽', '金敏哲', '高丽·开城', T0 + 2 * H, [
      { id: 'hdq-1', name: '人参', category: '细色', quantity: 80, unitPrice: 6 },
      { id: 'hdq-2', name: '松子', category: '粗色', quantity: 400, unitPrice: 0.4 },
      { id: 'hdq-3', name: '高丽纸', category: '粗色', quantity: 260, unitPrice: 0.3 },
    ]),
    mk('ship-zhenzhu', '真珠宝船', '大食', '易卜拉欣', '大食·巴士拉', T0 + 5 * H, [
      { id: 'zz-1', name: '乳香', category: '细色', quantity: 600, unitPrice: 2 },
      { id: 'zz-2', name: '珍珠', category: '细色', quantity: 40, unitPrice: 20 },
      { id: 'zz-3', name: '椰枣', category: '粗色', quantity: 800, unitPrice: 0.2 },
    ]),
    mk('ship-nanhaiyue', '南海月号', '三佛齐', '陈守财', '三佛齐·巨港', T0 + 9 * H, [
      { id: 'nhy-1', name: '沉香', category: '细色', quantity: 150, unitPrice: 8 },
      { id: 'nhy-2', name: '胡椒', category: '粗色', quantity: 900, unitPrice: 0.3 },
      { id: 'nhy-3', name: '象牙', category: '细色', quantity: 30, unitPrice: 15 },
    ]),
    mk('ship-penglai', '蓬莱丸', '日本', '藤原清', '日本·博多', T0 + 14 * H, [
      { id: 'pl-1', name: '倭刀', category: '细色', quantity: 120, unitPrice: 4 },
      { id: 'pl-2', name: '硫磺', category: '粗色', quantity: 700, unitPrice: 0.25 },
    ]),
    mk('ship-jinchao', '金潮号', '占城', '黎文通', '占城·会安', T0 + 20 * H, [
      { id: 'jc-1', name: '占城稻种', category: '粗色', quantity: 1000, unitPrice: 0.15 },
      { id: 'jc-2', name: '犀角', category: '细色', quantity: 25, unitPrice: 18 },
    ]),
  ];

  // 海东青号：一轮已落地裁定（乳香→人参数量争议），结论与货单冲突
  {
    const ship = ships[1];
    const started = initiateInspection(ship, rules, T0 + 3 * H).ship!;
    const declared = started.manifest[0];
    ships[1] = adjudicate(
      started,
      started.inspections[0].id,
      [
        {
          id: genId('fnd'),
          kind: 'quantity',
          cargoItemId: declared.id,
          declared: { ...declared },
          observed: { ...declared, quantity: 110 },
          note: '舱底另起出人参三十斤，货单未载',
        },
      ],
      rules,
      T0 + 4 * H,
    ).ship!;
  }

  // 真珠宝船：一轮抽检待裁定
  ships[2] = initiateInspection(ships[2], rules, T0 + 6 * H).ship!;

  // 南海月号：两轮裁定（后轮推翻前轮），且裁定后货单被外部修正
  {
    let ship = ships[3];
    ship = initiateInspection(ship, rules, T0 + 10 * H).ship!;
    const chenxiang = ship.manifest[0];
    ship = adjudicate(
      ship,
      ship.inspections[0].id,
      [
        {
          id: genId('fnd'),
          kind: 'quantity',
          cargoItemId: chenxiang.id,
          declared: { ...chenxiang },
          observed: { ...chenxiang, quantity: 180 },
          note: '第一轮抽检实测沉香一百八十斤',
        },
      ],
      rules,
      T0 + 11 * H,
    ).ship!;
    ship = initiateInspection(ship, rules, T0 + 12 * H).ship!;
    ship = adjudicate(
      ship,
      ship.inspections[1].id,
      [
        {
          id: genId('fnd'),
          kind: 'quantity',
          cargoItemId: chenxiang.id,
          declared: { ...ship.manifest[0] },
          observed: { ...ship.manifest[0], quantity: 210 },
          note: '复查暗舱，再出沉香三十斤',
        },
      ],
      rules,
      T0 + 13 * H,
    ).ship!;
    // 裁定落地后，货单被外部修正（胡椒数量）
    ship = applyManifestEdit(
      ship,
      (m) => m.map((it) => (it.id === 'nhy-2' ? { ...it, quantity: 950 } : it)),
      rules,
    ).ship!;
    ships[3] = ship;
  }

  // 蓬莱丸：一轮裁定，补充记录（未申报货物）
  {
    let ship = ships[4];
    ship = initiateInspection(ship, rules, T0 + 15 * H).ship!;
    ship = adjudicate(
      ship,
      ship.inspections[0].id,
      [
        {
          id: genId('fnd'),
          kind: 'new_item',
          cargoItemId: null,
          declared: null,
          observed: { id: 'pl-new-1', name: '未申报金砂', category: '细色', quantity: 12, unitPrice: 30 },
          note: '舱底夹带金砂，货单未载，补充入册',
        },
      ],
      rules,
      T0 + 16 * H,
    ).ship!;
    ships[4] = ship;
  }

  return { ships, rules };
}

export type RulingFilter = 'all' | 'none' | 'pending' | 'adjudicated' | 'stale';

export function rulingStatusOf(ship: Ship): Exclude<RulingFilter, 'all'> {
  if (pendingOf(ship)) return 'pending';
  if (ship.inspections.length === 0) return 'none';
  const stale = ship.inspections.some(
    (i) =>
      i.status === 'adjudicated' &&
      i.manifestVersionAtAdjudication !== null &&
      ship.manifestVersion > i.manifestVersionAtAdjudication,
  );
  return stale ? 'stale' : 'adjudicated';
}

interface StoreState {
  ships: Ship[];
  rules: TariffRule[];
  initiateInspection: (shipId: string) => ActionResult;
  adjudicate: (shipId: string, inspectionId: string, findings: Finding[]) => ActionResult;
  voidInspection: (shipId: string, inspectionId: string) => ActionResult;
  addCargoItem: (shipId: string, item: Omit<CargoItem, 'id'>) => ActionResult;
  updateCargoItem: (shipId: string, itemId: string, patch: Partial<CargoItem>) => ActionResult;
  removeCargoItem: (shipId: string, itemId: string) => ActionResult;
  upsertRule: (rule: Omit<TariffRule, 'id'> & { id?: string }) => ActionResult;
  resetAll: () => void;
}

const fail = (error: string): ActionResult => ({ ok: false, error });

export const useStore = create<StoreState>()(
  persist(
    (set, get) => {
      const mutateShip = (
        shipId: string,
        fn: (ship: Ship) => { ship?: Ship; error?: string },
      ): ActionResult => {
        const ship = get().ships.find((s) => s.id === shipId);
        if (!ship) return fail('商船不存在');
        const { ship: next, error } = fn(ship);
        if (error || !next) return fail(error ?? '操作失败');
        set((st) => ({ ships: st.ships.map((s) => (s.id === shipId ? next : s)) }));
        return { ok: true };
      };

      return {
        ...buildSeed(),

        initiateInspection: (shipId) =>
          mutateShip(shipId, (ship) => initiateInspection(ship, get().rules, Date.now())),

        adjudicate: (shipId, inspectionId, findings) =>
          mutateShip(shipId, (ship) =>
            adjudicate(ship, inspectionId, findings, get().rules, Date.now()),
          ),

        voidInspection: (shipId, inspectionId) =>
          mutateShip(shipId, (ship) => voidInspection(ship, inspectionId, get().rules)),

        addCargoItem: (shipId, item) =>
          mutateShip(shipId, (ship) =>
            applyManifestEdit(
              ship,
              (m) => [...m, { ...item, id: genId('cargo') }],
              get().rules,
            ),
          ),

        updateCargoItem: (shipId, itemId, patch) =>
          mutateShip(shipId, (ship) =>
            applyManifestEdit(
              ship,
              (m) => m.map((it) => (it.id === itemId ? { ...it, ...patch, id: it.id } : it)),
              get().rules,
            ),
          ),

        removeCargoItem: (shipId, itemId) =>
          mutateShip(shipId, (ship) =>
            applyManifestEdit(ship, (m) => m.filter((it) => it.id !== itemId), get().rules),
          ),

        upsertRule: (rule) => {
          const pendingShip = get().ships.find((s) => pendingOf(s));
          if (pendingShip) {
            return fail(`「${pendingShip.name}」抽检待裁定，关税口径已锁定`);
          }
          set((st) => {
            const id = rule.id ?? genId('rule');
            const rules = st.rules.some((r) => r.id === id)
              ? st.rules.map((r) => (r.id === id ? { ...rule, id } : r))
              : [...st.rules, { ...rule, id }];
            return {
              rules,
              ships: st.ships.map((s) => ({ ...s, conclusion: recompute(s, rules) })),
            };
          });
          return { ok: true };
        },

        resetAll: () => set(buildSeed()),
      };
    },
    { name: 'quanzhou-shibosi', version: 1 },
  ),
);
