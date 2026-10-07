import type { CargoItem, ConvoyState } from "./types.ts";

/** 构造一件初始货物 */
export function createCargo(
  partial: Partial<CargoItem> & Pick<CargoItem, "id" | "name" | "quantity" | "unitValue">,
): CargoItem {
  return {
    condition: "intact",
    initialQuantity: partial.quantity,
    ...partial,
  };
}

/** 构造初始镖队状态 */
export function createConvoy(
  partial: Partial<ConvoyState> & Pick<ConvoyState, "id">,
): ConvoyState {
  return {
    status: "en_route",
    morale: 100,
    stamina: 100,
    guards: 5,
    cargo: [],
    distance: 0,
    silver: 0,
    trace: [],
    ...partial,
  };
}
