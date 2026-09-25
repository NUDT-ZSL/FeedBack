export const logger = {
  debug(message: string, ...details: unknown[]): void {
    console.debug(message, ...details);
  },
  error(message: string, error: unknown): void {
    console.error(message, error);
  },
  info(message: string, ...details: unknown[]): void {
    console.log(message, ...details);
  },
};
