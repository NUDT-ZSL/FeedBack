/**
 * 离线运行环境（Node）的最小声明，避免引入 @types/node；
 * 验证脚本只使用 process.exit 与 console 输出。
 */

declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

declare const process: {
  exit(code?: number): never;
};
