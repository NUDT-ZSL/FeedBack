import { useMemo, useRef, useState } from 'react'
import { DeductionBench } from '@/engine/bench'
import { LocalStorageArchiveStore, restoreBundle } from '@/engine/archive'
import type { Annotation, BenchIssue, Conclusion, FeatureRecord } from '@/engine/types'

const KIND_OPTIONS = [
  { value: 'forehead', label: '天庭（额头）' },
  { value: 'brow', label: '眉宇' },
  { value: 'eye', label: '眼尾' },
  { value: 'nose', label: '鼻准' },
  { value: 'mouth', label: '唇口' },
  { value: 'ear', label: '耳轮' },
]

const STATUS_LABEL: Record<Conclusion['status'], string> = {
  ready: '已推演',
  'conflict-pending': '待裁决',
  'blocked-cycle': '闭环阻塞',
  'blocked-missing-dependency': '依赖缺失',
  'blocked-withdrawn-dependency': '依赖已撤回',
}

const STATUS_COLOR: Record<Conclusion['status'], string> = {
  ready: 'bg-emerald-100 text-emerald-800',
  'conflict-pending': 'bg-amber-100 text-amber-800',
  'blocked-cycle': 'bg-rose-100 text-rose-800',
  'blocked-missing-dependency': 'bg-rose-100 text-rose-800',
  'blocked-withdrawn-dependency': 'bg-rose-100 text-rose-800',
}

function loadInitialBench(): DeductionBench {
  const stored = restoreBundle(new LocalStorageArchiveStore())
  if (stored) {
    try {
      return DeductionBench.importBundle(stored)
    } catch {
      // 落档损坏时回到空推演台，不阻断使用
    }
  }
  return DeductionBench.create()
}

