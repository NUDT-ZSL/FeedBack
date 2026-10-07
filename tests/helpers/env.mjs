// 每个用例的独立环境：假定时器 + DOM 替身 + 全新 TeaController，
// 并把三类回调事件记录下来，用于判定回调同步与 dispose 后的静默。
import { TeaController, TEA_PRESETS } from '../../src/TeaController.ts';
import { installFakeTimers } from './fake-timers.mjs';
import { installDomStub } from './dom-stub.mjs';

export const INITIAL_PARAMS = Object.freeze({
  waterTemp: 85,
  pourAngle: 45,
  brewDuration: 30,
});

export { TEA_PRESETS };

export function createEnv() {
  const timers = installFakeTimers();
  const dom = installDomStub();
  const controller = new TeaController();

  const events = { params: [], preset: [], warning: [] };
  controller.onParamsChange(params => events.params.push(params));
  controller.onPresetChange(preset => events.preset.push(preset));
  if (typeof controller.onWarningChange === 'function') {
    controller.onWarningChange((paramKey, active) =>
      events.warning.push({ paramKey, active })
    );
  }

  return { controller, timers, dom, events };
}
