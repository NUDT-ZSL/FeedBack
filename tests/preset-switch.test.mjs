// 链路环节 3：连续切换多个预设再手动调参 —— 参数、当前预设、校验结果三者一致，
// 不出现上一预设的残留判定。
import { TEA_PRESETS } from '../src/TeaController.ts';
import { assert, assertEqual, assertDeepEqual } from './helpers/assert.mjs';

function assertMatchesPreset(controller, timers, preset) {
  const params = controller.getParams();
  assertEqual(
    controller.getCurrentPreset() && controller.getCurrentPreset().name,
    preset.name,
    `当前预设应为 ${preset.name}`
  );
  assert(
    params.waterTemp >= preset.recommendedTemp[0] &&
      params.waterTemp <= preset.recommendedTemp[1],
    `${preset.name}: 水温应在推荐区间内`
  );
  assert(
    params.pourAngle >= preset.recommendedAngle[0] &&
      params.pourAngle <= preset.recommendedAngle[1],
    `${preset.name}: 角度应在推荐区间内`
  );
  assert(
    params.brewDuration >= preset.recommendedDuration[0] &&
      params.brewDuration <= preset.recommendedDuration[1],
    `${preset.name}: 时长应在推荐区间内`
  );
  assertDeepEqual(
    controller.validateParams(),
    { temp: true, angle: true, duration: true },
    `${preset.name}: 校验应全部通过`
  );
  assertEqual(controller.getActiveWarnings().length, 0, `${preset.name}: 不应有告警`);
  assertEqual(timers.pendingCount(), 0, `${preset.name}: 不应残留告警定时器`);
}

export default [
  {
    name: '连续切换全部预设后状态始终跟随当前预设',
    fn({ controller, timers, events }) {
      const order = ['龙井', '铁观音', '普洱', '正山小种'];
      for (const name of order) {
        controller.loadPreset(name);
        assertMatchesPreset(controller, timers, TEA_PRESETS.find(p => p.name === name));
      }
      assertDeepEqual(
        events.preset.map(p => p && p.name),
        order,
        '预设回调序列应与切换顺序一致'
      );
    },
  },
  {
    name: '手动调参按当前预设判定，不残留上一预设区间',
    fn({ controller }) {
      controller.loadPreset('龙井');
      controller.loadPreset('普洱');

      // 97℃ 在普洱区间 [95,100] 内，但在龙井区间 [75,85] 外
      controller.setWaterTemp(97);
      assertEqual(
        controller.validateParams().temp,
        true,
        '水温按普洱区间应判为通过（不能残留龙井的判定）'
      );
      assertEqual(
        controller.isWarningActive('waterTemp'),
        false,
        '水温在当前预设区间内不应告警'
      );

      // 10s 在龙井区间 [10,20] 内，但在普洱区间 [60,120] 外
      controller.setBrewDuration(10);
      assertDeepEqual(
        controller.validateParams(),
        { temp: true, angle: true, duration: false },
        '时长应按普洱区间判为失败'
      );
      assertDeepEqual(
        controller.getActiveWarnings(),
        ['brewDuration'],
        '只应对时长告警，不能出现上一预设的残留告警'
      );

      controller.setBrewDuration(90);
      assertDeepEqual(
        controller.validateParams(),
        { temp: true, angle: true, duration: true },
        '时长调回普洱区间后校验应全部通过'
      );
      assertEqual(controller.getActiveWarnings().length, 0, '告警应全部停止');
    },
  },
  {
    name: '告警激活中切换预设，旧告警立即清除并按新预设重新判定',
    fn({ controller, timers, events, dom }) {
      controller.loadPreset('龙井');
      controller.setWaterTemp(90);
      assertEqual(controller.isWarningActive('waterTemp'), true, '前置条件：水温告警激活');
      timers.advance(1000);
      assertEqual(dom.element('waterTemp').stats.toggleCount, 2, '前置条件：闪烁已进行 2 次');

      controller.loadPreset('铁观音');

      assertEqual(
        controller.isWarningActive('waterTemp'),
        false,
        '切换预设后旧告警应立即停止'
      );
      assertEqual(timers.pendingCount(), 0, '旧告警定时器应被清理');
      assertDeepEqual(
        events.warning[events.warning.length - 1],
        { paramKey: 'waterTemp', active: false },
        '切换预设应发出旧告警停止事件'
      );
      assertEqual(
        dom.element('waterTemp').classList.contains('warning-flash'),
        false,
        '闪烁样式应被移除'
      );
      assertMatchesPreset(controller, timers, TEA_PRESETS.find(p => p.name === '铁观音'));

      const toggles = dom.element('waterTemp').stats.toggleCount;
      timers.advance(10000);
      assertEqual(
        dom.element('waterTemp').stats.toggleCount,
        toggles,
        '切换预设后不应再发生任何闪烁'
      );
    },
  },
];
