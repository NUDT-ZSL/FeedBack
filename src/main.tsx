import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkshopStore } from './store.ts';
import { WoodType, woodLabels, woodProperties, type FontId } from './types.ts';
import { FONT_CATALOG } from './fonts.ts';
import { renderSvg } from './canvas.ts';
import { WorkshopError } from './errors.ts';
import {
  primaryColor,
  errorColor,
  successColor,
  goldColor,
  fontFamily,
} from './theme.ts';

const store = new WorkshopStore({ offline: true });

const panelStyle: React.CSSProperties = {
  width: 280,
  background: '#f5deb3',
  border: '2px solid #5c3a21',
  borderRadius: 8,
  padding: 16,
  color: '#3a2410',
  fontFamily,
};

const buttonStyle: React.CSSProperties = {
  fontFamily,
  fontSize: 15,
  padding: '6px 14px',
  margin: '4px 4px 4px 0',
  border: `1px solid ${primaryColor}`,
  borderRadius: 6,
  background: '#fff8ec',
  cursor: 'pointer',
  transition: 'transform 0.2s ease-out',
};

function App() {
  const [, setTick] = useState(0);
  const [message, setMessage] = useState('');
  const refresh = () => setTick((n) => n + 1);

  const act = (fn: () => void, okMsg: string) => {
    try {
      fn();
      setMessage(okMsg);
    } catch (err) {
      if (err instanceof WorkshopError) {
        setMessage(`错误[${err.code}]: ${err.message}`);
      } else {
        setMessage(String(err));
      }
    }
    refresh();
  };

  const validation = store.validation;
  const records = store.stampRecords;
  const svg = renderSvg(records);

  const download = () => {
    act(() => {
      const artwork = store.exportArtwork();
      const blob = new Blob([artwork.svg], { type: artwork.format });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'seal-artwork.svg';
      a.click();
      URL.revokeObjectURL(url);
    }, '已导出并清空画布');
  };

  return (
    <div style={{ display: 'flex', gap: 24, padding: 24, alignItems: 'flex-start' }}>
      <div>
        <h2 style={{ color: goldColor, fontFamily, marginTop: 0 }}>盖印画布</h2>
        <div
          style={{ border: `2px solid ${primaryColor}`, borderRadius: 8, overflow: 'hidden', width: 480 }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div style={{ marginTop: 8 }}>
          <button style={buttonStyle} onClick={() => act(() => store.stamp(), '已盖印')} disabled={store.phase !== 'carved'}>
            盖印
          </button>
          <button style={buttonStyle} onClick={() => act(() => store.clearCanvas(), '画布已清空')} disabled={records.length === 0}>
            清空画布
          </button>
          <button style={buttonStyle} onClick={download} disabled={records.length === 0}>
            导出
          </button>
        </div>
      </div>

      <div style={panelStyle}>
        <h2 style={{ marginTop: 0 }}>刻印台</h2>
        <div>阶段：{store.phase}</div>
        <div style={{ margin: '8px 0' }}>
          {Object.values(WoodType).map((wood) => (
            <button
              key={wood}
              style={{
                ...buttonStyle,
                background: store.selectedWood === wood ? primaryColor : '#fff8ec',
              }}
              onClick={() => act(() => store.selectWood(wood), `已选${woodLabels[wood]}`)}
              disabled={store.phase === 'carved'}
            >
              {woodLabels[wood]}
            </button>
          ))}
        </div>
        {store.selectedWood && (
          <div style={{ fontSize: 13 }}>
            硬度{woodProperties[store.selectedWood].hardness} 韧性
            {woodProperties[store.selectedWood].toughness} 耐久
            {woodProperties[store.selectedWood].durability}
          </div>
        )}
        <div style={{ margin: '8px 0' }}>
          尺寸(mm)：
          <input
            type="number"
            style={{ width: 64, fontFamily }}
            value={store.params.sizeMm}
            disabled={store.phase !== 'drafting'}
            onChange={(e) => act(() => store.updateParams({ sizeMm: Number(e.target.value) }), '')}
          />
          {validation.minSizeMm !== null && (
            <span style={{ fontSize: 12 }}>
              （可刻 {validation.minSizeMm}–{validation.maxSizeMm}）
            </span>
          )}
        </div>
        <div style={{ margin: '8px 0' }}>
          印文：
          <input
            style={{ width: 120, fontFamily }}
            value={store.params.text}
            maxLength={8}
            disabled={store.phase !== 'drafting'}
            onChange={(e) => act(() => store.updateParams({ text: e.target.value }), '')}
          />
        </div>
        <div style={{ margin: '8px 0' }}>
          字体：
          <select
            style={{ fontFamily }}
            value={store.params.fontId}
            disabled={store.phase !== 'drafting'}
            onChange={(e) => act(() => store.updateParams({ fontId: e.target.value as FontId }), '')}
          >
            {FONT_CATALOG.map((f) => (
              <option key={f.id} value={f.id} disabled={!validation.availableFonts.includes(f.id)}>
                {f.label}
                {f.remote && !f.cached ? '（在线，离线不可用）' : ''}
              </option>
            ))}
          </select>
        </div>
        <div style={{ color: validation.ok ? successColor : errorColor, minHeight: 20, fontSize: 13 }}>
          {validation.idle ? '请先选择木料' : validation.ok ? '参数可刻制' : `校验未通过: ${validation.codes.join(', ')}`}
        </div>
        <div>
          <button
            style={buttonStyle}
            onClick={() => act(() => { store.carve(); }, '刻制完成，可以盖印')}
            disabled={store.phase !== 'drafting' || !validation.ok}
          >
            刻制
          </button>
          <button
            style={buttonStyle}
            onClick={() => act(() => store.finishSeal(), '本印方完成，开始下一方')}
            disabled={store.phase !== 'carved'}
          >
            完成本印
          </button>
          <button style={buttonStyle} onClick={() => act(() => store.reset(), '已重置')}>
            重置
          </button>
        </div>
        <div style={{ marginTop: 8, fontSize: 13, color: '#5c3a21' }}>{message}</div>
        <div style={{ marginTop: 8, fontSize: 13 }}>
          已完成 {store.completedSeals.length} 方 · 画布 {records.length} 枚盖印
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
