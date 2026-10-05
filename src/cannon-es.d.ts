import 'cannon-es';

declare module 'cannon-es' {
  interface Body {
    // cannon-es 运行时支持但类型未声明的自定义数据挂载点
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    userData?: any;
  }
}
