/**
 * 遭遇事件结算。
 *
 * 关键约束：同一类事件多次遭遇时，所有效果必须在“当前状态”上叠加累积，
 * 而不是用单次事件的结果覆盖状态。因此货物按当前存量复利损耗，
 * 士气 / 体力 / 人数 / 银两均在现值上做增量加减。
 */
import type { ConvoyState, EncounterEvent } from "./types.ts";

const clamp = (value: number): number => Math.max(0, Math.min(100, value));

/**
 * 在给定队伍状态上叠加一次遭遇事件，返回新状态（不修改入参）。
 * 每个事件都会追加一条 trace，保证多次遭遇可观察、可追溯。
 */
export function applyEncounter(
  state: ConvoyState,
  event: EncounterEvent,
  step: string,
): ConvoyState {
  const trace = [...state.trace, `${step} 遭遇事件 ${event.kind}`];

  const cargo = state.cargo.map((item) => {
    if (item.quantity <= 0 || event.cargoLossRate === undefined) {
      return item;
    }
    const lost = item.quantity * event.cargoLossRate;
    const remaining = item.quantity - lost;
    return {
      ...item,
      quantity: remaining,
      condition:
        remaining <= item.initialQuantity * 0.5 ? "damaged" : item.condition,
    };
  });

  const morale = clamp(state.morale + (event.moraleDelta ?? 0));
  const stamina = clamp(state.stamina + (event.staminaDelta ?? 0));
  const guards = Math.max(0, state.guards - (event.guardLoss ?? 0));
  const silver = Math.max(0, state.silver + (event.silverDelta ?? 0));

  return { ...state, cargo, morale, stamina, guards, silver, trace };
}

/**
 * 在当前状态上顺序叠加一批事件。
 * 使用 reduce 串行累积，杜绝后一个事件覆盖前一个事件的结果。
 */
export function applyEncounters(
  state: ConvoyState,
  events: EncounterEvent[],
  step: string,
): ConvoyState {
  return events.reduce(
    (acc, event, index) => applyEncounter(acc, event, `${step}#${index + 1}`),
    state,
  );
}
