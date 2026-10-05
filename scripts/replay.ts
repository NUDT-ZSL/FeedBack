/**
 * 离线回放 CLI（无浏览器、无渲染）：
 *   node scripts/replay.ts --list            列出全部场景
 *   node scripts/replay.ts --all             回放全部场景，输出摘要与校验和
 *   node scripts/replay.ts <场景名>          回放单个场景，输出完整 JSON 轨迹（含每步依据）
 *   node scripts/replay.ts <场景名> --out <文件>   将轨迹写入文件，便于口径调整前后 diff
 */
import { writeFileSync } from 'node:fs'
import { runScenario, runScenarios } from '../src/simulation/replay.ts'
import { SCENARIOS } from '../src/simulation/scenarios.ts'

const args = process.argv.slice(2)

if (args.length === 0 || args[0] === '--list') {
  for (const scenario of SCENARIOS) {
    console.log(`${scenario.name}\t${scenario.description}`)
  }
  process.exit(0)
}

if (args[0] === '--all') {
  const results = runScenarios(SCENARIOS)
  for (const result of Object.values(results)) {
    const rejected = result.steps.filter((step) => !step.record.applied).length
    console.log(
      `${result.scenario}\tsteps=${result.steps.length}\trejected=${rejected}\talert=${result.finalState.alertActive}\tchecksum=${result.checksum}`,
    )
  }
  process.exit(0)
}

const name = args[0]
const scenario = SCENARIOS.find((item) => item.name === name)
if (!scenario) {
  console.error(`未知场景: ${name}，可用 --list 查看`)
  process.exit(1)
}

const result = runScenario(scenario)
const outIndex = args.indexOf('--out')
if (outIndex !== -1 && args[outIndex + 1]) {
  writeFileSync(args[outIndex + 1], JSON.stringify(result, null, 2))
  console.log(`轨迹已写入 ${args[outIndex + 1]}（checksum=${result.checksum}）`)
} else {
  console.log(JSON.stringify(result, null, 2))
}
