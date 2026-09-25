export const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

export const isPositiveAmount = (value: number): boolean =>
  !Number.isNaN(value) && value > 0;
