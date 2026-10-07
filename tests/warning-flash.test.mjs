// 链路环节 5：告警闪烁依赖定时器与 DOM —— 用假定时器在零真实等待下
// 判定闪烁启停时刻、翻转次数与重复触发计数，避免真实计时抖动。
import { assertEqual, assertDeepEqual } from './helpers/assert.mjs';

export default [
  {
    name: '闪烁按 0.5s 周期翻转，6 次后自动停止，共持续 3s',
    fn({ controller, timers, dom, events }) {
      controller.loadPreset('龙井');
      events.warning.length = 0;
      controller.setWaterTemp(90);

      assertDeepEqual(
        events.warning,
        [{ paramKey: 'waterTemp', active: true }],
        '触发即发出告警开启事件'
      );
      assertEqual(dom.element('waterTemp').stats.toggleCount, 0, '首个周期未到不应闪烁');

      timers.advance(499);
      assertEqual(dom.element('waterTemp').stats.toggleCount, 0, '499ms 内不应闪烁');
      timers.advance(1);
      assertEqual(dom.element('waterTemp').stats.toggleCount, 1, '500ms 第一次翻转');
      assertEqual(
        dom.element('waterTemp').classList.contains('warning-flash'),
        true,
        '奇数次翻转后闪烁样式应存在'
      );

      timers.advance(500);
      assertEqual(dom.element('waterTemp').stats.toggleCount, 2, '1000ms 第二次翻转');
      assertEqual(
        dom.element('waterTemp').classList.contains('warning-flash'),
        false,
        '偶数次翻转后闪烁样式应消失'
      );

      timers.advance(2500);
      assertEqual(dom.element('waterTemp').stats.toggleCount, 6, '3s 内共 6 次翻转');
      assertEqual(controller.isWarningActive('waterTemp'), false, '闪烁结束后告警自动停止');
      assertEqual(timers.pendingCount(), 0, '定时器应自动清理');
      assertDeepEqual(
        events.warning[events.warning.length - 1],
        { paramKey: 'waterTemp', active: false },
        '自动停止应发出告警停止事件'
      );
      assertEqual(
        dom.element('waterTemp').classList.contains('warning-flash'),
        false,
        '结束后不应保留闪烁样式'
      );

      timers.advance(10000);
      assertEqual(dom.element('waterTemp').stats.toggleCount, 6, '停止后继续推进时间不应再翻转');
    },
  },
  {
    name: '连续越界调整重新触发闪烁并重置翻转计数',
    fn({ controller, timers, dom, events }) {
      controller.loadPreset('龙井');
      controller.setWaterTemp(90);
      timers.advance(1000);
      assertEqual(dom.element('waterTemp').stats.toggleCount, 2, '旧轮已翻转 2 次');
      assertEqual(timers.pendingCount(), 1, '前置条件：一个闪烁定时器在运行');

      controller.setWaterTemp(95);
      assertEqual(
        events.warning.filter(e => e.active === true).length,
        2,
        '再次越界应重新发出告警开启事件（共 2 次）'
      );
      assertEqual(timers.pendingCount(), 1, '旧定时器应被新定时器替代');

      timers.advance(3500);
      assertEqual(
        dom.element('waterTemp').stats.toggleCount,
        8,
        '旧轮 2 次 + 新轮 6 次 = 8 次翻转'
      );
      assertEqual(
        events.warning.filter(e => e.active === false).length,
        1,
        '整轮闪烁结束只应自动停止一次'
      );
      assertEqual(timers.pendingCount(), 0, '定时器应被清理');
    },
  },
  {
    name: '闪烁中途调回区间立即停止，推进时间不再翻转',
    fn({ controller, timers, dom, events }) {
      controller.loadPreset('龙井');
      controller.setWaterTemp(90);
      timers.advance(1500);
      assertEqual(dom.element('waterTemp').stats.toggleCount, 3, '1.5s 已翻转 3 次');
      assertEqual(
        dom.element('waterTemp').classList.contains('warning-flash'),
        true,
        '奇数次翻转后闪烁样式应存在'
      );

      events.warning.length = 0;
      controller.setWaterTemp(80);

      assertEqual(controller.isWarningActive('waterTemp'), false, '告警应立即停止');
      assertEqual(timers.pendingCount(), 0, '定时器应立即清理');
      assertDeepEqual(
        events.warning,
        [{ paramKey: 'waterTemp', active: false }],
        '应立即发出停止事件'
      );
      assertEqual(
        dom.element('waterTemp').classList.contains('warning-flash'),
        false,
        '停止时应移除闪烁样式'
      );

      timers.advance(10000);
      assertEqual(dom.element('waterTemp').stats.toggleCount, 3, '停止后不应再翻转');
    },
  },
  {
    name: '未加载预设时参数调整不产生任何告警定时器',
    fn({ controller, timers, dom }) {
      controller.setWaterTemp(100);
      controller.setPourAngle(0);
      controller.setBrewDuration(180);
      assertDeepEqual(
        controller.validateParams(),
        { temp: true, angle: true, duration: true },
        '无预设时校验默认通过'
      );
      assertEqual(controller.getActiveWarnings().length, 0, '无预设不应有告警');
      assertEqual(timers.pendingCount(), 0, '不应创建定时器');
      timers.advance(5000);
      for (const key of ['waterTemp', 'pourAngle', 'brewDuration']) {
        assertEqual(dom.element(key).stats.toggleCount, 0, `${key} 不应闪烁`);
      }
    },
  },
];
