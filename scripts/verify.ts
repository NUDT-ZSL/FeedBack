// 离线批量验证入口：`node scripts/verify.ts`（Node ≥ 22.6，内置类型擦除，无需联网与额外依赖）。
// 覆盖：
//  1. 冲突批注裁决后，受影响面纹的增量重推与从零全量重推一致，且未受影响面纹不被重算；
//  2. 依赖闭环、指向缺失、指向已撤回面纹均被显式暴露，推演不中断、不产出错误结论；
//  3. 批注撤回后面纹结论收敛（剩余批注生效 / 回到规则基准），且每步与全量重推一致；
//  4. 孤儿批注（指向不存在 / 已撤回面纹）不被静默跳过；
//  5. 批注、裁决、依赖推演结果随结论导出，重新载入后保持一致。

import { DeductionBench } from '../src/engine/bench.ts'
import type { DerivationResult } from '../src/engine/types.ts'

let failures = 0
function check(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${name}`)
  } else {
    failures += 1
    console.error(`  FAIL  ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

/** 用导出/载入构造一次“从零全量重推”，用于与增量结果对比（忽略版本号） */
function comparable(result: DerivationResult): string {
  return JSON.stringify({ conclusions: result.conclusions, issues: result.issues })
}
function freshFullDerive(bench: DeductionBench): DerivationResult {
  return DeductionBench.importBundle(bench.exportBundle('verify')).derivation
}

// ---------- 场景 1：冲突批注裁决后的增量重推一致性 ----------
console.log('\n[场景 1] 冲突批注裁决后，受影响面纹增量重推与全量重推一致')
{
  const bench = DeductionBench.create()
  bench.registerFeature({ id: 'nose', name: '鼻准', kind: 'nose', observation: '鼻头圆润' })
  bench.registerFeature({ id: 'forehead', name: '印堂', kind: 'forehead', observation: '天庭饱满', dependsOn: ['nose'] })
  bench.registerFeature({ id: 'brow', name: '眉宇', kind: 'brow', observation: '眉间距宽', dependsOn: ['forehead'] })
  bench.registerFeature({ id: 'ear', name: '耳轮', kind: 'ear', observation: '耳轮贴脑' }) // 与冲突链无关

  bench.addAnnotation({ targetFeatureId: 'nose', author: '柳庄', opinion: '鼻露孔窍，主财帛外泄' })
  bench.addAnnotation({ targetFeatureId: 'nose', author: '袁天罡', opinion: '鼻准丰隆，主财库充盈' })

  const conflicted = bench.derivation.conclusions['nose']
  check('冲突批注并存时结论为 conflict-pending 而非静默择一', conflicted.status === 'conflict-pending')
  check('冲突时判词为空（不产出错误结论）', conflicted.verdict === null)
  check('双方批注都保留在依据中', conflicted.basis.filter((b) => b.kind === 'annotation').length === 2)
  check('下游面纹沿依赖链被阻塞', bench.derivation.conclusions['forehead'].status !== 'ready'
    && bench.derivation.conclusions['brow'].status !== 'ready')
  check('无关面纹不受影响', bench.derivation.conclusions['ear'].status === 'ready')

  const earBefore = bench.derivation.conclusions['ear']
  const noseAnno = bench.snapshot().annotations.find((a) => a.author === '袁天罡')!
  bench.adjudicate('nose', noseAnno.id, '鼻准圆厚，当以财库论')

  const after = bench.derivation
  check('裁决后鼻准结论就绪且只采纳被裁决批注',
    after.conclusions['nose'].status === 'ready'
    && after.conclusions['nose'].annotationIds.length === 1
    && after.conclusions['nose'].annotationIds[0] === noseAnno.id)
  check('裁决依据随结论落档', after.conclusions['nose'].basis.some((b) => b.kind === 'adjudication'))
  check('下游面纹随增量重推恢复就绪',
    after.conclusions['forehead'].status === 'ready' && after.conclusions['brow'].status === 'ready')
  check('未受影响面纹的结论对象未被重算（引用相等）', after.conclusions['ear'] === earBefore)
  check('增量重推结果与从零全量重推完全一致', comparable(after) === comparable(freshFullDerive(bench)))
}

// ---------- 场景 2：依赖闭环与指向缺失的显式暴露 ----------
console.log('\n[场景 2] 依赖闭环 / 指向缺失 / 指向撤回面纹均显式暴露，推演不中断')
{
  const bench = DeductionBench.create()
  bench.registerFeature({ id: 'cyc-a', name: '山根', kind: 'nose', observation: '山根起伏', dependsOn: ['cyc-b'] })
  bench.registerFeature({ id: 'cyc-b', name: '年寿', kind: 'nose', observation: '年寿明暗', dependsOn: ['cyc-a'] })
  bench.registerFeature({ id: 'lonely', name: '法令', kind: 'mouth', observation: '法令深长', dependsOn: ['ghost'] })
  bench.registerFeature({ id: 'host', name: '地阁', kind: 'mouth', observation: '地阁方圆' })
  bench.registerFeature({ id: 'ref-withdrawn', name: '奴仆', kind: 'mouth', observation: '奴仆宫陷', dependsOn: ['host'] })
  bench.registerFeature({ id: 'independent', name: '印堂', kind: 'forehead', observation: '印堂开阔' })
  bench.withdrawFeature('host')

  const { conclusions, issues } = bench.derivation
  const codes = issues.map((issue) => issue.code)
  check('闭环被标出且列出环路成员',
    codes.includes('dependency-cycle')
    && issues.some((issue) => issue.code === 'dependency-cycle'
      && issue.cyclePath?.includes('cyc-a') && issue.cyclePath?.includes('cyc-b')))
  check('闭环上的面纹被阻塞而非给出错误结论',
    conclusions['cyc-a'].status === 'blocked-cycle' && conclusions['cyc-a'].verdict === null
    && conclusions['cyc-b'].status === 'blocked-cycle' && conclusions['cyc-b'].verdict === null)
  check('指向缺失依赖被标出', issues.some((issue) => issue.code === 'dependency-missing'
    && issue.sourceId === 'lonely' && issue.relatedId === 'ghost'))
  check('指向缺失的面纹被阻塞', conclusions['lonely'].status === 'blocked-missing-dependency')
  check('指向已撤回依赖被标出', issues.some((issue) => issue.code === 'dependency-withdrawn'
    && issue.sourceId === 'ref-withdrawn' && issue.relatedId === 'host'))
  check('指向撤回的面纹被阻塞', conclusions['ref-withdrawn'].status === 'blocked-withdrawn-dependency')
  check('独立面纹照常推演（推演未被异常中断）', conclusions['independent'].status === 'ready')

  // 修复闭环后应能恢复推演，且与全量重推一致
  bench.updateFeatureDependencies('cyc-b', [])
  bench.restoreFeature('host')
  check('打破闭环并恢复撤回面纹后，闭环成员恢复就绪',
    bench.derivation.conclusions['cyc-a'].status === 'ready'
    && bench.derivation.conclusions['cyc-b'].status === 'ready')
  check('修复后的增量结果与全量重推一致', comparable(bench.derivation) === comparable(freshFullDerive(bench)))
}

// ---------- 场景 3：批注撤回后面纹结论收敛 ----------
console.log('\n[场景 3] 批注撤回后结论收敛，且每步与全量重推一致')
{
  const bench = DeductionBench.create()
  bench.registerFeature({ id: 'eye', name: '眼尾', kind: 'eye', observation: '眼尾上挑' })
  const a1 = bench.addAnnotation({ targetFeatureId: 'eye', author: '麻衣', opinion: '眼尾泛桃花，主情缘纠葛' })
  const a2 = bench.addAnnotation({ targetFeatureId: 'eye', author: '陈抟', opinion: '眼尾上挑入鬓，主贵人扶持' })

  check('两条矛盾批注并存时为 conflict-pending', bench.derivation.conclusions['eye'].status === 'conflict-pending')

  bench.withdrawAnnotation(a1.id)
  const converged = bench.derivation.conclusions['eye']
  check('撤回其一后收敛到剩余批注且结论就绪',
    converged.status === 'ready'
    && converged.annotationIds.length === 1
    && converged.annotationIds[0] === a2.id
    && (converged.verdict ?? '').includes('贵人扶持'))
  check('撤回后增量结果与全量重推一致', comparable(bench.derivation) === comparable(freshFullDerive(bench)))

  bench.withdrawAnnotation(a2.id)
  const reverted = bench.derivation.conclusions['eye']
  check('全部批注撤回后回到规则基准判词',
    reverted.status === 'ready'
    && reverted.annotationIds.length === 0
    && (reverted.verdict ?? '').includes('眼尾微挑'))
  check('再次与全量重推一致', comparable(bench.derivation) === comparable(freshFullDerive(bench)))

  // 裁决后撤回被裁决批注：裁决失效需显式暴露，结论回到待裁决/基准
  const a3 = bench.addAnnotation({ targetFeatureId: 'eye', author: '麻衣', opinion: '眼尾藏锋，主晚景清贵' })
  const a4 = bench.addAnnotation({ targetFeatureId: 'eye', author: '陈抟', opinion: '眼尾散财，主破耗连连' })
  bench.adjudicate('eye', a3.id, '以藏锋为断')
  check('裁决后结论采纳被裁决批注', bench.derivation.conclusions['eye'].adjudicatedAnnotationId === a3.id)
  bench.withdrawAnnotation(a3.id)
  const afterWithdraw = bench.derivation
  check('被裁决批注撤回后裁决失效并显式暴露',
    afterWithdraw.issues.some((issue) => issue.code === 'annotation-withdrawn-adjudicated'
      && issue.relatedId === a3.id))
  check('撤回被裁决批注后收敛到唯一剩余批注',
    afterWithdraw.conclusions['eye'].status === 'ready'
    && afterWithdraw.conclusions['eye'].annotationIds.length === 1
    && afterWithdraw.conclusions['eye'].annotationIds[0] === a4.id
    && (afterWithdraw.conclusions['eye'].verdict ?? '').includes('破耗连连'))
  check('与全量重推一致', comparable(afterWithdraw) === comparable(freshFullDerive(bench)))
}

// ---------- 场景 4：孤儿批注显式暴露 ----------
console.log('\n[场景 4] 批注指向不存在 / 已撤回面纹时不被静默跳过')
{
  const bench = DeductionBench.create()
  bench.registerFeature({ id: 'mouth', name: '唇口', kind: 'mouth', observation: '唇形端正' })
  bench.addAnnotation({ targetFeatureId: 'nowhere', author: '柳庄', opinion: '此处当有悬针纹' })
  bench.withdrawFeature('mouth')
  bench.addAnnotation({ targetFeatureId: 'mouth', author: '袁天罡', opinion: '唇角下垂，主晚运多舛' })

  const { issues, conclusions } = bench.derivation
  check('指向不存在面纹的批注被显式暴露',
    issues.some((issue) => issue.code === 'annotation-target-missing' && issue.relatedId === 'nowhere'))
  check('指向已撤回面纹的批注被显式暴露',
    issues.some((issue) => issue.code === 'annotation-target-withdrawn' && issue.relatedId === 'mouth'))
  check('已撤回面纹不产出结论', conclusions['mouth'] === undefined)
  check('孤儿批注不影响其余推演（与全量重推一致）',
    comparable(bench.derivation) === comparable(freshFullDerive(bench)))
}

// ---------- 场景 5：导出 / 载入一致性 ----------
console.log('\n[场景 5] 批注、裁决、依赖推演结果随结论导出，重新载入后保持一致')
{
  const bench = DeductionBench.create()
  bench.registerFeature({ id: 'nose', name: '鼻准', kind: 'nose', observation: '鼻准丰隆' })
  bench.registerFeature({ id: 'forehead', name: '印堂', kind: 'forehead', observation: '天庭饱满', dependsOn: ['nose'] })
  const x = bench.addAnnotation({ targetFeatureId: 'nose', author: '麻衣', opinion: '鼻有节，主中年波折' })
  bench.addAnnotation({ targetFeatureId: 'nose', author: '陈抟', opinion: '鼻直如筒，主一生顺遂' })
  bench.adjudicate('nose', x.id, '以鼻节为验')

  const bundle = bench.exportBundle('2026-10-07T00:00:00.000Z')
  check('导出包包含批注与裁决', bundle.annotations.length === 2 && bundle.adjudications.length === 1)
  check('导出包包含依赖推演结果与依据',
    bundle.derivation.conclusions['forehead'].basis.some((b) => b.kind === 'dependency'))

  const restored = DeductionBench.importBundle(JSON.parse(JSON.stringify(bundle)))
  check('重新载入后推演结果与导出时一致',
    comparable(restored.derivation) === comparable(bench.derivation))
  check('重新载入后裁决仍然生效',
    restored.derivation.conclusions['nose'].adjudicatedAnnotationId === x.id)
  check('重新载入后仍可继续增量推演且与全量一致',
    (() => {
      restored.addAnnotation({ targetFeatureId: 'forehead', author: '柳庄', opinion: '印堂明润，主近日有喜' })
      return comparable(restored.derivation) === comparable(freshFullDerive(restored))
    })())
}

console.log(failures === 0 ? '\n全部验证通过 ✔' : `\n${failures} 项验证失败 ✘`)
process.exit(failures === 0 ? 0 : 1)
