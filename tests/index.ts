// 测试入口：install-shims 必须最先 import（安装 DOM 桩与确定性随机源），
// 之后各套件 import 才会加载 src/ 中依赖 document/three 的模块。
import './install-shims';

import './mass-boundary.test';
import './anomaly-wrap.test';
import './perturbation.test';
import './mass-stability.test';
import './geometry.test';
import './long-run.test';

import { runAll } from './harness';

runAll().then(code => {
  process.exit(code);
});
