import type { Scenario, TestContext } from '../harness.ts';
import { WorkshopStore } from '../../src/store.ts';
import { WoodType, woodProperties } from '../../src/types.ts';
import { availableFontsForWood, validateCarveParams } from '../../src/validation.ts';

export const continuousScenarios: Scenario[] = [
  {
    id: 'C1',
    title: '切换木料后，新一方不继承旧木料属性与绘制参数',
    run: (t: TestContext) => {
      const store = new WorkshopStore({ clock: () => 1000 });

      store.selectWood(WoodType.Pine);
      store.updateParams({ sizeMm: 18, text: '松', fontId: 'zhuanshu' });
      const sealA = store.carve();
      t.equal('A 木料为松木', sealA.wood, WoodType.Pine);
      t.deepEqual('A 快照为松木属性', sealA.woodSnapshot, woodProperties[WoodType.Pine]);
      store.stamp();
      store.finishSeal();

      t.equal('完成后回到 idle', store.phase, 'idle');
      t.equal('完成后木料选择清空', store.selectedWood, null);
      t.deepEqual('完成后参数回到默认值', store.params, {
        sizeMm: 20,
        fontId: 'zhuanshu',
        text: '',
      });
      t.equal('完成后校验结果为 NO_WOOD', store.validation.idle, true);

      store.selectWood(WoodType.Rosewood);
      store.updateParams({ sizeMm: 22, text: '紫' });
      const sealB = store.carve();

      t.equal('B 木料为紫檀', sealB.wood, WoodType.Rosewood);
      t.deepEqual('B 快照为紫檀属性', sealB.woodSnapshot, woodProperties[WoodType.Rosewood]);
      t.equal('A 快照未被 B 覆盖', store.completedSeals[0].wood, WoodType.Pine);
      t.equal('A 快照硬度仍为 40', store.completedSeals[0].woodSnapshot.hardness, 40);
      t.equal('B 不继承 A 的尺寸', sealB.params.sizeMm, 22);
      t.equal('B 不继承 A 的印文', sealB.params.text, '紫');

      store.stamp();
      const records = store.stampRecords;
      t.equal('画布保留 A 的盖印', records[0].wood, WoodType.Pine);
      t.equal('A 盖印尺寸冻结为 18', records[0].sizeMm, 18);
      t.equal('B 盖印记录使用 B 尺寸', records[1].sizeMm, 22);
      t.equal('两条盖印属于不同印方', records[0].sealId !== records[1].sealId, true);

      const fontsOnRosewood = store.validation.availableFonts;
      t.deepEqual(
        '新木料可用字体按紫檀属性计算',
        fontsOnRosewood,
        availableFontsForWood(WoodType.Rosewood),
      );
      t.equal('松木与紫檀可用字体集合不同', JSON.stringify(availableFontsForWood(WoodType.Pine)) !== JSON.stringify(fontsOnRosewood), true);
    },
  },
  {
    id: 'C2',
    title: '同一方印重复盖印：记录复制但彼此独立，参数冻结',
    run: (t: TestContext) => {
      const store = new WorkshopStore({ clock: () => 2000 });
      store.selectWood(WoodType.Boxwood);
      store.updateParams({ sizeMm: 24, text: '黄杨', fontId: 'kaishu' });
      store.carve();

      const r1 = store.stamp();
      const r2 = store.stamp();
      const r3 = store.stamp();
      t.equal('同一 sealId', r1.sealId, r3.sealId);
      t.equal('记录 id 递增不重复', new Set([r1.recordId, r2.recordId, r3.recordId]).size, 3);
      t.equal('位置随槽位变化', r1.x === r2.x ? r1.y !== r2.y : true, true);
      t.deepEqual('三次盖印参数完全一致', [r1.sizeMm, r2.sizeMm, r3.sizeMm], [24, 24, 24]);

      t.throws('已刻制阶段禁止改尺寸', () => store.updateParams({ sizeMm: 30 }), 'INVALID_PHASE');
      t.throws('已刻制阶段禁止换木料', () => store.selectWood(WoodType.Pine), 'INVALID_PHASE');
      t.deepEqual('被拒绝的改参数没有污染冻结值', store.stampRecords.map((r) => r.sizeMm), [24, 24, 24]);

      const external = store.stampRecords[0];
      external.sizeMm = 99;
      t.equal('外部篡改记录对象不影响工坊内部状态', store.stampRecords[0].sizeMm, 24);
    },
  },
  {
    id: 'C3',
    title: '连续刻印三方：跨批次状态不串、校验结果不影响已完成印方',
    run: (t: TestContext) => {
      const store = new WorkshopStore({ clock: () => 3000 });
      const woods = [WoodType.Pine, WoodType.Rosewood, WoodType.Boxwood];
      const sizes = [20, 30, 12];
      const texts = ['甲', '乙', '丙'];

      for (let i = 0; i < 3; i++) {
        store.selectWood(woods[i]);
        store.updateParams({ sizeMm: sizes[i], text: texts[i], fontId: 'zhuanshu' });
        const seal = store.carve();
        t.equal(`第${i + 1}方木料正确`, seal.wood, woods[i]);
        t.equal(`第${i + 1}方尺寸正确`, seal.params.sizeMm, sizes[i]);
        store.stamp();
        store.finishSeal();
      }

      const ledger = store.completedSeals;
      t.equal('台账三方齐全', ledger.length, 3);
      t.deepEqual(
        '台账中各方木料不串',
        ledger.map((s) => s.wood),
        woods,
      );
      t.deepEqual(
        '台账中各方尺寸不串',
        ledger.map((s) => s.params.sizeMm),
        sizes,
      );
      t.deepEqual(
        '台账中各方印文不串',
        ledger.map((s) => s.params.text),
        texts,
      );
      t.equal('画布累计三方各一次盖印', store.stampRecords.length, 3);

      store.selectWood(WoodType.Pine);
      store.updateParams({ sizeMm: 50 });
      t.equal('新一方尺寸越界校验失败', store.validation.ok, false);
      t.equal('越界码为 SIZE_ABOVE_MAX', store.validation.codes.includes('SIZE_ABOVE_MAX'), true);
      t.equal('校验失败不影响历史盖印数量', store.stampRecords.length, 3);
      t.equal('校验失败不影响台账', store.completedSeals.length, 3);

      t.throws('未刻制禁止盖印', () => store.stamp(), 'INVALID_PHASE');
      t.deepEqual(
        '单次校验与连续流程中校验一致',
        validateCarveParams(WoodType.Pine, { sizeMm: 50, fontId: 'zhuanshu', text: '' }, { offline: true }).codes,
        store.validation.codes,
      );
    },
  },
];
