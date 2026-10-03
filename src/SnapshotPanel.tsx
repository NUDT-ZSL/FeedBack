import React, { useRef, useState } from 'react';
import { Snapshot } from './snapshots';

export interface ImportFeedback {
  kind: 'success' | 'error';
  text: string;
}

interface SnapshotPanelProps {
  snapshots: Snapshot[];
  selectedId: string | null;
  dirty: boolean;
  feedback: ImportFeedback[];
  onSave: (name: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

const SnapshotPanel: React.FC<SnapshotPanelProps> = ({
  snapshots,
  selectedId,
  dirty,
  feedback,
  onSave,
  onSelect,
  onDelete,
  onExport,
  onImport,
}) => {
  const [nameInput, setNameInput] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const baseline = snapshots.find((s) => s.isBaseline) ?? null;
  const selected = snapshots.find((s) => s.id === selectedId) ?? null;

  const handleSave = () => {
    const name = nameInput.trim() || `快照 ${snapshots.length}`;
    onSave(name);
    setNameInput('');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onImport(file);
    e.target.value = '';
  };

  const smallButtonStyle: React.CSSProperties = {
    padding: '6px 10px',
    backgroundColor: '#26a69a',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 600,
    flexShrink: 0,
  };

  const renderDiffVsBaseline = (snap: Snapshot) => {
    if (!baseline || snap.id === baseline.id) return null;
    const diffs: string[] = [];
    if (snap.ballCount !== baseline.ballCount) {
      diffs.push(`数量 ${baseline.ballCount} → ${snap.ballCount}`);
    }
    if (snap.damping !== baseline.damping) {
      diffs.push(`阻力 ${baseline.damping.toFixed(3)} → ${snap.damping.toFixed(3)}`);
    }
    const maxLen = Math.max(snap.masses.length, baseline.masses.length);
    const massDiffs: string[] = [];
    for (let i = 0; i < maxLen; i++) {
      const a = baseline.masses[i];
      const b = snap.masses[i];
      if (a !== b) massDiffs.push(`#${i + 1} ${a === undefined ? '—' : a.toFixed(1)}→${b === undefined ? '—' : b.toFixed(1)}`);
    }
    if (massDiffs.length > 0) diffs.push(`质量 ${massDiffs.join(', ')}`);
    return (
      <div style={{ fontSize: '11px', color: '#78909c', marginTop: '4px', lineHeight: 1.5 }}>
        {diffs.length === 0 ? '与基准快照一致' : `对比基准：${diffs.join('；')}`}
      </div>
    );
  };

  return (
    <div
      style={{
        width: '280px',
        backgroundColor: '#ffffff',
        border: '2px solid #e0e0e0',
        borderRadius: '8px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          height: '3px',
          background: 'linear-gradient(90deg, #4fc3f7 0%, #ff7043 100%)',
          flexShrink: 0,
        }}
      />
      <div
        style={{
          padding: '12px 16px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}
      >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', color: '#37474f', fontWeight: 600 }}>参数快照</span>
        {selected ? (
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '10px',
              backgroundColor: dirty ? '#fff3e0' : '#e0f2f1',
              color: dirty ? '#ef6c00' : '#00897b',
              fontWeight: 600,
            }}
          >
            {dirty ? `● 已偏离「${selected.name}」` : `✓ 与「${selected.name}」一致`}
          </span>
        ) : (
          <span
            style={{
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '10px',
              backgroundColor: '#eceff1',
              color: '#607d8b',
              fontWeight: 600,
            }}
          >
            未选中快照
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: '6px' }}>
        <input
          type="text"
          value={nameInput}
          placeholder="快照名称…"
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
          }}
          style={{
            flex: 1,
            minWidth: 0,
            padding: '6px 8px',
            fontSize: '12px',
            border: '1px solid #e0e0e0',
            borderRadius: '6px',
            outline: 'none',
          }}
        />
        <button style={smallButtonStyle} onClick={handleSave}>
          保存当前
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '220px', overflowY: 'auto' }}>
        {snapshots.map((snap) => {
          const isSelected = snap.id === selectedId;
          return (
            <div
              key={snap.id}
              onClick={() => onSelect(snap.id)}
              title="点击应用该快照参数"
              style={{
                border: `1px solid ${isSelected ? '#26a69a' : '#e0e0e0'}`,
                backgroundColor: isSelected ? '#f0faf9' : '#ffffff',
                borderRadius: '6px',
                padding: '8px 10px',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#37474f', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {snap.name}
                </span>
                {snap.isBaseline && (
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '1px 6px',
                      borderRadius: '8px',
                      backgroundColor: '#4fc3f7',
                      color: 'white',
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    基准
                  </span>
                )}
                {isSelected && dirty && (
                  <span style={{ fontSize: '10px', color: '#ef6c00', fontWeight: 600, flexShrink: 0 }}>
                    ● 已修改
                  </span>
                )}
                {!snap.isBaseline && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(snap.id);
                    }}
                    title="删除快照"
                    style={{
                      border: 'none',
                      background: 'none',
                      color: '#b0bec5',
                      cursor: 'pointer',
                      fontSize: '13px',
                      padding: '0 2px',
                      flexShrink: 0,
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>
              <div style={{ fontSize: '11px', color: '#90a4ae', marginTop: '2px', fontFamily: 'monospace' }}>
                {snap.ballCount}球 · 质量[{snap.masses.map((m) => m.toFixed(1)).join(',')}] · 阻力{snap.damping.toFixed(3)}
              </div>
              {isSelected && renderDiffVsBaseline(snap)}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '6px' }}>
        <button style={{ ...smallButtonStyle, flex: 1 }} onClick={onExport}>
          ⬇ 导出快照
        </button>
        <button
          style={{ ...smallButtonStyle, flex: 1 }}
          onClick={() => fileInputRef.current?.click()}
        >
          ⬆ 导入快照
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </div>

      {feedback.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {feedback.map((msg, i) => (
            <div
              key={i}
              style={{
                fontSize: '11px',
                lineHeight: 1.5,
                padding: '6px 8px',
                borderRadius: '4px',
                backgroundColor: msg.kind === 'error' ? '#ffebee' : '#e0f2f1',
                color: msg.kind === 'error' ? '#c62828' : '#00695c',
              }}
            >
              {msg.text}
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
};

export default SnapshotPanel;
