import type { Scenario, TestContext } from '../harness.ts';
import { WorkshopStore } from '../../src/store.ts';
import { WoodType } from '../../src/types.ts';
import type { CarveParams, FontId } from '../../src/types.ts';
import {
  availableFontsForWood,
  sizeRangeForWood,
  validateCarveParams,
} from '../../src/validation.ts';

const WOODS = [WoodType.Pine, WoodType.Rosewood, WoodType.Boxwood];
const BASE: CarveParams = { sizeMm: 20, fontId: 'zhuanshu', text: '验' };

export const boundaryScenarios: Scenario[] = [
  {
    id: 'B1',
    title: '木料尺寸范围与属性一致，且边界值附近校验稳定',
    run: (t: TestContext) => {
      t.deepEqual('松木范围', sizeRangeForWood(WoodType.Pine), { min: 17, max: 32 });
      t.deepEqual('紫檀范围', sizeRangeForWood(WoodType.Rosewood), { min: 8, max: 37 });
      t.deepEqual('黄杨范围', sizeRangeForWood(WoodType.Boxwood), { min: 11, max: 39 });

      for (const wood of WOODS) {
        const { min, max } = sizeRangeForWood(wood);
        const cases: Array<[number, boolean, string]> = [
          [min - 1, false, 'SIZE_BELOW_MIN'],
          [min, true, ''],
          [min + 1, true, ''],
          [max - 1, true, ''],
          [max, true, ''],
          [max + 1, false, 'SIZE_ABOVE_MAX'],
        ];
        for (const [size, ok, code] of cases) {
          const result = validateCarveParams(wood, { ...BASE, sizeMm: size }, { offline: true });
          t.equal(`${wood} 尺寸 ${size} 校验结果`, result.ok, ok);
          if (!ok) {
            t.equal(`${wood} 尺寸 ${size} 越界码`, result.codes.includes(code as never), true);
          }
          t.equal(`${wood} 校验报告 minSize`, result.minSizeMm, min);
          t.equal(`${wood} 校验报告 maxSize`, result.maxSizeMm, max);
        }
      }
    },
  },
  {
    id: 'B2',
    title: '边界值批量结果与单次操作一致，且可重复',
    run: (t: TestContext) => {
      for (const wood of WOODS) {
        const { min, max } = sizeRangeForWood(wood);
        for (const size of [min - 1, min, max, max + 1]) {
          const single = validateCarveParams(wood, { ...BASE, sizeMm: size }, { offline: true });

          const store = new WorkshopStore({ clock: () => 7000 });
          store.selectWood(wood);
          store.updateParams({ sizeMm: size, text: '验', fontId: 'zhuanshu' });
          t.deepEqual(`${wood}@${size} 工坊校验与单次校验一致`, store.validation, single);

          if (single.ok) {
            const seal = store.carve();
            t.equal(`${wood}@${size} 边界值可刻制`, seal.params.sizeMm, size);
          } else {
            t.throws(`${wood}@${size} 越界值刻制被拒`, () => store.carve(), 'VALIDATION_FAILED');
          }
        }
      }
    },
  },
  {
    id: 'B3',
    title: '字体可用性随木料属性变化：硬度门槛与专属字体',
    run: (t: TestContext) => {
      t.deepEqual(
        '松木可用字体（硬度40，无缪篆/铁线篆）',
        availableFontsForWood(WoodType.Pine),
        ['zhuanshu', 'kaishu', 'mashan'],
      );
      t.deepEqual(
        '紫檀可用字体（硬度88，无铁线篆）',
        availableFontsForWood(WoodType.Rosewood),
        ['zhuanshu', 'kaishu', 'miao', 'mashan'],
      );
      t.deepEqual(
        '黄杨可用字体（全部）',
        availableFontsForWood(WoodType.Boxwood),
        ['zhuanshu', 'kaishu', 'miao', 'tiexian', 'mashan'],
      );

      const unavailable: Array<[WoodType, FontId]> = [
        [WoodType.Pine, 'miao'],
        [WoodType.Pine, 'tiexian'],
        [WoodType.Rosewood, 'tiexian'],
      ];
      for (const [wood, fontId] of unavailable) {
        const result = validateCarveParams(wood, { ...BASE, fontId }, { offline: true });
        t.equal(`${wood}+${fontId} 报 FONT_UNAVAILABLE`, result.codes.includes('FONT_UNAVAILABLE'), true);
      }

      const tiexianMin = 15;
      const below = validateCarveParams(
        WoodType.Boxwood,
        { ...BASE, fontId: 'tiexian', sizeMm: tiexianMin - 1 },
        { offline: true },
      );
      t.equal('铁线篆低于字体最小尺寸被拒', below.codes.includes('SIZE_BELOW_MIN'), true);
      const atMin = validateCarveParams(
        WoodType.Boxwood,
        { ...BASE, fontId: 'tiexian', sizeMm: tiexianMin },
        { offline: true },
      );
      t.equal('铁线篆恰达字体最小尺寸通过', atMin.ok, true);
    },
  },
  {
    id: 'B4',
    title: '离线模式：未缓存的在线字体被拒，本地字体不受影响',
    run: (t: TestContext) => {
      const offline = validateCarveParams(
        WoodType.Pine,
        { ...BASE, fontId: 'mashan' },
        { offline: true },
      );
      t.equal('离线时马善政体被拒', offline.codes.includes('FONT_OFFLINE_MISSING'), true);
      t.equal('离线时整体校验失败', offline.ok, false);

      const local = validateCarveParams(
        WoodType.Pine,
        { ...BASE, fontId: 'kaishu' },
        { offline: true },
      );
      t.equal('离线时本地楷书可用', local.ok, true);

      const online = validateCarveParams(
        WoodType.Pine,
        { ...BASE, fontId: 'mashan' },
        { offline: false },
      );
      t.equal('在线时马善政体可用', online.ok, true);

      const store = new WorkshopStore({ offline: true, clock: () => 8000 });
      store.selectWood(WoodType.Pine);
      store.updateParams({ fontId: 'mashan', text: '验' });
      t.throws('离线在工坊内同样拦截在线字体', () => store.carve(), 'VALIDATION_FAILED');
    },
  },
  {
    id: 'B5',
    title: '印文长度边界：空文与超长被拒，1-4 字通过',
    run: (t: TestContext) => {
      const cases: Array<[string, boolean, string]> = [
        ['', false, 'EMPTY_TEXT'],
        ['   ', false, 'EMPTY_TEXT'],
        ['一', true, ''],
        ['一二三四', true, ''],
        ['一二三四五', false, 'TEXT_TOO_LONG'],
      ];
      for (const [text, ok, code] of cases) {
        const result = validateCarveParams(
          WoodType.Boxwood,
          { ...BASE, text },
          { offline: true },
        );
        t.equal(`印文"${text}" 校验结果`, result.ok, ok);
        if (!ok) {
          t.equal(`印文"${text}" 错误码`, result.codes.includes(code as never), true);
        }
      }
    },
  },
];
