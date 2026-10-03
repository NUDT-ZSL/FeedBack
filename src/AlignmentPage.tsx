import React, { useRef, useState } from 'react'
import { AlignmentSession } from './alignment/session'
import { acceptanceSample } from './alignment/sample'
import { ANOMALY_LABELS, DRIFT_LABELS } from './alignment/types'
import type { Segment } from './alignment/types'

const colors = {
  bg: '#f5f0e8',
  panel: '#fffdf8',
  border: '#d4c9b0',
  title: '#5a4a3a',
  accent: '#a86b2d',
  danger: '#b03a2e',
  warn: '#b9770e',
  ok: '#1e8449',
}

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 16, maxWidth: 1280, margin: '0 auto', color: colors.title },
  grid: { display: 'grid', gridTemplateColumns: '380px 1fr', gap: 16, alignItems: 'start' },
  panel: {
    background: colors.panel,
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  h3: { margin: '0 0 8px', fontSize: 15, color: colors.title },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { textAlign: 'left', padding: '4px 6px', borderBottom: `2px solid ${colors.border}`, whiteSpace: 'nowrap' },
  td: { padding: '4px 6px', borderBottom: `1px solid ${colors.border}`, verticalAlign: 'top' },
  input: {
    width: '100%', boxSizing: 'border-box', padding: '3px 6px', fontSize: 12,
    border: `1px solid ${colors.border}`, borderRadius: 6, background: '#fff',
  },
  btn: {
    padding: '4px 10px', fontSize: 12, borderRadius: 8, border: `1px solid ${colors.border}`,
    background: colors.accent, color: '#fff', cursor: 'pointer', marginRight: 6,
  },
  btnGhost: {
    padding: '3px 8px', fontSize: 11, borderRadius: 8, border: `1px solid ${colors.border}`,
    background: 'transparent', color: colors.title, cursor: 'pointer', marginRight: 4,
  },
  tag: {
    display: 'inline-block', padding: '1px 6px', borderRadius: 8, fontSize: 11,
    marginRight: 4, border: `1px solid ${colors.border}`,
  },
  muted: { color: '#8a7a66', fontSize: 11 },
}

