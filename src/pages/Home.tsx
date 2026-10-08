import { useEffect, useState } from 'react'
import { PROCESS_STAGES } from '@/workshop/types'
import { useWorkshopStore } from '@/store/useWorkshopStore'

const PANEL_CLASS = 'rounded-lg border border-[#c9a96e]/40 bg-[#f5f0e8] p-4 shadow'

export default function Home() {
  const {
    books,
    selectedBookId,
    snapshot,
    records,
    movements,
    lastResult,
    loadBooks,
    selectBook,
    submit,
  } = useWorkshopStore()

  const [materialId, setMaterialId] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [stage, setStage] = useState<(typeof PROCESS_STAGES)[number]>('清点')
  const [content, setContent] = useState('')

  useEffect(() => {
    loadBooks()
  }, [loadBooks])

  useEffect(() => {
    if (!materialId && snapshot?.materials[0]) setMaterialId(snapshot.materials[0].id)
  }, [snapshot, materialId])

  const currentMaterial = snapshot?.materials.find((material) => material.id === materialId)
  const checkedOut =
    movements
      .filter((movement) => movement.materialId === materialId)
      .reduce((sum, movement) => sum - movement.delta, 0) ?? 0

  return (
    <div className="min-h-screen bg-[#3c2a1a] px-6 py-8 text-[#3a3a3a]">
      <header className="mx-auto mb-6 max-w-6xl">
        <h1 className="text-3xl font-semibold text-[#f5f0e8]">古籍修复工坊</h1>
        <p className="mt-1 text-sm text-[#c9a96e]">
          工序推进 · 材料领用 · 修复记录 —— 共享同一份可追溯状态
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {books.map((book) => (
            <button
              key={book.id}
              onClick={() => selectBook(book.id)}
              className={`rounded px-3 py-1.5 text-sm transition ${
                book.id === selectedBookId
                  ? 'bg-[#c9a96e] text-[#3c2a1a]'
                  : 'bg-[#f5f0e8]/15 text-[#f5f0e8] hover:bg-[#f5f0e8]/25'
              }`}
            >
              {book.title}
            </button>
          ))}
        </div>
      </header>

      {snapshot && (
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="flex flex-wrap items-center gap-4 rounded-lg bg-[#f5f0e8]/10 px-4 py-2 text-sm text-[#f5f0e8]">
            <span>
              当前工序：<strong>{snapshot.progress.currentStage ?? '未开工'}</strong>
            </span>
            <span>
              已完成工序：{snapshot.progress.completedStages}/{snapshot.progress.totalStages}
            </span>
            <span>记录条数：{snapshot.recordCount}</span>
            <span>状态版本：{snapshot.version}</span>
            <span className="ml-auto">冲突记录：{snapshot.conflicts.length} 条</span>
          </div>

          {lastResult && (
            <div
              className={`rounded px-4 py-2 text-sm ${
                lastResult.tone === 'conflict'
                  ? 'bg-[#7b241c] text-[#f5f0e8]'
                  : lastResult.tone === 'error'
                    ? 'bg-[#5c2a1f] text-[#f5f0e8]'
                    : 'bg-[#d9c9a3] text-[#3a3a3a]'
              }`}
            >
              {lastResult.text}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-3">
            <section className={PANEL_CLASS}>
              <h2 className="mb-3 text-lg font-semibold text-[#8b5a2b]">工序列表</h2>
              <ol className="mb-3 space-y-1 text-sm">
                {PROCESS_STAGES.map((name, index) => {
                  const reached = index <= snapshot.progress.completedStages
                  const current = name === snapshot.progress.currentStage
                  return (
                    <li
                      key={name}
                      className={`flex items-center gap-2 rounded px-2 py-1 ${
                        current ? 'bg-[#c9a96e]/40 font-semibold' : reached ? 'text-[#6d4c2a]' : 'text-[#9c8b74]'
                      }`}
                    >
                      <span>{index + 1}</span>
                      <span>{name}</span>
                      {current && <span className="ml-auto text-xs">进行中</span>}
                    </li>
                  )
                })}
              </ol>
              <div className="flex gap-2">
                <select
                  value={stage}
                  onChange={(event) => setStage(event.target.value as typeof stage)}
                  className="flex-1 rounded border border-[#c9a96e] bg-white px-2 py-1 text-sm"
                >
                  {PROCESS_STAGES.map((name) => (
                    <option key={name} value={name}>
                      切换到{name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => submit({ type: 'process.advance', to: stage })}
                  className="rounded bg-[#8b5a2b] px-3 py-1 text-sm text-[#f5f0e8] hover:bg-[#6d4c2a]"
                >
                  推进
                </button>
              </div>
              <details className="mt-3 text-xs text-[#6d4c2a]">
                <summary className="cursor-pointer">工序切换历史（{snapshot.progress.history.length}）</summary>
                <ul className="mt-1 space-y-0.5">
                  {snapshot.progress.history.map((transition) => (
                    <li key={transition.opId}>
                      {transition.from ?? '—'} → {transition.to}
                    </li>
                  ))}
                </ul>
              </details>
            </section>

            <section className={PANEL_CLASS}>
              <h2 className="mb-3 text-lg font-semibold text-[#8b5a2b]">材料清单</h2>
              <ul className="mb-3 space-y-1 text-sm">
                {snapshot.materials.map((material) => (
                  <li key={material.id} className="flex items-center justify-between">
                    <span>{material.name}</span>
                    <span className="text-[#6d4c2a]">
                      余量 {material.remaining}/{material.total} {material.unit}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="space-y-2">
                <select
                  value={materialId}
                  onChange={(event) => setMaterialId(event.target.value)}
                  className="w-full rounded border border-[#c9a96e] bg-white px-2 py-1 text-sm"
                >
                  {snapshot.materials.map((material) => (
                    <option key={material.id} value={material.id}>
                      {material.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))}
                  className="w-full rounded border border-[#c9a96e] bg-white px-2 py-1 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      currentMaterial &&
                      submit({
                        type: 'material.checkout',
                        materialId: currentMaterial.id,
                        stage: snapshot.progress.currentStage ?? '清点',
                        quantity,
                      })
                    }
                    className="flex-1 rounded bg-[#8b5a2b] px-3 py-1 text-sm text-[#f5f0e8] hover:bg-[#6d4c2a]"
                  >
                    领用
                  </button>
                  <button
                    onClick={() =>
                      currentMaterial &&
                      submit({
                        type: 'material.return',
                        materialId: currentMaterial.id,
                        stage: snapshot.progress.currentStage ?? '清点',
                        quantity,
                      })
                    }
                    className="flex-1 rounded border border-[#8b5a2b] px-3 py-1 text-sm text-[#8b5a2b] hover:bg-[#8b5a2b]/10"
                  >
                    退回
                  </button>
                </div>
                <p className="text-xs text-[#6d4c2a]">
                  本册已领未退：{checkedOut} {currentMaterial?.unit ?? ''}
                </p>
              </div>
            </section>

            <section className={PANEL_CLASS}>
              <h2 className="mb-3 text-lg font-semibold text-[#8b5a2b]">
                修复记录（{records.length}）
              </h2>
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={2}
                placeholder="记录本次修复情况…"
                className="mb-2 w-full rounded border border-[#c9a96e] bg-white px-2 py-1 text-sm"
              />
              <button
                onClick={() => {
                  if (!content.trim()) return
                  submit({
                    type: 'record.append',
                    stage: snapshot.progress.currentStage ?? '清点',
                    content,
                  })
                  setContent('')
                }}
                className="mb-3 rounded bg-[#8b5a2b] px-3 py-1 text-sm text-[#f5f0e8] hover:bg-[#6d4c2a]"
              >
                追加记录
              </button>
              <ul className="space-y-2 text-sm">
                {records.map((record) => (
                  <li key={record.id} className="rounded bg-white/60 px-2 py-1.5">
                    <div className="text-xs text-[#9c8b74]">[{record.stage}]</div>
                    <div>{record.content}</div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {snapshot.conflicts.length > 0 && (
            <section className="rounded-lg border border-[#7b241c] bg-[#f5f0e8] p-4">
              <h2 className="mb-2 text-lg font-semibold text-[#7b241c]">
                冲突操作痕迹（{snapshot.conflicts.length}）
              </h2>
              <ul className="space-y-1 text-sm">
                {snapshot.conflicts.map((conflict) => (
                  <li key={conflict.opId} className="text-[#5c2a1f]">
                    {conflict.opId}：基于版本 {conflict.expectedVersion} 提交
                    “{conflict.payload.type}”，落账版本已为 {conflict.actualVersion}
                    ，该操作未生效，当前有效状态以版本 {conflict.actualVersion} 为准
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
