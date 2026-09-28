import React from 'react';
import { BandTheme, ElementConfig, BAND_THEMES, FONT_OPTIONS } from './types';
import { Trash2, Type, Calendar, MapPin, Ticket, Plus, Minus, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';

interface ToolPanelProps {
  currentBandId: string;
  elements: ElementConfig[];
  selectedId: string | null;
  customCss: string;
  onSelectBand: (id: string) => void;
  onSelectElement: (id: string | null) => void;
  onUpdateElement: (id: string, updates: Partial<ElementConfig>) => void;
  onAddElement: (type: ElementConfig['type']) => void;
  onDeleteElement: (id: string) => void;
  onCustomCssChange: (css: string) => void;
}

const typeLabels: Record<ElementConfig['type'], { label: string; icon: React.ReactNode }> = {
  title: { label: '标题', icon: <Type size={14} /> },
  date: { label: '时间', icon: <Calendar size={14} /> },
  venue: { label: '地点', icon: <MapPin size={14} /> },
  price: { label: '票价', icon: <Ticket size={14} /> },
  custom: { label: '自定义', icon: <Type size={14} /> },
};

const ToolPanel: React.FC<ToolPanelProps> = ({
  currentBandId,
  elements,
  selectedId,
  customCss,
  onSelectBand,
  onSelectElement,
  onUpdateElement,
  onAddElement,
  onDeleteElement,
  onCustomCssChange,
}) => {
  const currentTheme = BAND_THEMES.find((b) => b.id === currentBandId)!;
  const selectedEl = elements.find((e) => e.id === selectedId);

  return (
    <div className="w-full h-full overflow-y-auto bg-[#16162a] border-r border-[#2a2a4a] text-white p-4 space-y-5">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-cyan-400 mb-3 flex items-center gap-2">
          🎵 选择乐队风格
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {BAND_THEMES.map((band) => (
            <button
              key={band.id}
              onClick={() => onSelectBand(band.id)}
              className={`p-3 rounded-lg text-left transition-all duration-200 border-2 ${
                currentBandId === band.id
                  ? 'border-cyan-400 shadow-lg shadow-cyan-400/20 scale-[1.02]'
                  : 'border-transparent hover:border-[#3a3a5a]'
              }`}
              style={{
                background:
                  currentBandId === band.id
                    ? `linear-gradient(135deg, ${band.secondaryColor}, ${band.secondaryColor}88)`
                    : '#1e1e38',
              }}
            >
              <div className="text-2xl mb-1">{band.emoji}</div>
              <div className="text-xs font-bold truncate" style={{ color: band.primaryColor }}>
                {band.genre}
              </div>
              <div className="text-[10px] text-gray-400 truncate mt-0.5">{band.name}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-[#2a2a4a] pt-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-pink-400 mb-3">
          ➕ 添加元素
        </h3>
        <div className="grid grid-cols-5 gap-1.5">
          {(['title', 'date', 'venue', 'price', 'custom'] as const).map((t) => (
            <button
              key={t}
              onClick={() => onAddElement(t)}
              className="flex flex-col items-center gap-1 p-2 rounded-md bg-[#1e1e38] hover:bg-[#2a2a4a] transition-colors text-xs border border-transparent hover:border-pink-400/40"
              title={typeLabels[t].label}
            >
              <span className="text-pink-400">{typeLabels[t].icon}</span>
              <span className="text-[10px] text-gray-300">{typeLabels[t].label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-[#2a2a4a] pt-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-purple-400 mb-3">
          📋 元素列表
        </h3>
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {elements.length === 0 && (
            <div className="text-[11px] text-gray-500 italic text-center py-3">
              还没有元素，点击上方添加
            </div>
          )}
          {elements.map((el) => (
            <div
              key={el.id}
              onClick={() => onSelectElement(el.id)}
              className={`flex items-center gap-2 p-2 rounded-md cursor-pointer transition-all ${
                selectedId === el.id
                  ? 'bg-purple-500/20 border border-purple-400/50'
                  : 'bg-[#1e1e38] hover:bg-[#2a2a4a] border border-transparent'
              }`}
            >
              <span className="text-purple-400">{typeLabels[el.type].icon}</span>
              <span className="flex-1 text-xs truncate text-gray-200">{el.content}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteElement(el.id);
                }}
                className="p-1 text-red-400/70 hover:text-red-400 hover:bg-red-500/10 rounded"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {selectedEl && (
        <div className="border-t border-[#2a2a4a] pt-4 space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-widest text-amber-400 mb-3">
            ⚙️ 元素属性
          </h3>

          <div>
            <label className="block text-[11px] text-gray-400 mb-1.5">内容文本</label>
            <textarea
              value={selectedEl.content}
              onChange={(e) => onUpdateElement(selectedEl.id, { content: e.target.value })}
              className="w-full px-3 py-2 text-sm bg-[#0f0f1e] border border-[#3a3a5a] rounded-md text-white focus:border-amber-400 focus:outline-none resize-none"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-[11px] text-gray-400 mb-1.5">字体</label>
            <select
              value={selectedEl.fontFamily}
              onChange={(e) => onUpdateElement(selectedEl.id, { fontFamily: e.target.value })}
              className="w-full px-3 py-2 text-sm bg-[#0f0f1e] border border-[#3a3a5a] rounded-md text-white focus:border-amber-400 focus:outline-none"
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-400 mb-1.5">字号</label>
              <div className="flex items-center gap-1">
                <button
                  onClick={() =>
                    onUpdateElement(selectedEl.id, {
                      fontSize: Math.max(10, selectedEl.fontSize - 4),
                    })
                  }
                  className="p-1.5 bg-[#2a2a4a] rounded text-gray-400 hover:text-white hover:bg-[#3a3a5a]"
                >
                  <Minus size={12} />
                </button>
                <input
                  type="number"
                  value={selectedEl.fontSize}
                  onChange={(e) =>
                    onUpdateElement(selectedEl.id, { fontSize: Number(e.target.value) })
                  }
                  className="flex-1 px-2 py-1.5 text-sm bg-[#0f0f1e] border border-[#3a3a5a] rounded text-center text-white focus:border-amber-400 focus:outline-none"
                />
                <button
                  onClick={() =>
                    onUpdateElement(selectedEl.id, {
                      fontSize: Math.min(200, selectedEl.fontSize + 4),
                    })
                  }
                  className="p-1.5 bg-[#2a2a4a] rounded text-gray-400 hover:text-white hover:bg-[#3a3a5a]"
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-gray-400 mb-1.5">字重</label>
              <select
                value={selectedEl.fontWeight}
                onChange={(e) =>
                  onUpdateElement(selectedEl.id, { fontWeight: Number(e.target.value) })
                }
                className="w-full px-2 py-2 text-sm bg-[#0f0f1e] border border-[#3a3a5a] rounded-md text-white focus:border-amber-400 focus:outline-none"
              >
                <option value={400}>常规</option>
                <option value={500}>中等</option>
                <option value={600}>半粗</option>
                <option value={700}>粗体</option>
                <option value={900}>特粗</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-gray-400 mb-1.5">颜色</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={selectedEl.color}
                  onChange={(e) => onUpdateElement(selectedEl.id, { color: e.target.value })}
                  className="w-10 h-9 rounded cursor-pointer border border-[#3a3a5a] bg-transparent"
                />
                <input
                  type="text"
                  value={selectedEl.color}
                  onChange={(e) => onUpdateElement(selectedEl.id, { color: e.target.value })}
                  className="flex-1 px-2 py-1.5 text-xs font-mono bg-[#0f0f1e] border border-[#3a3a5a] rounded text-white focus:border-amber-400 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-[11px] text-gray-400 mb-1.5">对齐</label>
              <div className="flex gap-1">
                {(['left', 'center', 'right'] as const).map((a) => (
                  <button
                    key={a}
                    onClick={() => onUpdateElement(selectedEl.id, { textAlign: a })}
                    className={`flex-1 p-1.5 rounded ${
                      selectedEl.textAlign === a
                        ? 'bg-amber-400/20 text-amber-400 border border-amber-400/40'
                        : 'bg-[#2a2a4a] text-gray-400 hover:text-white'
                    }`}
                  >
                    {a === 'left' && <AlignLeft size={14} />}
                    {a === 'center' && <AlignCenter size={14} />}
                    {a === 'right' && <AlignRight size={14} />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-lg bg-[#0f0f1e] border border-[#3a3a5a]">
            <div className="text-[10px] text-gray-500 mb-1 uppercase tracking-wider">当前风格主题色</div>
            <div className="flex items-center gap-2 text-xs">
              <span className="w-5 h-5 rounded" style={{ backgroundColor: currentTheme.primaryColor }} />
              <span style={{ color: currentTheme.primaryColor }}>{currentTheme.primaryColor}</span>
              <button
                onClick={() => onUpdateElement(selectedEl.id, { color: currentTheme.primaryColor })}
                className="ml-auto text-[10px] px-2 py-1 rounded bg-[#2a2a4a] hover:bg-[#3a3a5a] text-gray-300"
              >
                应用
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="border-t border-[#2a2a4a] pt-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-green-400 mb-3">
          💻 CSS 自定义样式
        </h3>
        <textarea
          value={customCss}
          onChange={(e) => onCustomCssChange(e.target.value)}
          placeholder={'/* 例如:\n[class*="title"] {\n  text-shadow: 0 0 20px gold;\n}\n画布根元素: [data-canvas-export] */'}
          className="w-full h-36 px-3 py-2 text-[11px] font-mono bg-[#0a0a18] border border-[#3a3a5a] rounded-md text-green-300 focus:border-green-400 focus:outline-none resize-none leading-relaxed"
          spellCheck={false}
        />
      </div>
    </div>
  );
};

export default ToolPanel;