export default function Home() {
  const benchRef = useRef<DeductionBench | null>(null)
  if (!benchRef.current) benchRef.current = loadInitialBench()
  const bench = benchRef.current
  const store = useMemo(() => new LocalStorageArchiveStore(), [])
  const [, setTick] = useState(0)

  const [featureForm, setFeatureForm] = useState({ id: '', name: '', kind: 'forehead', observation: '', dependsOn: '' })
  const [annotationForm, setAnnotationForm] = useState({ target: '', author: '', opinion: '' })
  const [error, setError] = useState('')

  const commit = (fn: () => void) => {
    try {
      setError('')
      fn()
      store.save(benchRef.current!.exportBundle())
      setTick((tick) => tick + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const snap = bench.snapshot()
  const derivation = snap.derivation
  const conclusions = Object.values(derivation.conclusions)
  const activeFeatures = snap.features.filter((feature) => !feature.withdrawn)
  const activeAnnotations = snap.annotations.filter((annotation) => !annotation.withdrawn)

  const exportFile = () => {
    const blob = new Blob([JSON.stringify(bench.exportBundle(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `xiangmian-bench-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const importFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      commit(() => {
        const bundle = JSON.parse(String(reader.result))
        benchRef.current = DeductionBench.importBundle(bundle)
      })
    }
    reader.readAsText(file)
  }

  return (
    <div className="min-h-screen bg-[#f5ecd7] text-[#2c2c2c] p-6 font-serif">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">相面阁 · 推演台</h1>
        <p className="text-sm opacity-70">
          面纹结论可挂载多位相士的批注；冲突不静默择一，由人裁决；每次变更只重推受影响面纹。
        </p>
      </header>

      {error && <div className="mb-4 rounded border border-rose-400 bg-rose-50 px-3 py-2 text-rose-800">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-lg bg-[#fbf6e9] p-4 shadow">
          <h2 className="mb-3 text-xl font-semibold">面纹录入</h2>
          <div className="flex flex-col gap-2 text-sm">
            <input className="rounded border px-2 py-1" placeholder="面纹 id，如 yintang" value={featureForm.id}
              onChange={(e) => setFeatureForm({ ...featureForm, id: e.target.value.trim() })} />
            <input className="rounded border px-2 py-1" placeholder="名称，如 印堂" value={featureForm.name}
              onChange={(e) => setFeatureForm({ ...featureForm, name: e.target.value })} />
            <select className="rounded border px-2 py-1" value={featureForm.kind}
              onChange={(e) => setFeatureForm({ ...featureForm, kind: e.target.value })}>
              {KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <input className="rounded border px-2 py-1" placeholder="观测依据，如 天庭饱满、眉间距宽" value={featureForm.observation}
              onChange={(e) => setFeatureForm({ ...featureForm, observation: e.target.value })} />
            <input className="rounded border px-2 py-1" placeholder="推导依赖的面纹 id（逗号分隔，可空）" value={featureForm.dependsOn}
              onChange={(e) => setFeatureForm({ ...featureForm, dependsOn: e.target.value })} />
            <button className="rounded bg-[#2e4a32] px-3 py-1.5 text-white hover:opacity-90"
              onClick={() => commit(() => {
                bench.registerFeature({
                  id: featureForm.id,
                  name: featureForm.name || featureForm.id,
                  kind: featureForm.kind,
                  observation: featureForm.observation,
                  dependsOn: featureForm.dependsOn.split(/[,，]/).map((id) => id.trim()).filter(Boolean),
                })
                setFeatureForm({ id: '', name: '', kind: featureForm.kind, observation: '', dependsOn: '' })
              })}>录入面纹</button>
          </div>

          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {snap.features.map((feature: FeatureRecord) => (
              <li key={feature.id} className="rounded border bg-white/60 px-2 py-1.5">
                <div className="flex items-center justify-between">
                  <span className={feature.withdrawn ? 'line-through opacity-50' : ''}>
                    {feature.name}（{feature.id}）
                  </span>
                  {feature.withdrawn ? (
                    <button className="text-emerald-700 underline" onClick={() => commit(() => bench.restoreFeature(feature.id))}>恢复</button>
                  ) : (
                    <button className="text-rose-700 underline" onClick={() => commit(() => bench.withdrawFeature(feature.id))}>撤回</button>
                  )}
                </div>
                {feature.dependsOn.length > 0 && <div className="text-xs opacity-60">依赖：{feature.dependsOn.join('、')}</div>}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg bg-[#fbf6e9] p-4 shadow">
          <h2 className="mb-3 text-xl font-semibold">相士批注</h2>
          <div className="flex flex-col gap-2 text-sm">
            <input className="rounded border px-2 py-1" placeholder="目标面纹 id（可填不存在的 id 以检验暴露）" value={annotationForm.target}
              onChange={(e) => setAnnotationForm({ ...annotationForm, target: e.target.value.trim() })} />
            <input className="rounded border px-2 py-1" placeholder="相士名号，如 柳庄" value={annotationForm.author}
              onChange={(e) => setAnnotationForm({ ...annotationForm, author: e.target.value })} />
            <input className="rounded border px-2 py-1" placeholder="批注意见" value={annotationForm.opinion}
              onChange={(e) => setAnnotationForm({ ...annotationForm, opinion: e.target.value })} />
            <button className="rounded bg-[#2e4a32] px-3 py-1.5 text-white hover:opacity-90"
              onClick={() => commit(() => {
                bench.addAnnotation({
                  targetFeatureId: annotationForm.target,
                  author: annotationForm.author || '无名氏',
                  opinion: annotationForm.opinion,
                })
                setAnnotationForm({ target: '', author: '', opinion: '' })
              })}>补录批注</button>
          </div>

          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {snap.annotations.map((annotation: Annotation) => (
              <li key={annotation.id} className="rounded border bg-white/60 px-2 py-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={annotation.withdrawn ? 'line-through opacity-50' : ''}>
                    「{annotation.author}」→ {annotation.targetFeatureId}：{annotation.opinion}
                  </span>
                  {!annotation.withdrawn && (
                    <button className="shrink-0 text-rose-700 underline"
                      onClick={() => commit(() => bench.withdrawAnnotation(annotation.id))}>撤回</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg bg-[#fbf6e9] p-4 shadow">
          <h2 className="mb-3 text-xl font-semibold">推演结论（v{derivation.version}）</h2>
          <ul className="flex flex-col gap-3 text-sm">
            {conclusions.map((conclusion) => {
              const feature = activeFeatures.find((item) => item.id === conclusion.featureId)
              return (
                <li key={conclusion.featureId} className="rounded border bg-white/60 px-3 py-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-semibold">{feature?.name ?? conclusion.featureId}</span>
                    <span className={`rounded px-2 py-0.5 text-xs ${STATUS_COLOR[conclusion.status]}`}>
                      {STATUS_LABEL[conclusion.status]}
                    </span>
                  </div>
                  {conclusion.verdict && <p className="mb-1">{conclusion.verdict}</p>}
                  <ul className="mb-1 list-inside list-disc text-xs opacity-70">
                    {conclusion.basis.map((entry, index) => <li key={index}>{entry.text}</li>)}
                  </ul>
                  {conclusion.status === 'conflict-pending' && (
                    <div className="mt-2 flex flex-col gap-1">
                      {activeAnnotations
                        .filter((annotation) => annotation.targetFeatureId === conclusion.featureId)
                        .map((annotation) => (
                          <button key={annotation.id}
                            className="rounded border border-amber-500 bg-amber-50 px-2 py-1 text-left text-xs hover:bg-amber-100"
                            onClick={() => commit(() => bench.adjudicate(conclusion.featureId, annotation.id, '推演台裁决'))}>
                            采纳「{annotation.author}」：{annotation.opinion}
                          </button>
                        ))}
                    </div>
                  )}
                </li>
              )
            })}
            {conclusions.length === 0 && <li className="text-sm opacity-60">尚未录入面纹。</li>}
          </ul>

          {derivation.issues.length > 0 && (
            <div className="mt-4 rounded border border-rose-300 bg-rose-50 p-3">
              <h3 className="mb-2 font-semibold text-rose-800">推演台暴露的问题</h3>
              <ul className="list-inside list-disc text-xs text-rose-800">
                {derivation.issues.map((issue: BenchIssue, index: number) => <li key={index}>{issue.text}</li>)}
              </ul>
            </div>
          )}

          <div className="mt-4 flex gap-2 text-sm">
            <button className="rounded bg-[#c0392b] px-3 py-1.5 text-white hover:opacity-90" onClick={exportFile}>导出档案</button>
            <label className="cursor-pointer rounded border border-[#2e4a32] px-3 py-1.5 hover:bg-[#2e4a32]/10">
              载入档案
              <input type="file" accept="application/json" className="hidden"
                onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
            </label>
          </div>
        </section>
      </div>
    </div>
  )
}
