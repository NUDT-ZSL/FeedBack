// 批量运行器在 Node 环境执行，但项目未引入 @types/node；这里提供最小类型声明
declare module 'node:fs/promises' {
  export function writeFile(path: string, data: string, encoding: string): Promise<void>;
  export function readFile(path: string, encoding: string): Promise<string>;
}
