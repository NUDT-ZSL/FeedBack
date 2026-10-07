/** 仅用于测试构建的最小 Node 环境声明，避免离线测试额外依赖 @types/node。 */
declare const process: {
  exit(code?: number): never;
};
