// 离线环境最小 Node 类型声明：仅覆盖验证入口用到的 API，
// 使 `npm run check:verify` 无需安装 @types/node 即可运行。
declare module 'node:crypto' {
  export function createHash(algorithm: string): {
    update(data: string): { digest(encoding: 'hex'): string };
  };
}
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string): void;
  export function mkdirSync(path: string, options: { recursive: boolean }): void;
}
declare module 'node:path' {
  const path: {
    dirname(p: string): string;
    join(...parts: string[]): string;
  };
  export default path;
}
declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
declare const process: { exit(code: number): never };