const AlignmentPage: React.FC = () => {
  const sessionRef = useRef<AlignmentSession | null>(null)
  if (!sessionRef.current) sessionRef.current = new AlignmentSession(acceptanceSample())
  const session = sessionRef.current
  const [, setTick] = useState(0)
  const refresh = () => setTick((t) => t + 1)

  const state = session.getState()
  const result = session.getResult()

  const [mediaDraft, setMediaDraft] = useState({ duration: String(state.media.duration), frameRate: String(state.media.frameRate) })
  const [anchorDraft, setAnchorDraft] = useState({ id: '', mediaTime: '', segmentId: '' })
  const [segDraft, setSegDraft] = useState({ id: '', start: '', end: '', text: '', source: '人工' })

  const segById = new Map(state.segments.map((s) => [s.id, s]))

  const applyMedia = () => {
    const duration = Number(mediaDraft.duration)
    const frameRate = Number(mediaDraft.frameRate)
    if (!Number.isFinite(duration) || !Number.isFinite(frameRate) || frameRate <= 0) return
    session.setMedia({ duration, frameRate })
    refresh()
  }

  const addAnchor = () => {
    const mediaTime = Number(anchorDraft.mediaTime)
    if (!anchorDraft.id.trim() || !Number.isFinite(mediaTime) || !anchorDraft.segmentId) return
    session.upsertAnchor({ id: anchorDraft.id.trim(), mediaTime, segmentId: anchorDraft.segmentId })
    setAnchorDraft({ id: '', mediaTime: '', segmentId: '' })
    refresh()
  }

  const addSegment = () => {
    const start = Number(segDraft.start)
    const end = Number(segDraft.end)
    if (!segDraft.id.trim() || !Number.isFinite(start) || !Number.isFinite(end)) return
    const seg: Segment = {
      id: segDraft.id.trim(), start, end,
      text: segDraft.text || '(无文本)', source: segDraft.source.trim() || '未知',
    }
    session.upsertSegment(seg)
    setSegDraft({ id: '', start: '', end: '', text: '', source: '人工' })
    refresh()
  }

  const loadSample = () => {
    sessionRef.current = new AlignmentSession(acceptanceSample())
    const media = sessionRef.current.getState().media
    setMediaDraft({ duration: String(media.duration), frameRate: String(media.frameRate) })
    refresh()
  }

  const loadEmpty = () => {
    sessionRef.current = new AlignmentSession({
      media: { duration: 600, frameRate: 25 }, anchors: [], segments: [], adjudications: [],
    })
    refresh()
  }

  return (
    <div style={styles.page}>
      <div style={{ marginBottom: 12 }}>
        <button style={styles.btn} onClick={loadSample}>载入验收样例</button>
        <button style={{ ...styles.btn, background: colors.danger }} onClick={loadEmpty}>清空重来</button>
        <span style={styles.muted}>
          推导版本 v{result.version} · 结论 {result.conclusions.length} 条 · 异常 {result.anomalies.length} 条 · 矛盾组 {result.conflicts.length} 个
        </span>
      </div>
      <div style={styles.grid}>
        <div>
          <div style={styles.panel}>
            <h3 style={styles.h3}>媒体信息</h3>
            <table style={styles.table}>
              <tbody>
                <tr>
                  <td style={styles.td}>总时长(s)</td>
                  <td style={styles.td}><input style={styles.input} value={mediaDraft.duration} onChange={(e) => setMediaDraft({ ...mediaDraft, duration: e.target.value })} /></td>
                </tr>
                <tr>
                  <td style={styles.td}>帧率(fps)</td>
                  <td style={styles.td}><input style={styles.input} value={mediaDraft.frameRate} onChange={(e) => setMediaDraft({ ...mediaDraft, frameRate: e.target.value })} /></td>
                </tr>
              </tbody>
            </table>
            <div style={{ marginTop: 8 }}>
              <button style={styles.btn} onClick={applyMedia}>应用媒体变更</button>
              <span style={styles.muted}>帧率变化只重算帧号；时长变化不重推</span>
            </div>
          </div>

          <div style={styles.panel}>
            <h3 style={styles.h3}>关键锚点（媒体时刻 ↔ 片段）</h3>
            <table style={styles.table}>
              <thead>
                <tr><th style={styles.th}>ID</th><th style={styles.th}>媒体时刻</th><th style={styles.th}>目标片段</th><th style={styles.th}></th></tr>
              </thead>
              <tbody>
                {state.anchors.map((a) => (
                  <tr key={a.id}>
                    <td style={styles.td}>{a.id}</td>
                    <td style={styles.td}>
                      <input
                        style={{ ...styles.input, width: 64 }}
                        defaultValue={a.mediaTime}
                        key={`${a.id}-${a.mediaTime}`}
                        onBlur={(e) => {
                          const t = Number(e.target.value)
                          if (Number.isFinite(t) && t !== a.mediaTime) {
                            session.upsertAnchor({ ...a, mediaTime: t })
                            refresh()
                          }
                        }}
                      />
                    </td>
                    <td style={styles.td}>
                      {a.segmentId}
                      {!segById.has(a.segmentId) && <span style={{ ...styles.tag, color: colors.danger }}>缺失</span>}
                    </td>
                    <td style={styles.td}>
                      <button style={styles.btnGhost} onClick={() => { session.removeAnchor(a.id); refresh() }}>删除</button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={styles.td}><input style={styles.input} placeholder="a5" value={anchorDraft.id} onChange={(e) => setAnchorDraft({ ...anchorDraft, id: e.target.value })} /></td>
                  <td style={styles.td}><input style={styles.input} placeholder="秒" value={anchorDraft.mediaTime} onChange={(e) => setAnchorDraft({ ...anchorDraft, mediaTime: e.target.value })} /></td>
                  <td style={styles.td}>
                    <select style={styles.input} value={anchorDraft.segmentId} onChange={(e) => setAnchorDraft({ ...anchorDraft, segmentId: e.target.value })}>
                      <option value="">选择片段</option>
                      {state.segments.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}
                    </select>
                  </td>
                  <td style={styles.td}><button style={styles.btnGhost} onClick={addAnchor}>添加</button></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={styles.panel}>
            <h3 style={styles.h3}>字幕片段</h3>
            <table style={styles.table}>
              <thead>
                <tr><th style={styles.th}>ID</th><th style={styles.th}>起</th><th style={styles.th}>止</th><th style={styles.th}>来源</th><th style={styles.th}>文本</th><th style={styles.th}></th></tr>
              </thead>
              <tbody>
                {state.segments.map((s) => (
                  <tr key={s.id}>
                    <td style={styles.td}>{s.id}</td>
                    <td style={styles.td}>{s.start}</td>
                    <td style={styles.td}>{s.end}</td>
                    <td style={styles.td}>{s.source}</td>
                    <td style={styles.td}>{s.text}</td>
                    <td style={styles.td}>
                      <button style={styles.btnGhost} onClick={() => { session.removeSegment(s.id); refresh() }}>删除</button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td style={styles.td}><input style={styles.input} placeholder="id" value={segDraft.id} onChange={(e) => setSegDraft({ ...segDraft, id: e.target.value })} /></td>
                  <td style={styles.td}><input style={styles.input} placeholder="起" value={segDraft.start} onChange={(e) => setSegDraft({ ...segDraft, start: e.target.value })} /></td>
                  <td style={styles.td}><input style={styles.input} placeholder="止" value={segDraft.end} onChange={(e) => setSegDraft({ ...segDraft, end: e.target.value })} /></td>
                  <td style={styles.td}><input style={styles.input} value={segDraft.source} onChange={(e) => setSegDraft({ ...segDraft, source: e.target.value })} /></td>
                  <td style={styles.td}><input style={styles.input} placeholder="文本" value={segDraft.text} onChange={(e) => setSegDraft({ ...segDraft, text: e.target.value })} /></td>
                  <td style={styles.td}><button style={styles.btnGhost} onClick={addSegment}>添加</button></td>
                </tr>
              </tbody>
            </table>
          </div>

          <div style={styles.panel}>
            <h3 style={styles.h3}>变更日志（增量重推范围）</h3>
            <table style={styles.table}>
              <thead>
                <tr><th style={styles.th}>#</th><th style={styles.th}>操作</th><th style={styles.th}>重推</th><th style={styles.th}>复用</th></tr>
              </thead>
              <tbody>
                {[...session.changeLog].reverse().map((entry) => (
                  <tr key={entry.seq}>
                    <td style={styles.td}>v{entry.version}</td>
                    <td style={styles.td}>{entry.description}</td>
                    <td style={{ ...styles.td, color: colors.warn }}>{entry.affectedSegmentIds.length} 段</td>
                    <td style={{ ...styles.td, color: colors.ok }}>{entry.reusedSegmentIds.length} 段</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div style={styles.panel}>
            <h3 style={styles.h3}>异常与矛盾裁决</h3>
            {result.anomalies.length === 0 && <div style={styles.muted}>暂无异常</div>}
            {result.anomalies.map((a) => (
              <div key={a.id} style={{ marginBottom: 4, fontSize: 12 }}>
                <span style={{ ...styles.tag, color: a.kind === 'source-conflict' ? colors.danger : colors.warn }}>
                  {ANOMALY_LABELS[a.kind]}
                </span>
                {a.detail}
              </div>
            ))}
            {result.conflicts.map((g) => (
              <div key={g.key} style={{ marginTop: 8, padding: 8, border: `1px dashed ${colors.border}`, borderRadius: 8 }}>
                <div style={{ fontSize: 12, marginBottom: 4 }}>
                  矛盾组 <b>{g.key}</b>（{g.status === 'pending' ? '待裁决：双方均保留' : `已裁决：采纳 ${g.resolution?.chosenSegmentId}`}）
                </div>
                {g.segmentIds.map((id) => {
                  const seg = segById.get(id)
                  if (!seg) return null
                  return (
                    <div key={id} style={{ fontSize: 12, marginBottom: 2 }}>
                      <span style={styles.tag}>{seg.source}</span>
                      {id}「{seg.text}」
                      {g.status === 'pending' && (
                        <button
                          style={{ ...styles.btnGhost, color: colors.ok }}
                          onClick={() => { session.adjudicate(g.key, id); refresh() }}
                        >
                          采纳此条
                        </button>
                      )}
                      {g.status === 'resolved' && g.resolution?.chosenSegmentId === id && (
                        <span style={{ ...styles.tag, color: colors.ok }}>已采纳</span>
                      )}
                      {g.status === 'resolved' && g.resolution?.chosenSegmentId !== id && (
                        <span style={{ ...styles.tag, color: colors.danger }}>已挂起</span>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          <div style={styles.panel}>
            <h3 style={styles.h3}>对齐结论（含可追溯依据）</h3>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>片段</th><th style={styles.th}>文本</th><th style={styles.th}>偏移(s)</th>
                  <th style={styles.th}>偏移(帧)</th><th style={styles.th}>漂移趋势</th><th style={styles.th}>漂移率</th>
                  <th style={styles.th}>状态</th><th style={styles.th}>依据</th>
                </tr>
              </thead>
              <tbody>
                {result.conclusions.map((c) => {
                  const seg = segById.get(c.segmentId)
                  return (
                    <tr key={c.segmentId} style={{ opacity: c.suppressed ? 0.45 : 1 }}>
                      <td style={styles.td}>{c.segmentId}</td>
                      <td style={styles.td}>{seg?.text}</td>
                      <td style={styles.td}>{c.offset.toFixed(3)}</td>
                      <td style={styles.td}>{c.offsetFrames}</td>
                      <td style={styles.td}>{DRIFT_LABELS[c.driftTrend]}</td>
                      <td style={styles.td}>{c.driftRate === null ? '—' : c.driftRate.toFixed(4)}</td>
                      <td style={styles.td}>
                        {c.suppressed && <span style={{ ...styles.tag, color: colors.danger }}>挂起</span>}
                        {c.pendingConflict && <span style={{ ...styles.tag, color: colors.warn }}>待裁决</span>}
                        {c.anomalies.map((k) => (
                          <span key={k} style={{ ...styles.tag, color: colors.warn }}>{ANOMALY_LABELS[k]}</span>
                        ))}
                      </td>
                      <td style={{ ...styles.td, ...styles.muted }}>
                        锚点[{c.basis.anchorIds.join(', ') || '无'}]
                        {c.basis.adjudicationIds.length > 0 && <> 裁决[{c.basis.adjudicationIds.join(', ')}]</>}
                        {' '}顺序[{c.basis.orderKey}] v{c.basis.version}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

export default AlignmentPage
