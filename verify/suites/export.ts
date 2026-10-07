import type { Scenario, TestContext } from '../harness.ts';
import { WorkshopStore, DEFAULT_PARAMS } from '../../src/store.ts';
import { WoodType } from '../../src/types.ts';
import { validateCarveParams } from '../../src/validation.ts';

function sealCycle(store: WorkshopStore, wood: WoodType, text: string, size: number): void {
  store.selectWood(wood);
  store.updateParams({ sizeMm: size, text });
  store.carve();
  store.stamp();
  store.finishSeal();
}

export const exportScenarios: Scenario[] = [
  {
    id: 'E1',
    title: '导出后完整重置：画布、记录、木料、参数校验结果全部归位',
    run: (t: TestContext) => {
      const store = new WorkshopStore({ clock: () => 4000 });
      sealCycle(store, WoodType.Rosewood, '先', 24);
      sealCycle(store, WoodType.Boxwood, '后', 16);

      t.equal('导出前有两条盖印', store.stampRecords.length, 2);
      t.equal('导出前台账有两方', store.completedSeals.length, 2);

      const artwork = store.exportArtwork();
      t.equal('导出记录数正确', artwork.recordCount, 2);
      t.equal('导出格式为 SVG', artwork.format, 'image/svg+xml');
      t.equal('导出内容含离线标记', artwork.svg.includes('data-font="zhuanshu"'), true);

      const fresh = new WorkshopStore({ clock: () => 4000 });
      t.deepEqual('导出后快照与新建工坊完全一致', store.getSnapshot(), fresh.getSnapshot());
      t.equal('画布无盖印残留', store.stampRecords.length, 0);
      t.equal('台账无残留', store.completedSeals.length, 0);
      t.equal('阶段回到 idle', store.phase, 'idle');
      t.equal('木料选择为空', store.selectedWood, null);
      t.deepEqual('参数回到默认', store.params, DEFAULT_PARAMS);
      t.deepEqual('校验结果回到未选料态', store.validation, validateCarveParams(null, DEFAULT_PARAMS));
    },
  },
  {
    id: 'E2',
    title: '清空后立即开始新一方：无残留，且导出内容只含新一方',
    run: (t: TestContext) => {
      const store = new WorkshopStore({ clock: () => 5000 });
      sealCycle(store, WoodType.Pine, '旧', 20);
      t.equal('旧盖印存在', store.stampRecords.length, 1);

      store.clearCanvas();
      t.equal('清空画布后记录消失', store.stampRecords.length, 0);
      t.equal('清空画布不影响已完成台账', store.completedSeals.length, 1);
      t.throws('清空后空画布不能导出', () => store.exportArtwork(), 'EMPTY_CANVAS');

      sealCycle(store, WoodType.Rosewood, '新', 32);
      const records = store.stampRecords;
      t.equal('新一方只有一条盖印', records.length, 1);
      t.equal('新盖印无旧木料残留', records[0].wood, WoodType.Rosewood);
      t.equal('新盖印无旧印文残留', records[0].text, '新');
      t.equal('新盖印尺寸正确', records[0].sizeMm, 32);
      t.equal('新盖印从第一个槽位开始（无位置残留）', records[0].x, 80);

      const artwork = store.exportArtwork();
      t.equal('导出仅含新一方', artwork.recordCount, 1);
      t.equal('导出不含旧印文', artwork.svg.includes('旧'), false);
      t.equal('导出包含新印文', artwork.svg.includes('新'), true);
      t.deepEqual('导出后再次完全干净', store.getSnapshot(), new WorkshopStore({ clock: () => 5000 }).getSnapshot());
    },
  },
  {
    id: 'E3',
    title: '导出产物确定可复现：同样记录导出字节一致，不含时间戳',
    run: (t: TestContext) => {
      const storeA = new WorkshopStore({ clock: () => 6001 });
      sealCycle(storeA, WoodType.Boxwood, '印', 14);
      const a = storeA.exportArtwork();

      const storeB = new WorkshopStore({ clock: () => 9999 });
      sealCycle(storeB, WoodType.Boxwood, '印', 14);
      const b = storeB.exportArtwork();

      t.deepEqual('SVG 内容与字节数一致', { svg: a.svg, bytes: a.bytes }, { svg: b.svg, bytes: b.bytes });
      t.equal('SVG 不含时间戳', a.svg.includes('6001') || a.svg.includes('9999'), false);
    },
  },
];
