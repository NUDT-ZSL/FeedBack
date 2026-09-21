export const DEFAULT_PARAMS = Object.freeze({
  seed: "dungeon-2026",
  width: 42,
  height: 28,
  roomCount: 9,
  minRoomSize: 4,
  maxRoomSize: 8,
  corridorWidth: 2,
  targetCount: 5,
  floorPercent: 70,
  grassPercent: 18,
  waterPercent: 12,
  ensureReachable: true,
});

export function readParameters(form) {
  return {
    seed: form.elements.seed.value,
    width: Number(form.elements.width.value),
    height: Number(form.elements.height.value),
    roomCount: Number(form.elements.roomCount.value),
    minRoomSize: Number(form.elements.minRoomSize.value),
    maxRoomSize: Number(form.elements.maxRoomSize.value),
    corridorWidth: Number(form.elements.corridorWidth.value),
    targetCount: Number(form.elements.targetCount.value),
    floorPercent: Number(form.elements.floorPercent.value),
    grassPercent: Number(form.elements.grassPercent.value),
    waterPercent: Number(form.elements.waterPercent.value),
    ensureReachable: form.elements.ensureReachable.checked,
  };
}

export function applyParameters(form, params) {
  for (const [key, value] of Object.entries(params)) form.elements[key].value = value;
  form.elements.ensureReachable.checked = params.ensureReachable;
}
