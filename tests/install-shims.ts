// 副作用模块：在任何依赖 DOM 的模块求值前安装垫片（必须最先被 import）。
import { installShims, installDeterministicRandom } from './shims';

installShims();
installDeterministicRandom();
