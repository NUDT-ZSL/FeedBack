// 最小 Node 全局声明，避免引入 @types/node，保持测试链路完全离线。
declare const process: {
  exit(code?: number): never;
  exitCode: number | undefined;
};
