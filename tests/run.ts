/**
 * 离线验证统一入口。
 * 用法：npm run verify（先编译到 dist-tests，再由 Node 执行本文件）。
 * 任一用例失败时进程退出码为 1。
 */
import './idempotency.test.js';
import './countdownRace.test.js';
import './recipeMatrix.test.js';
import { runAll } from './framework.js';

console.log('烘焙订单系统 · 状态流转与原料消耗离线验证');
console.log('');
runAll();
