/** 轻量 className 合并：去除假值并用空格拼接，避免引入运行时依赖 */
export function cn(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter(Boolean).join(' ');
}
