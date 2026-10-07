/**
 * 到达结算。
 *
 * 关键约束：同一镖队的同一次到达被重复提交时，必须幂等 ——
 * 直接返回首次结算记录，不能二次入账（重复加赏、重复扣货）。
 * 幂等键为 convoyId + arrivalId。
 */
import type { ConvoyState, SettlementRecord } from "./types.ts";

export const BASE_REWARD = 50;

export class SettlementError extends Error {}

export class SettlementLedger {
  private readonly records = new Map<string, SettlementRecord>();

  /** 已结算的到达是否已在账上 */
  has(convoyId: string, arrivalId: string): boolean {
    return this.records.has(`${convoyId}:${arrivalId}`);
  }

  get(convoyId: string, arrivalId: string): SettlementRecord | undefined {
    return this.records.get(`${convoyId}:${arrivalId}`);
  }

  /**
   * 提交一次到达结算。
   * 重复提交时返回既有记录，且状态收敛到首次结算后的结果，不二次入账。
   */
  settle(
    state: ConvoyState,
    arrivalId: string,
  ): ConvoyState & { record: SettlementRecord } {
    const key = `${state.id}:${arrivalId}`;
    const existing = this.records.get(key);
    if (existing) {
      return { ...state, silver: existing.finalSilver, record: existing };
    }

    if (state.status !== "arrived") {
      throw new SettlementError(
        `镖队 ${state.id} 当前状态为 ${state.status}，未抵达目的地，不能结算`,
      );
    }

    let cargoValueDelivered = 0;
    let cargoValueLost = 0;
    for (const item of state.cargo) {
      const totalValue = item.initialQuantity * item.unitValue;
      const deliveredValue = item.quantity * item.unitValue;
      cargoValueDelivered += deliveredValue;
      cargoValueLost += totalValue - deliveredValue;
    }

    const reward = BASE_REWARD + cargoValueDelivered;
    const finalSilver = state.silver + reward;

    const record: SettlementRecord = {
      convoyId: state.id,
      arrivalId,
      cargoValueDelivered,
      cargoValueLost,
      reward,
      finalSilver,
      guardsRemaining: state.guards,
    };
    this.records.set(key, record);

    return { ...state, silver: finalSilver, record };
  }
}
