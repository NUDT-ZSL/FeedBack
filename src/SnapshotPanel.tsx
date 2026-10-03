import React, { useRef, useState } from 'react';
import { Snapshot } from './SnapshotManager';

export interface SnapshotNotice {
  type: 'success' | 'error';
  text: string;
}

interface SnapshotPanelProps {
  snapshots: Snapshot[];
  selectedSnapshotId: string | null;
  deviated: boolean;
  notice: SnapshotNotice | null;
  onSave: (name: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onImportFile: (file: File) => void;
}

const SnapshotPanel: React.FC<SnapshotPanelProps> = ({
  snapshots,
  selectedSnapshotId,
  deviated,
  notice,
  onSave,
  onSelect,
  onDelete,
  onExport,
  onImportFile,
}) => {
  const [nameInput, setNameInput] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSaveClick = () => {
    onSave(nameInput.trim() || `快照 ${snapshots.filter((s) => !s.isBaseline).length + 1}`);
    setNameInput('');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onImportFile(file);
    e.target.value = '';
  };

  const smallButtonStyle: React.CSSProperties = {
    padding: '4px 10px',
    fontSize: '12px',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: 600,
    transition: 'all 0.1s ease',
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
        maxHeight: 'calc(100vh - 40px)',
      }}
    >
      <div
        style={{
          height: '3px',
          background: 'linear-gradient(90deg, #4fc3f7 0%, #ff7043 100%)',
          flexShrink: 0,
        }}
      />

      <div style={{ padding: '16px', overflowY: 'auto' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}
        >
          <span style={{ fontSize: '13px', color: '#37474f', fontWeight: 600 }}>
            参数快照
          </span>
          {deviated && (
            <span
              style={{
                fontSize: '11px',
                color: '#e65100',
                backgroundColor: '#fff3e0',
                border: '1px solid #ffcc80',
                borderRadius: '4px',
                padding: '2px 6px',
                fontWeight: 600,
              }}
            >
              已偏离所选快照
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
          <input
            type="text"
            value={nameInput}
            placeholder="快照名称"
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveClick();
            }}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '6px 8px',
              fontSize: '12px',
              border: '1px solid #e0e0e0',
              borderRadius: '4px',
              outline: 'none',
            }}
          />
          <button
            onClick={handleSaveClick}
            style={{
              ...smallButtonStyle,
              backgroundColor: '#26a69a',
              color: '#ffffff',
              flexShrink: 0,
            }}
          >
            保存当前
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
          {snapshots.map((snapshot) => {
            const isSelected = snapshot.id === selectedSnapshotId;
            return (
              <div
                key={snapshot.id}
                onClick={() => onSelect(snapshot.id)}
                style={{
                  border: isSelected ? '2px solid #26a69a' : '1px solid #e0e0e0',
                  borderRadius: '6px',
                  padding: '8px 10px',
                  cursor: 'pointer',
                  backgroundColor: isSelected ? '#e0f2f1' : '#fafafa',
                  transition: 'all 0.1s ease',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#37474f',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {snapshot.name}
                    {snapshot.isBaseline && (
                      <span style={{ color: '#90a4ae', fontWeight: 400 }}>（基准）</span>
                    )}
                  </span>
                  <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(snapshot.id);
                      }}
                      style={{
                        ...smallButtonStyle,
                        backgroundColor: isSelected ? '#00897b' : '#26a69a',
                        color: '#ffffff',
                      }}
                    >
                      应用
                    </button>
                    {!snapshot.isBaseline && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(snapshot.id);
                        }}
                        style={{
                          ...smallButtonStyle,
                          backgroundColor: '#ef5350',
                          color: '#ffffff',
                        }}
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    color: '#78909c',
                    fontFamily: 'monospace',
                    marginTop: '4px',
                  }}
                >
                  {snapshot.ballCount} 球 · 阻力 {snapshot.damping.toFixed(3)} · 质量[
                  {snapshot.masses.map((m) => m.toFixed(1)).join(', ')}]
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={onExport}
            style={{
              ...smallButtonStyle,
              flex: 1,
              padding: '8px 0',
              backgroundColor: '#eceff1',
              color: '#37474f',
              border: '1px solid #cfd8dc',
            }}
          >
            ⬇ 导出快照
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              ...smallButtonStyle,
              flex: 1,
              padding: '8px 0',
              backgroundColor: '#eceff1',
              color: '#37474f',
              border: '1px solid #cfd8dc',
            }}
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

        {notice && (
          <div
            style={{
              marginTop: '10px',
              padding: '8px 10px',
              fontSize: '11px',
              lineHeight: 1.5,
              borderRadius: '4px',
              whiteSpace: 'pre-line',
              color: notice.type === 'error' ? '#c62828' : '#2e7d32',
              backgroundColor: notice.type === 'error' ? '#ffebee' : '#e8f5e9',
              border: `1px solid ${notice.type === 'error' ? '#ef9a9a' : '#a5d6a7'}`,
            }}
          >
            {notice.text}
          </div>
        )}
      </div>
    </div>
  );
};

export default SnapshotPanel;
