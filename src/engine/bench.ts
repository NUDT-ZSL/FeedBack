// 推演台：承接录入、批注、裁决、撤回等操作，并在每次变更后
// 只对受影响的面纹做增量重推。所有状态可整体导出 / 载入。

import { deriveAll, deriveIncremental, type DeriveState } from './derive.ts'
import type {
  Adjudication,
  Annotation,
  ArchiveBundle,
  DerivationResult,
  FeatureRecord,
} from './types.ts'

export interface BenchSnapshot {
  features: FeatureRecord[]
  annotations: Annotation[]
  adjudications: Adjudication[]
  derivation: DerivationResult
}

export class DeductionBench {
  private features: FeatureRecord[]
  private annotations: Annotation[]
  private adjudications: Adjudication[]
  private result: DerivationResult
  private seq: number

  private constructor(
    features: FeatureRecord[],
    annotations: Annotation[],
    adjudications: Adjudication[],
  ) {
    this.features = features
    this.annotations = annotations
    this.adjudications = adjudications
    this.seq = Math.max(
      0,
      ...features.map((item) => item.seq),
      ...annotations.map((item) => item.seq),
      ...adjudications.map((item) => item.seq),
    )
    this.result = deriveAll(this.state(), 1)
  }

  static create(): DeductionBench {
    return new DeductionBench([], [], [])
  }

  private state(): DeriveState {
    return {
      features: this.features,
      annotations: this.annotations,
      adjudications: this.adjudications,
    }
  }

  private nextSeq(): number {
    this.seq += 1
    return this.seq
  }

  /** 变更后增量重推：dirtySeeds 为直接受影响的面纹 id */
  private recompute(dirtySeeds: string[]): void {
    this.result = deriveIncremental(this.state(), this.result, new Set(dirtySeeds))
  }

  // ---------- 录入（既有路径，保持不变） ----------

  registerFeature(input: {
    id: string
    name: string
    kind: string
    observation: string
    dependsOn?: string[]
  }): FeatureRecord {
    if (this.features.some((feature) => feature.id === input.id)) {
      throw new Error(`面纹「${input.id}」已存在`)
    }
    const feature: FeatureRecord = {
      id: input.id,
      name: input.name,
      kind: input.kind,
      observation: input.observation,
      dependsOn: [...(input.dependsOn ?? [])].sort(),
      withdrawn: false,
      seq: this.nextSeq(),
    }
    this.features.push(feature)
    // 新面纹自身要推演；引用它的既有面纹（若有）也要重推。
    const referrers = this.features
      .filter((item) => item.id !== feature.id && item.dependsOn.includes(feature.id))
      .map((item) => item.id)
    this.recompute([feature.id, ...referrers])
    return feature
  }

  withdrawFeature(featureId: string): void {
    const feature = this.features.find((item) => item.id === featureId)
    if (!feature) throw new Error(`面纹「${featureId}」不存在`)
    if (feature.withdrawn) return
    feature.withdrawn = true
    this.recompute([featureId])
  }

  /** 修正面纹的推导依赖引用（用于打破闭环、改接缺失引用等） */
  updateFeatureDependencies(featureId: string, dependsOn: string[]): void {
    const feature = this.features.find((item) => item.id === featureId)
    if (!feature) throw new Error(`面纹「${featureId}」不存在`)
    feature.dependsOn = [...new Set(dependsOn)].sort()
    this.recompute([featureId])
  }

  restoreFeature(featureId: string): void {
    const feature = this.features.find((item) => item.id === featureId)
    if (!feature) throw new Error(`面纹「${featureId}」不存在`)
    if (!feature.withdrawn) return
    feature.withdrawn = false
    this.recompute([featureId])
  }

  // ---------- 批注（可在结论生成后补录 / 撤回） ----------

  /** 批注一律落档；指向缺失或已撤回面纹的批注会在推演结果中显式暴露 */
  addAnnotation(input: { targetFeatureId: string; author: string; opinion: string }): Annotation {
    const annotation: Annotation = {
      id: `anno-${this.nextSeq()}`,
      targetFeatureId: input.targetFeatureId,
      author: input.author,
      opinion: input.opinion,
      withdrawn: false,
      seq: this.seq,
    }
    this.annotations.push(annotation)
    this.recompute([input.targetFeatureId])
    return annotation
  }

  withdrawAnnotation(annotationId: string): void {
    const annotation = this.annotations.find((item) => item.id === annotationId)
    if (!annotation) throw new Error(`批注「${annotationId}」不存在`)
    if (annotation.withdrawn) return
    annotation.withdrawn = true
    this.recompute([annotation.targetFeatureId])
  }

  // ---------- 裁决 ----------

  adjudicate(featureId: string, chosenAnnotationId: string, note = ''): Adjudication {
    const chosen = this.annotations.find((item) => item.id === chosenAnnotationId)
    if (!chosen || chosen.withdrawn || chosen.targetFeatureId !== featureId) {
      throw new Error(`批注「${chosenAnnotationId}」不是面纹「${featureId}」的活跃批注，无法裁决`)
    }
    const existing = this.adjudications.find((item) => item.featureId === featureId)
    if (existing) {
      existing.chosenAnnotationId = chosenAnnotationId
      existing.note = note
      existing.seq = this.nextSeq()
      this.recompute([featureId])
      return existing
    }
    const adjudication: Adjudication = {
      featureId,
      chosenAnnotationId,
      note,
      seq: this.nextSeq(),
    }
    this.adjudications.push(adjudication)
    this.recompute([featureId])
    return adjudication
  }

  clearAdjudication(featureId: string): void {
    const index = this.adjudications.findIndex((item) => item.featureId === featureId)
    if (index < 0) return
    this.adjudications.splice(index, 1)
    this.recompute([featureId])
  }

  // ---------- 读取 / 落档 ----------

  snapshot(): BenchSnapshot {
    return {
      features: this.features.map((item) => ({ ...item, dependsOn: [...item.dependsOn] })),
      annotations: this.annotations.map((item) => ({ ...item })),
      adjudications: this.adjudications.map((item) => ({ ...item })),
      derivation: this.result,
    }
  }

  get derivation(): DerivationResult {
    return this.result
  }

  /** 导出：批注、裁决、依赖推演结果随结论一起打包 */
  exportBundle(exportedAt = new Date().toISOString()): ArchiveBundle {
    const snap = this.snapshot()
    return {
      format: 'xiangmian-ge-bench/v1',
      exportedAt,
      features: snap.features,
      annotations: snap.annotations,
      adjudications: snap.adjudications,
      derivation: snap.derivation,
    }
  }

  /** 载入：恢复全部状态并重推，保证与导出时的推演结果一致 */
  static importBundle(bundle: ArchiveBundle): DeductionBench {
    if (bundle.format !== 'xiangmian-ge-bench/v1') {
      throw new Error(`无法识别的档案格式：${bundle.format}`)
    }
    const bench = new DeductionBench(
      bundle.features.map((item) => ({ ...item, dependsOn: [...item.dependsOn] })),
      bundle.annotations.map((item) => ({ ...item })),
      bundle.adjudications.map((item) => ({ ...item })),
    )
    return bench
  }
}
