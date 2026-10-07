import React, { useState } from 'react';
import { Gourd, GourdColor, Pill } from './types';
import {
  EFFECT_NAMES,
  ELEMENT_COLORS,
  ELEMENT_NAMES,
  GOURD_COLORS,
  GOURD_GLOW,
  RARITY_COLORS,
  RARITY_NAMES
} from './constants';

export interface CollectedPill {
  pill: Pill;
  furnaceName: string;
  reason: string;
  collectedAt: number;
  stored: boolean;
}

interface PillResultProps {
  pills: CollectedPill[];
  gourds: Gourd[];
  onStorePill: (pillId: string) => void;
}

const PillResult: React.FC<PillResultProps> = ({ pills, gourds, onStorePill }) => {
  const [openGourd, setOpenGourd] = useState<GourdColor | null>(null);

  const pending = pills.filter((entry) => !entry.stored);

  return (
    <>
      <section style={styles.panel}>
        <div style={styles.panelTitle}>玉盒丹药（{pending.length}）</div>
        {pending.length === 0 && <div style={styles.dim}>丹成之后以玉盒承接，即录于此。</div>}
        {pending.map((entry) => (
          <div key={`${entry.pill.id}-${entry.collectedAt}`} style={styles.pillCard}>
            <div style={styles.pillHead}>
              <span
                style={{
                  ...styles.pillDot,
                  background: entry.pill.color,
                  boxShadow: `0 0 8px ${entry.pill.glowColor}`
                }}
              />
              <span style={styles.pillName}>{entry.pill.name}</span>
              <span style={{ color: RARITY_COLORS[entry.pill.rarity], fontSize: 12 }}>
                {RARITY_NAMES[entry.pill.rarity]}
              </span>
            </div>
            <div style={styles.pillMeta}>
              功效：{EFFECT_NAMES[entry.pill.effect] ?? entry.pill.effect} · 出自「
              {entry.furnaceName}」 · 火候 {entry.pill.fireTemp}℃/{entry.pill.airFlow}
            </div>
            <div style={styles.pillMeta}>
              五行：
              {entry.pill.elements.map((element) => (
                <span key={element} style={{ color: ELEMENT_COLORS[element] }}>
                  {ELEMENT_NAMES[element]}
                </span>
              ))}
            </div>
            <div style={styles.pillReason}>依据：{entry.reason}</div>
            <button style={styles.storeButton} onClick={() => onStorePill(entry.pill.id)}>
              收入葫芦
            </button>
          </div>
        ))}
      </section>

      <section style={styles.panel}>
        <div style={styles.panelTitle}>葫芦架</div>
        <div style={styles.gourdRow}>
          {gourds.map((gourd) => (
            <button
              key={gourd.color}
              style={{
                ...styles.gourdButton,
                borderColor: openGourd === gourd.color ? GOURD_GLOW[gourd.color] : '#6b4c3a'
              }}
              onClick={() =>
                setOpenGourd((prev) => (prev === gourd.color ? null : gourd.color))
              }
            >
              <span style={{ ...styles.gourdIcon, background: GOURD_COLORS[gourd.color] }} />
              <span style={styles.gourdName}>{gourd.name}</span>
              <span style={styles.dim}>
                {gourd.pills.length}/{gourd.maxPills}
              </span>
            </button>
          ))}
        </div>
        {openGourd && (
          <div style={styles.gourdList}>
            {gourds
              .filter((gourd) => gourd.color === openGourd)
              .map((gourd) => (
                <div key={gourd.color}>
                  {gourd.pills.length === 0 && <div style={styles.dim}>葫芦空空如也。</div>}
                  {gourd.pills.map((entry, index) => (
                    <div key={`${entry.pill.id}-${index}`} style={styles.gourdPillRow}>
                      <span style={{ ...styles.pillDot, background: entry.pill.color }} />
                      <span>{entry.pill.name}</span>
                      <span style={{ color: RARITY_COLORS[entry.pill.rarity], fontSize: 12 }}>
                        {RARITY_NAMES[entry.pill.rarity]}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
          </div>
        )}
      </section>
    </>
  );
};

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: 'linear-gradient(145deg, #3d2817, #2a1a0e)',
    border: '2px solid #6b4c3a',
    borderRadius: 10,
    padding: '10px 12px'
  },
  panelTitle: {
    fontSize: 16,
    color: '#d4ac0d',
    fontFamily: "'Ma Shan Zheng', cursive",
    marginBottom: 6
  },
  dim: {
    color: '#8b7355',
    fontSize: 12,
    fontFamily: "'ZCOOL KuaiLe', cursive"
  },
  pillCard: {
    border: '1px solid #5c4033',
    borderRadius: 8,
    padding: '6px 8px',
    marginBottom: 8
  },
  pillHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8
  },
  pillDot: {
    width: 12,
    height: 12,
    borderRadius: '50%',
    display: 'inline-block',
    flexShrink: 0
  },
  pillName: {
    color: '#f0e6c8',
    fontSize: 15,
    fontFamily: "'Ma Shan Zheng', cursive",
    flex: 1
  },
  pillMeta: {
    fontSize: 12,
    color: '#b8a888',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    lineHeight: 1.6
  },
  pillReason: {
    fontSize: 12,
    color: '#a89880',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    lineHeight: 1.5,
    marginTop: 2
  },
  storeButton: {
    marginTop: 6,
    padding: '4px 12px',
    background: '#c0392b',
    color: '#f5e6c8',
    border: '1px solid #d4ac0d',
    borderRadius: 6,
    cursor: 'pointer',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    fontSize: 12
  },
  gourdRow: {
    display: 'flex',
    gap: 8
  },
  gourdButton: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    padding: '8px 4px',
    background: 'rgba(42, 26, 14, 0.8)',
    border: '2px solid #6b4c3a',
    borderRadius: 8,
    cursor: 'pointer',
    color: '#d8c9a3'
  },
  gourdIcon: {
    width: 22,
    height: 30,
    borderRadius: '50% 50% 45% 45%'
  },
  gourdName: {
    fontSize: 12,
    fontFamily: "'ZCOOL KuaiLe', cursive"
  },
  gourdList: {
    marginTop: 8,
    borderTop: '1px solid #5c4033',
    paddingTop: 6
  },
  gourdPillRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    color: '#d8c9a3',
    fontFamily: "'ZCOOL KuaiLe', cursive",
    padding: '3px 0'
  }
};

export default PillResult;
