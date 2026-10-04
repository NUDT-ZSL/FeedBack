import 'cannon-es';

declare module 'cannon-es' {
  interface Body {
    /** cannon-es 运行时支持但未在 d.ts 中声明的自定义数据槽 */
    userData?: unknown;
  }
}
