import React from 'react';
import { Gourd, Pill } from './types';
import { EFFECT_NAMES, GOURD_COLORS, GOURD_GLOW, RARITY_COLORS, RARITY_NAMES } from './constants';
import { FurnaceRuntime } from './core';

export interface TrayPill {
  key: string;
  pill: Pill;
  furnaceName: string;
}

interface PillResultProps {
  tray: TrayPill[];
  gourds: Gourd[];
  furnaces: FurnaceRuntime[];
  selectedId: string;
  onStorePill: (key: string) => void;
}

const pillTitle = (pill: Pill): string => {
  const lines = [
    `${pill.name}（${RARITY_NAMES[pill.rarity]}）`,
    `功效：${EFFECT_NAMES[pill.effect] ?? pill.effect}`,
    `药材：${pill.ingredients.join('、')}`,
    `火候：风量${pill.airFlow}，炉温${pill.fireTemp}`
  ];
  if (pill.basis && pill.basis.length > 0) {
    lines.push('依据：');
    for (const b of pill.basis) lines.push(`· ${b}`);
  }
  return lines.join('\n');
};

const PillResult: React.FC<PillResultProps> = ({
  tray,
  gourds,
  furnaces,
  selectedId,
  onStorePill
}) => {
  const selected = furnaces.find(f => f.id === selectedId) ?? furnaces[0];
  const trace = [...selected.trace].reverse();

  return (
    <div style={styles.panel}>
      <div style={styles.section}>
        <div style={styles.sectionTitle}>丹盘 · 新成丹药</div>
        {tray.length === 0 && <div style={styles.empty}>暂无新丹，成丹后会暂存于此</div>}
        <div style={styles.trayGrid}>
          {tray.map(item => (
            <div
              key={item.key}
              style={{ ...styles.trayPill, borderColor: RARITY_COLORS[item.pill.rarity] }}
              title={`${pillTitle(item.pill)}\n（点击收入葫芦）`}
              onClick={() => onStorePill(item.key)}
            >
              <span style={{ ...styles.pillDot, backgroundColor: item.pill.color, boxShadow: `0 0 8px ${item.pill.glowColor}` }} />
              <span style={styles.trayName}>{item.pill.name}</span>
              <span style={styles.trayFrom}>{item.furnaceName}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={styles.section}>
        <div style={styles.sectionTitle}>葫芦架</div>
        {gourds.map(gourd => (
          <div key={gourd.color} style={styles.gourdRow}>
            <span style={{ ...styles.gourdIcon, backgroundColor: GOURD_COLORS[gourd.color], boxShadow: `0 0 8px ${GOURD_GLOW[gourd.color]}` }}>葫</span>
            <span style={styles.gourdName}>{gourd.name}</span>
            <span style={styles.gourdPills}>
              {gourd.pills.length === 0 && <span style={styles.empty}>空</span>}
              {gourd.pills.map((gp, i) => (
                <span
                  key={`${gp.pill.id}-${i}`}
                  style={{ ...styles.pillDot, backgroundColor: gp.pill.color, boxShadow: `0 0 8px ${gp.pill.glowColor}` }}
                  title={pillTitle(gp.pill)}
                />
              ))}
            </span>
            <span style={styles.gourdCount}>{gourd.pills.length}/{gourd.maxPills}</span>
          </div>
        ))}
      </div>

      <div style={{ ...styles.section, flex: 1, minHeight: 0 }}>
        <div style={styles.sectionTitle}>丹录 · {selected.name}</div>
        <div style={styles.traceList}>
          {trace.length === 0 && <div style={styles.empty}>此炉尚无投料记录</div>}
          {trace.map((event, i) => (
            <div key={`${event.seq}-${i}`} style={styles.traceItem}>
              <div style={styles.traceHead}>
                <span style={{
                  ...styles.traceTag,
                  color: event.type === 'conflict' ? '#e74c3c' : event.type === 'outcome' ? '#d4ac0d' : '#7fb069'
                }}>
                  {event.type === 'add' ? '投料' : event.type === 'conflict' ? '冲突' : '成丹'}
                </span>
                <span style={styles.traceSeq}>第{event.seq}手</span>
                <span style={styles.traceSummary}>{event.summary}</span>
              </div>
              <div style={styles.traceDetail}>{event.detail}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    right: '20px',
    top: '90px',
    bottom: '20px',
    width: '320px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    padding: '16px',
    background: 'linear-gradient(145deg, #3d2817, #2a1a0e)',
    border: '3px solid #6b4c3a',
    borderRadius: '12px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1)',
    zIndex: 10,
    overflow: 'hidden'
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  sectionTitle: {
    fontFamily: "'Ma Shan Zheng', cursive",
    fontSize: '18px',
    color: '#d4ac0d',
    borderBottom: '1px solid #6b4c3a',
    paddingBottom: '4px'
  },
  empty: {
    fontFamily: "'ZCOOL KuaiLe', cursive",
    fontSize: '12px',
    color: '#8b7355'
  },
  trayGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    maxHeight: '140px',
    overflowY: 'auto'
  },
  trayPill: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '4px 8px',
    border: '1px solid',
    borderRadius: '8px',
    background: 'rgba(0,0,0,0.3)',
    cursor: 'pointer'
  },
  pillDot: {
    display: 'inline-block',
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    flexShrink: 0
  },
  trayName: {
    fontFamily: "'Ma Shan Zheng', cursive",
    fontSize: '14px',
    color: '#e8c170',
    flex: 1
  },
  trayFrom: {
    fontFamily: "'ZCOOL KuaiLe', cursive",
    fontSize: '11px',
    color: '#8b7355'
  },
  gourdRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  gourdIcon: {
    width: '22px',
    height: '22px',
    borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
    color: '#d4ac0d',
    fontSize: '11px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Ma Shan Zheng', cursive"
  },
  gourdName: {
    fontFamily: "'ZCOOL KuaiLe', cursive",
    fontSize: '13px',
    color: '#c9a86a',
    width: '64px'
  },
  gourdPills: {
    flex: 1,
    display: 'flex',
    gap: '4px',
    alignItems: 'center'
  },
  gourdCount: {
    fontFamily: "'ZCOOL KuaiLe', cursive",
    fontSize: '11px',
    color: '#8b7355'
  },
  traceList: {
    flex: 1,
    minHeight: '80px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    paddingRight: '4px'
  },
  traceItem: {
    background: 'rgba(0,0,0,0.25)',
    borderRadius: '6px',
    padding: '6px 8px'
  },
  traceHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  traceTag: {
    fontFamily: "'ZCOOL KuaiLe', cursive",
    fontSize: '11px'
  },
  traceSeq: {
    fontFamily: "'ZCOOL KuaiLe', cursive",
    fontSize: '11px',
    color: '#8b7355'
  },
  traceSummary: {
    fontFamily: "'Ma Shan Zheng', cursive",
    fontSize: '13px',
    color: '#e8c170'
  },
  traceDetail: {
    fontFamily: "'ZCOOL KuaiLe', cursive",
    fontSize: '11px',
    color: '#a08660',
    marginTop: '2px',
    lineHeight: 1.5
  }
};

export default PillResult;
