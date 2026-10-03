import { describe, expect, it } from 'vitest'
import { deriveAll } from './engine'
import { acceptanceSample } from './sample'
import { AlignmentSession, compareWithFullRederive } from './session'

function freshSession() {
  return new AlignmentSession(acceptanceSample())
}

describe('异常识别：倒序、重叠、缺失锚点、矛盾来源', () => {
  it('四类异常均被检出，且矛盾片段双方都被保留为待裁决', () => {
    const session = freshSession()
    const result = session.getResult()
    const kinds = new Set(result.anomalies.map((a) => a.kind))
    expect(kinds.has('reversed-time')).toBe(true)
    expect(kinds.has('overlap')).toBe(true)
    expect(kinds.has('missing-anchor-target')).toBe(true)
    expect(kinds.has('source-conflict')).toBe(true)

    const conflict = result.conflicts.find((g) => g.key === 'conflict@196.000')!
    expect(conflict).toBeDefined()
    expect(conflict.status).toBe('pending')
    expect(conflict.segmentIds).toEqual(['seg6', 'seg7'])

    const seg6 = result.conclusions.find((c) => c.segmentId === 'seg6')!
    const seg7 = result.conclusions.find((c) => c.segmentId === 'seg7')!
    expect(seg6.pendingConflict).toBe(true)
    expect(seg7.pendingConflict).toBe(true)
    expect(seg6.suppressed).toBe(false)
    expect(seg7.suppressed).toBe(false)
  })

  it('矛盾未裁决时不会静默择一，两条片段都产生独立结论', () => {
    const result = deriveAll(acceptanceSample())
    const at196 = result.conclusions.filter((c) =>
      ['seg6', 'seg7'].includes(c.segmentId),
    )
    expect(at196.length).toBe(2)
    expect(new Set(at196.map((c) => c.segmentId))).toEqual(new Set(['seg6', 'seg7']))
  })
})

describe('裁决后只重推受影响区间', () => {
  it('裁决仅重推矛盾双方，未受影响片段结论对象原样复用', () => {
    const session = freshSession()
    const before = session.getResult().conclusions
    session.adjudicate('conflict@196.000', 'seg6')
    const after = new Map(session.getResult().conclusions.map((c) => [c.segmentId, c]))
    const seg6 = after.get('seg6')!
    const seg7 = after.get('seg7')!
    expect(seg6.suppressed).toBe(false)
    expect(seg7.suppressed).toBe(true)
    expect(seg6.basis.adjudicationIds.length).toBe(1)
    expect(seg7.basis.adjudicationIds.length).toBe(1)

    const log = session.changeLog[session.changeLog.length - 1]
    expect(log.affectedSegmentIds.sort()).toEqual(['seg6', 'seg7'])
    for (const conclusion of before) {
      if (conclusion.segmentId === 'seg6' || conclusion.segmentId === 'seg7') continue
      expect(after.get(conclusion.segmentId)).toBe(conclusion)
    }
    expect(compareWithFullRederive(session)).toEqual([])
  })

  it('裁决记录可逐条追溯：依据含裁决 id、片段顺序键与锚点 id', () => {
    const session = freshSession()
    const adjudication = session.adjudicate('conflict@196.000', 'seg6')
    const state = session.getState()
    expect(state.adjudications.some((a) => a.id === adjudication.id)).toBe(true)
    const seg6 = session.getResult().conclusions.find((c) => c.segmentId === 'seg6')!
    expect(seg6.basis.adjudicationIds).toEqual([adjudication.id])
    expect(seg6.basis.orderKey).toContain('seg6')
    expect(seg6.basis.anchorIds).toContain('a2')
  })
})

describe('锚点修正、片段增删、帧率调整的增量一致性', () => {
  it('修正锚点只重推相邻锚点区间内片段', () => {
    const session = freshSession()
    const before = new Map(session.getResult().conclusions.map((c) => [c.segmentId, c]))
    session.upsertAnchor({ id: 'a2', mediaTime: 105, segmentId: 'seg3', note: '修正后' })
    const log = session.changeLog[session.changeLog.length - 1]
    expect(log.affectedSegmentIds).not.toContain('seg1')
    expect(log.affectedSegmentIds).toContain('seg3')
    const after = new Map(session.getResult().conclusions.map((c) => [c.segmentId, c]))
    expect(after.get('seg1')).toBe(before.get('seg1'))
    expect(compareWithFullRederive(session)).toEqual([])
  })

  it('删除锚点只重推受影响区间，且与整体重推一致', () => {
    const session = freshSession()
    session.removeAnchor('a4')
    const seg8 = session.getResult().conclusions.find((c) => c.segmentId === 'seg8')!
    expect(seg8.driftTrend).toBe('extrapolated')
    expect(seg8.offset).toBe(3)
    expect(compareWithFullRederive(session)).toEqual([])
  })

  it('新增与删除片段后增量结果与整体重推一致', () => {
    const session = freshSession()
    session.upsertSegment({
      id: 'seg-new',
      start: 250,
      end: 252,
      text: '新增的一条字幕',
      source: '人工',
    })
    expect(compareWithFullRederive(session)).toEqual([])
    session.removeSegment('seg5')
    expect(compareWithFullRederive(session)).toEqual([])
  })

  it('帧率调整后所有帧号重算，秒级偏移与漂移趋势不变', () => {
    const session = freshSession()
    const before = new Map(session.getResult().conclusions.map((c) => [c.segmentId, c]))
    session.setMedia({ duration: 600, frameRate: 30 })
    const after = session.getResult().conclusions
    for (const conclusion of after) {
      const prev = before.get(conclusion.segmentId)!
      expect(conclusion.offset).toBeCloseTo(prev.offset, 10)
      expect(conclusion.driftTrend).toBe(prev.driftTrend)
      expect(conclusion.offsetFrames).toBe(Math.round(prev.offset * 30))
    }
    expect(compareWithFullRederive(session)).toEqual([])
  })

  it('时长单独调整不触发任何片段重推', () => {
    const session = freshSession()
    const before = session.getResult().conclusions
    session.setMedia({ duration: 900, frameRate: 25 })
    const log = session.changeLog[session.changeLog.length - 1]
    expect(log.affectedSegmentIds).toEqual([])
    const after = new Map(session.getResult().conclusions.map((c) => [c.segmentId, c]))
    for (const conclusion of before) expect(after.get(conclusion.segmentId)).toBe(conclusion)
  })
})

describe('偏移插值与漂移趋势推导', () => {
  it('两锚点间线性插值并给出漂移率', () => {
    const result = freshSession().getResult()
    const seg4 = result.conclusions.find((c) => c.segmentId === 'seg4')!
    expect(seg4.basis.anchorIds).toEqual(['a2', 'a4'])
    const expectedOffset = 3 + (6 - 3) * ((147 - 100) / (500 - 100))
    expect(seg4.offset).toBeCloseTo(expectedOffset, 9)
    expect(seg4.driftTrend).toBe('drifting-forward')
    expect(seg4.driftRate).toBeCloseTo(3 / 400, 9)
  })

  it('落在锚点时刻上的片段漂移为稳定，偏移为零', () => {
    const result = freshSession().getResult()
    const seg1 = result.conclusions.find((c) => c.segmentId === 'seg1')!
    expect(seg1.driftTrend).toBe('stable')
    expect(seg1.offset).toBe(0)
  })
})
