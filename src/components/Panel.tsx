import type {
  DeductionSnapshot,
  EngineStats,
  RingType
} from '../engine';
import { ringLabel } from '../engine';
import { RING_COLORS } from '../types';

interface PanelProps {
  snapshot: DeductionSnapshot;
  predictions: Map<number, string>;
  stats: EngineStats;
  verifyResult: string | null;
  onRunVerify(): void;
  onFixOrbit(bodyId: number): void;
  onRemoveBody(bodyId: number): void;
}

export default function Panel({
  snapshot,
  predictions,
  stats,
  verifyResult,
  onRunVerify,
  onFixOrbit,
  onRemoveBody
}: PanelProps) {
  return (
    <aside className="panel">
      <h2 className="panel-title">星盘推演 · t={snapshot.time.toFixed(2)}s</h2>

      <section className="panel-section">
        <h3>星体推演结果</h3>
        {snapshot.bodies.length === 0 && (
          <p className="muted">尚未标记行星，点击浑天仪中央主星标记。</p>
        )}
        <ul className="body-list">
          {snapshot.bodies.map((body) => (
            <li key={body.bodyId} className="body-row">
              <span
                className="dot"
                style={{ background: RING_COLORS[body.ring as RingType] }}
              />
              <div className="body-info">
                <div className="body-line">
                  <strong>#{body.bodyId}</strong>
                  <span style={{ color: RING_COLORS[body.ring] }}>
                    {ringLabel(body.ring)}
                  </span>
                  <span>{body.angleDeg.toFixed(2)}°</span>
                </div>
                <div className="body-line sub">
                  {body.visible ? (
                    <span className="visible">可见</span>
                  ) : (
                    <span className="occluded">
                      被 #{body.occludedBy} 遮挡（视深 {body.depth.toFixed(2)}）
                    </span>
                  )}
                  <span className="prediction">{predictions.get(body.bodyId) ?? ''}</span>
                </div>
              </div>
              <div className="body-actions">
                <button
                  className="mini-btn"
                  onClick={() => onFixOrbit(body.bodyId)}
                  title="修正该星体轨道参数（仅重推该星体）"
                >
                  修正轨道
                </button>
                <button className="mini-btn" onClick={() => onRemoveBody(body.bodyId)}>
                  移除
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel-section">
        <h3>遮挡判定依据</h3>
        {snapshot.occlusions.length === 0 ? (
          <p className="muted">当前时刻没有角距小于阈值的星体对。</p>
        ) : (
          <ul className="verdict-list">
            {snapshot.occlusions.map((verdict) => (
              <li key={`${verdict.ring}-${verdict.occluderId}-${verdict.occludedId}`}>
                {verdict.rationale}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-section">
        <h3>推演缓存（脱离帧率复用）</h3>
        <div className="stats-grid">
          <span>快照命中 {stats.snapshotHits}</span>
          <span>快照重推 {stats.snapshotMisses}</span>
          <span>星历命中 {stats.ephemerisHits}</span>
          <span>星历重算 {stats.ephemerisMisses}</span>
        </div>
      </section>

      <section className="panel-section">
        <h3>一致性校验</h3>
        <button className="ctrl-btn" onClick={onRunVerify}>
          批量推演当前 ±30s 并与整体重推核对
        </button>
        {verifyResult && <p className="verify-result">{verifyResult}</p>}
      </section>
    </aside>
  );
}
