export type TimeProvider = () => number;

let provider: TimeProvider = () => Date.now();

export const now = (): number => provider();

export const setTimeProvider = (p: TimeProvider): void => {
  provider = p;
};

export const resetTimeProvider = (): void => {
  provider = () => Date.now();
};
