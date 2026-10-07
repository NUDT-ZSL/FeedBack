// 面板组件：时间轴、天象预言、遮挡依据、批量推演校验。数据全部来自推演引擎。
import { useEffect, useMemo, useState } from 'react';
import html2canvas from 'html2canvas';
import { runVerification, type VerifyReport } from '../engine/verify.ts';
import {
  RING_LABELS,
  type OcclusionRelation,
  type RingKey,
  type SimulationFrame
} from '../engine/index.ts';
import { TIMELINE, type RingKey as RingKeyType } from '../types.ts';
import type { PlanetNote } from '../useSimulation.ts';

export function Timeline({
  time,
  onChange,
  playing,
  onTogglePlay
}: {
  time: number;
  onChange: (t: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
}) {
  return (
    <div className="timeline">
      <button className="play-btn" onClick={onTogglePlay}>{playing ? '⏸ 暂停' : '▶ 推演'}</button>
      <input
        type="range"
        min={TIMELINE.start}
        max={TIMELINE.end}
        step={1}
        value={time}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="time-readout">{(time / 1000).toFixed(1)}s</span>
    </div>
  );
}

function Typewriter({ text }: { text: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    setShown(0);
    const timer = setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          clearInterval(timer);
          return n;
        }
        return n + 1;
      });
    }, 160);
    return () => clearInterval(timer);
  }, [text]);
  return <span className="typewriter">{text.slice(0, shown)}</span>;
}

export function PredictionPanel({ notes }: { notes: PlanetNote[] }) {
  const latest = notes[notes.length - 1];
  return (
    <section className="panel">
      <h3>天象预言</h3>
      {latest ? (
        <div className="prediction">
          <Typewriter text={latest.prediction} />
          <div className="prediction-meta">客星降世 · 时刻 {(latest.createdAt / 1000).toFixed(1)}s</div>
        </div>
      ) : (
        <p className="hint">点击浑天仪中央主星，降下客星并获得预言</p>
      )}
      {notes.length > 1 && (
        <ul className="note-list">
          {notes.slice(0, -1).reverse().map((n) => (
            <li key={n.bodyId}>{n.prediction}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

const TIE_BREAK_LABEL: Record<OcclusionRelation['evidence']['tieBreak'], string> = {
  depth: '深度决胜',
  magnitude: '亮度决胜',
  order: '序号决胜'
};

export function OcclusionPanel({ frame }: { frame: SimulationFrame }) {
  return (
    <section className="panel">
      <h3>遮挡推演（{frame.occlusions.length}）</h3>
      {frame.occlusions.length === 0 && <p className="hint">当前时刻无遮挡</p>}
      <ul className="occlusion-list">
        {frame.occlusions.map((rel) => (
          <li key={`${rel.visibleId}-${rel.hiddenId}`}>
            <div className="occ-title">
              <b>{rel.visibleId}</b> 掩 <b className="dim">{rel.hiddenId}</b>
            </div>
            <div className="occ-evidence">
              {RING_LABELS[rel.evidence.ring]}角差 {rel.evidence.angleDiffDeg.toFixed(2)}° ·
              视距 {rel.evidence.viewSeparationRad.toFixed(3)}rad ·
              深度 {rel.evidence.depthVisible.toFixed(2)} &lt; {rel.evidence.depthHidden.toFixed(2)} ·
              {TIE_BREAK_LABEL[rel.evidence.tieBreak]}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AnglesPanel({ frame }: { frame: SimulationFrame }) {
  const rows = useMemo(() => frame.bodies.slice(0, 8), [frame]);
  return (
    <section className="panel">
      <h3>三环角度（前 8 星）</h3>
      <table className="angles-table">
        <thead>
          <tr><th>星体</th><th>黄道</th><th>赤道</th><th>银道</th></tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td>{b.id}</td>
              {(['ecliptic', 'equator', 'galactic'] as RingKey[]).map((ring) => (
                <td key={ring}>{b.angles[ring] === null ? '—' : `${b.angles[ring]!.toFixed(1)}°`}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export function VerifyPanel({ onExport }: { onExport: () => void }) {
  const [report, setReport] = useState<VerifyReport | null>(null);
  const [running, setRunning] = useState(false);
  const run = () => {
    setRunning(true);
    setTimeout(() => {
      setReport(runVerification());
      setRunning(false);
    }, 30);
  };
  return (
    <section className="panel">
      <h3>批量推演校验</h3>
      <div className="btn-row">
        <button onClick={run} disabled={running}>{running ? '校验中…' : '运行一致性校验'}</button>
        <button onClick={onExport}>导出星盘图</button>
      </div>
      {report && (
        <ul className="verify-list">
          {report.results.map((r) => (
            <li key={r.name} className={r.passed ? 'pass' : 'fail'}>
              {r.passed ? '✓' : '✗'} {r.name}
              <span className="verify-detail">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function RingSelectPanel({
  selected,
  onSelect
}: {
  selected: RingKeyType;
  onSelect: (ring: RingKeyType) => void;
}) {
  return (
    <section className="panel">
      <h3>降星环带</h3>
      <div className="btn-row">
        {(['ecliptic', 'equator', 'galactic'] as RingKeyType[]).map((ring) => (
          <button
            key={ring}
            className={selected === ring ? 'active' : ''}
            onClick={() => onSelect(ring)}
          >
            {RING_LABELS[ring]}
          </button>
        ))}
      </div>
    </section>
  );
}

export async function exportStarChart(): Promise<void> {
  const canvas = await html2canvas(document.body, { backgroundColor: '#10101f' });
  const link = document.createElement('a');
  link.download = `星盘推演-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
