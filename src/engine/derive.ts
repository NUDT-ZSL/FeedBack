// 推演核心：同一套“单条面纹推导”逻辑同时服务于全量重推与增量重推，
// 因此对任一受影响面纹集合，增量结果都与从零全量重推完全一致。
//
// 结构异常（闭环 / 指向缺失 / 指向撤回）与冲突待裁决均以结论状态和问题列表返回，
// 任何分支都不抛异常，也不会产出错误判词。

import { analyzeGraph, dependentClosure, derivationOrder, type GraphNode } from './graph.ts'
import { applyRule } from './rules.ts'
import type {
  Adjudication,
  Annotation,
  BasisEntry,
  BenchIssue,
  Conclusion,
  DerivationResult,
  FeatureRecord,
} from './types.ts'

export interface DeriveState {
  features: FeatureRecord[]
  annotations: Annotation[]
  adjudications: Adjudication[]
}

interface SortedState {
  activeFeatures: Map<string, FeatureRecord>
  graphNodes: GraphNode[]
  annotationsByTarget: Map<string, Annotation[]>
  adjudicationByFeature: Map<string, Adjudication>
  problems: ReturnType<typeof analyzeGraph>
}

function prepare(state: DeriveState): SortedState {
  const activeFeatures = new Map<string, FeatureRecord>()
  for (const feature of [...state.features].sort(byId)) {
    if (!feature.withdrawn) activeFeatures.set(feature.id, feature)
  }

  // 依赖图包含全部面纹（含已撤回），才能区分“指向缺失”与“指向已撤回”。
  const graphNodes = [...state.features].sort(byId).map((feature) => ({
    id: feature.id,
    withdrawn: feature.withdrawn,
    dependsOn: [...new Set(feature.dependsOn)].sort(),
  }))
  const problems = analyzeGraph(graphNodes)

  const annotationsByTarget = new Map<string, Annotation[]>()
  for (const annotation of [...state.annotations].sort(bySeq)) {
    if (annotation.withdrawn) continue
    const list = annotationsByTarget.get(annotation.targetFeatureId)
    if (list) list.push(annotation)
    else annotationsByTarget.set(annotation.targetFeatureId, [annotation])
  }

  const adjudicationByFeature = new Map<string, Adjudication>()
  for (const adjudication of [...state.adjudications].sort(bySeq)) {
    adjudicationByFeature.set(adjudication.featureId, adjudication)
  }

  return { activeFeatures, graphNodes, annotationsByTarget, adjudicationByFeature, problems }
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
function bySeq<T extends { seq: number }>(a: T, b: T): number {
  return a.seq - b.seq
}

/** 活跃批注指向的面纹不存在 / 已撤回等问题，在每次推演时全量显式暴露 */
function collectIssues(
  state: DeriveState,
  sorted: SortedState,
): BenchIssue[] {
  const issues: BenchIssue[] = []
  const allFeatures = new Map(state.features.map((feature) => [feature.id, feature]))

  for (const annotation of [...state.annotations].sort(bySeq)) {
    const target = allFeatures.get(annotation.targetFeatureId)
    if (!target) {
      issues.push({
        code: 'annotation-target-missing',
        sourceId: annotation.id,
        relatedId: annotation.targetFeatureId,
        text: `批注「${annotation.id}」（相士${annotation.author}）指向的面纹「${annotation.targetFeatureId}」不存在，未参与推演`,
      })
    } else if (target.withdrawn) {
      issues.push({
        code: 'annotation-target-withdrawn',
        sourceId: annotation.id,
        relatedId: annotation.targetFeatureId,
        text: `批注「${annotation.id}」（相士${annotation.author}）指向的面纹「${target.name}」已撤回，未参与推演`,
      })
    }
  }

  for (const edge of sorted.problems.missingEdges) {
    issues.push({
      code: 'dependency-missing',
      sourceId: edge.source,
      relatedId: edge.missing,
      text: `面纹「${edge.source}」引用的依赖面纹「${edge.missing}」缺失，该面纹推演被阻塞`,
    })
  }
  for (const edge of sorted.problems.withdrawnEdges) {
    issues.push({
      code: 'dependency-withdrawn',
      sourceId: edge.source,
      relatedId: edge.withdrawn,
      text: `面纹「${edge.source}」引用的依赖面纹「${edge.withdrawn}」已撤回，该面纹推演被阻塞`,
    })
  }
  for (const cycle of sorted.problems.cycles) {
    issues.push({
      code: 'dependency-cycle',
      sourceId: cycle[0],
      cyclePath: cycle,
      text: `面纹引用出现闭环：${cycle.join(' → ')} → ${cycle[0]}，闭环上的面纹均无法推出结论`,
    })
  }

  // 裁决指向的批注若已撤回，裁决失效并显式暴露。
  for (const adjudication of [...state.adjudications].sort(bySeq)) {
    const chosen = state.annotations.find((annotation) => annotation.id === adjudication.chosenAnnotationId)
    if (!chosen || chosen.withdrawn) {
      issues.push({
        code: 'annotation-withdrawn-adjudicated',
        sourceId: adjudication.featureId,
        relatedId: adjudication.chosenAnnotationId,
        text: `面纹「${adjudication.featureId}」裁决采纳的批注「${adjudication.chosenAnnotationId}」已撤回，裁决失效，需重新裁决`,
      })
    }
  }

  return issues
}

type LookupConclusion = (featureId: string) => Conclusion | undefined

function blockedConclusion(
  feature: FeatureRecord,
  status: Conclusion['status'],
  basis: BasisEntry[],
): Conclusion {
  return {
    featureId: feature.id,
    status,
    verdict: null,
    basis,
    annotationIds: [],
    adjudicatedAnnotationId: null,
  }
}

/** 单条面纹推导。全量与增量走同一份代码，这是结果一致性的根。 */
function deriveOne(feature: FeatureRecord, sorted: SortedState, lookup: LookupConclusion): Conclusion {
  const { missingEdges, withdrawnEdges, cycleNodes } = sorted.problems

  const missing = missingEdges
    .filter((edge) => edge.source === feature.id)
    .map((edge) => edge.missing)
  if (missing.length > 0) {
    return blockedConclusion(feature, 'blocked-missing-dependency', [
      { kind: 'feature', refId: feature.id, text: `面纹：${feature.name}` },
      {
        kind: 'reason',
        text: `依赖面纹缺失（${missing.join('、')}），无法推演，待补录或修正引用`,
      },
    ])
  }

  const withdrawnDeps = withdrawnEdges
    .filter((edge) => edge.source === feature.id)
    .map((edge) => edge.withdrawn)
  if (withdrawnDeps.length > 0) {
    return blockedConclusion(feature, 'blocked-withdrawn-dependency', [
      { kind: 'feature', refId: feature.id, text: `面纹：${feature.name}` },
      {
        kind: 'reason',
        text: `依赖面纹已撤回（${withdrawnDeps.join('、')}），无法推演，待恢复或改接引用`,
      },
    ])
  }

  if (cycleNodes.has(feature.id)) {
    return blockedConclusion(feature, 'blocked-cycle', [
      { kind: 'feature', refId: feature.id, text: `面纹：${feature.name}` },
      { kind: 'reason', text: `该面纹处于互相引用的闭环上，不能推出结论，须先打破闭环` },
    ])
  }

  // 依赖必须全部就绪；上游任意非就绪状态沿依赖链向下传播，绝不拿空值硬推。
  for (const depId of feature.dependsOn) {
    const depConclusion = lookup(depId)
    if (!depConclusion || depConclusion.status !== 'ready') {
      const depFeature = sorted.activeFeatures.get(depId)
      const reason = depConclusion
        ? `依赖面纹「${depFeature?.name ?? depId}」尚未推出结论（${depConclusion.status}）`
        : `依赖面纹「${depId}」尚未推演`
      return blockedConclusion(feature, depConclusion?.status ?? 'blocked-cycle', [
        { kind: 'feature', refId: feature.id, text: `面纹：${feature.name}` },
        { kind: 'dependency', refId: depId, text: reason },
      ])
    }
  }

  const activeAnnotations = (sorted.annotationsByTarget.get(feature.id) ?? []).slice().sort(bySeq)
  const distinctOpinions = [...new Set(activeAnnotations.map((annotation) => annotation.opinion))].sort()

  const adjudication = sorted.adjudicationByFeature.get(feature.id)
  const chosenActive =
    adjudication && activeAnnotations.some((annotation) => annotation.id === adjudication.chosenAnnotationId)
      ? activeAnnotations.find((annotation) => annotation.id === adjudication.chosenAnnotationId)!
      : null

  if (!chosenActive && distinctOpinions.length > 1) {
    // 多条批注互相矛盾且尚无有效裁决：双方都保留，不静默择一。
    return blockedConclusion(feature, 'conflict-pending', [
      { kind: 'feature', refId: feature.id, text: `面纹：${feature.name}` },
      {
        kind: 'reason',
        text: `存在 ${activeAnnotations.length} 条互相矛盾的批注（${distinctOpinions.length} 种意见），等待相士裁决，不自动择取`,
      },
      ...activeAnnotations.map((annotation) => ({
        kind: 'annotation' as const,
        refId: annotation.id,
        text: `待裁决批注·相士「${annotation.author}」：${annotation.opinion}`,
      })),
    ])
  }

  const effectiveAnnotations = chosenActive ? [chosenActive] : activeAnnotations
  const depVerdicts = feature.dependsOn.map((depId) => {
    const depConclusion = lookup(depId)!
    const depFeature = sorted.activeFeatures.get(depId)!
    return { depId, depName: depFeature.name, verdict: depConclusion.verdict! }
  })

  const output = applyRule(feature.kind, {
    featureId: feature.id,
    featureName: feature.name,
    depVerdicts,
    opinions: effectiveAnnotations.map((annotation) => ({
      annotationId: annotation.id,
      author: annotation.author,
      opinion: annotation.opinion,
    })),
  })

  const basis = output.basis.slice()
  if (chosenActive && adjudication) {
    basis.push({
      kind: 'adjudication',
      refId: chosenActive.id,
      text: `经裁决采纳相士「${chosenActive.author}」之批注${adjudication.note ? `：${adjudication.note}` : ''}，其余冲突批注不参与本结论`,
    })
  }

  return {
    featureId: feature.id,
    status: 'ready',
    verdict: output.verdict,
    basis,
    annotationIds: effectiveAnnotations.map((annotation) => annotation.id),
    adjudicatedAnnotationId: chosenActive ? chosenActive.id : null,
  }
}

/** 从零全量推演 */
export function deriveAll(state: DeriveState, version: number): DerivationResult {
  const sorted = prepare(state)
  const conclusions = new Map<string, Conclusion>()
  const lookup: LookupConclusion = (id) => conclusions.get(id)

  for (const id of derivationOrder(sorted.graphNodes, sorted.problems.cycleNodes)) {
    const feature = sorted.activeFeatures.get(id)
    if (feature) conclusions.set(id, deriveOne(feature, sorted, lookup))
  }

  return {
    conclusions: Object.fromEntries([...conclusions.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    issues: collectIssues(state, sorted),
    version,
  }
}

/**
 * 增量推演：只重推 dirtySeeds 及其传递依赖者（受影响面纹闭包）。
 * 未受影响的结论对象原样复用；重推部分与 deriveAll 完全相同。
 */
export function deriveIncremental(
  state: DeriveState,
  previous: DerivationResult,
  dirtySeeds: Set<string>,
): DerivationResult {
  const sorted = prepare(state)

  const activeNodes = sorted.graphNodes.filter((node) => !node.withdrawn)
  const affected = dependentClosure(activeNodes, dirtySeeds)
  // 已不存在 / 已撤回的种子没有结论，但它们的引用者要重推（闭包已覆盖）。
  for (const staleId of dirtySeeds) {
    if (!sorted.activeFeatures.has(staleId)) affected.delete(staleId)
  }

  const conclusions = new Map<string, Conclusion>()
  for (const [id, conclusion] of Object.entries(previous.conclusions)) {
    // 已撤回 / 已删除的面纹结论不得残留；未受影响的活跃面纹原样复用。
    if (!affected.has(id) && sorted.activeFeatures.has(id)) conclusions.set(id, conclusion)
  }
  const lookup: LookupConclusion = (id) => conclusions.get(id)

  for (const id of derivationOrder(sorted.graphNodes, sorted.problems.cycleNodes)) {
    if (!affected.has(id)) continue
    const feature = sorted.activeFeatures.get(id)
    if (feature) conclusions.set(id, deriveOne(feature, sorted, lookup))
  }

  return {
    conclusions: Object.fromEntries([...conclusions.entries()].sort(([a], [b]) => (a < b ? -1 : 1))),
    issues: collectIssues(state, sorted),
    version: previous.version + 1,
  }
}
