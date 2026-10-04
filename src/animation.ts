export interface AnimationState {
  rotationAngle: number;
  time: number;
}

export function createAnimationState(): AnimationState {
  return {
    rotationAngle: 0,
    time: 0
  };
}

export function advanceAnimation(
  state: AnimationState,
  deltaSeconds: number,
  rotationSpeed: number,
  nowSeconds: number
): void {
  state.rotationAngle += rotationSpeed * deltaSeconds;
  state.time = nowSeconds;
}
