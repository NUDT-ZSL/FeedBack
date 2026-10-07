import { MoveHorizontal, MoveVertical } from 'lucide-react';
import type { CarvingStyle } from '../types/index.ts';
import { FONTS, MAX_CHARS, SEAL_SIZES } from '../types/index.ts';
import { useWorkshopStore } from '../store/workshopStore.ts';
import { offsetOf } from '../utils/sealGenerator.ts';

const NUDGE = 2;

export default function ParamPanel() {
  const seal = useWorkshopStore((s) => s.seals.find((x) => x.id === s.activeId));
  const updateActiveSeal = useWorkshopStore((s) => s.updateActiveSeal);
  const setStrokeOffset = useWorkshopStore((s) => s.setStrokeOffset);

  if (!seal) return null;

  const slotCount = Math.max(Array.from(seal.text).length, 1);

  const nudge = (index: number, dx: number, dy: number) => {
    const current = offsetOf(seal, index);
    setStrokeOffset(index, { x: current.x + dx, y: current.y + dy });
  };

  const resetOffset = (index: number) => {
    const current = offsetOf(seal, index);
    if (current.x === 0 && current.y === 0) return;
    setStrokeOffset(index, { x: 0, y: 0 });
  };

  return (
    <div className="w-72 shrink-0 flex flex-col gap-5 p-4 bg-[#f4ecd8] border-r border-[#c9b78f] overflow-y-auto">
      <div>
        <label className="block text-sm text-[#5a4632] mb-1.5">印文（最多 {MAX_CHARS} 字）</label>
        <input
          type="text"
          data-testid="seal-text-input"
          value={seal.text}
          maxLength={MAX_CHARS}
          placeholder="请输入篆字"
          onChange={(e) => updateActiveSeal({ text: e.target.value })}
          className="w-full rounded-md border border-[#c9b78f] bg-[#fffdf5] px-3 py-2 text-[#3a2c1c] outline-none focus:border-[#b5342a]"
        />
      </div>

      <div>
        <label className="block text-sm text-[#5a4632] mb-1.5">字体</label>
        <select
          data-testid="seal-font-select"
          value={seal.font}
          onChange={(e) => updateActiveSeal({ font: e.target.value as (typeof FONTS)[number]['value'] })}
          className="w-full rounded-md border border-[#c9b78f] bg-[#fffdf5] px-3 py-2 text-[#3a2c1c] outline-none focus:border-[#b5342a]"
        >
          {FONTS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm text-[#5a4632] mb-1.5">印面尺寸</label>
        <div className="flex gap-2">
          {SEAL_SIZES.map((s) => (
            <button
              key={s.value}
              type="button"
              data-testid={`seal-size-${s.value}`}
              onClick={() => updateActiveSeal({ size: s.value })}
              className={
                'flex-1 rounded-md border px-2 py-1.5 text-sm ' +
                (seal.size === s.value
                  ? 'bg-[#b5342a] text-[#fdf6e3] border-[#8f241c]'
                  : 'bg-[#fffdf5] text-[#5a4632] border-[#c9b78f] hover:bg-[#efe3c6]')
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm text-[#5a4632] mb-1.5">刀法</label>
        <div className="flex gap-2">
          {(['yangke', 'yinke'] as CarvingStyle[]).map((style) => (
            <button
              key={style}
              type="button"
              data-testid={`seal-style-${style}`}
              onClick={() => updateActiveSeal({ style })}
              className={
                'flex-1 rounded-md border px-2 py-1.5 text-sm ' +
                (seal.style === style
                  ? 'bg-[#b5342a] text-[#fdf6e3] border-[#8f241c]'
                  : 'bg-[#fffdf5] text-[#5a4632] border-[#c9b78f] hover:bg-[#efe3c6]')
              }
            >
              {style === 'yinke' ? '阴刻（白文）' : '阳刻（朱文）'}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm text-[#5a4632] mb-1.5">笔画偏移（按字微调）</label>
        <div className="flex flex-col gap-2">
          {Array.from({ length: slotCount }).map((_, index) => {
            const chars = Array.from(seal.text);
            const offset = offsetOf(seal, index);
            return (
              <div key={index} className="flex items-center gap-2 rounded-md border border-[#c9b78f] bg-[#fffdf5] px-2 py-1.5">
                <span className="w-6 text-center text-[#5a4632]">{chars[index] ?? '·'}</span>
                <button
                  type="button"
                  aria-label={`第${index + 1}字左移`}
                  onClick={() => nudge(index, -NUDGE, 0)}
                  className="rounded p-1 hover:bg-[#efe3c6]"
                >
                  <MoveHorizontal size={14} className="rotate-180" />
                </button>
                <button
                  type="button"
                  aria-label={`第${index + 1}字右移`}
                  onClick={() => nudge(index, NUDGE, 0)}
                  className="rounded p-1 hover:bg-[#efe3c6]"
                >
                  <MoveHorizontal size={14} />
                </button>
                <button
                  type="button"
                  aria-label={`第${index + 1}字上移`}
                  onClick={() => nudge(index, 0, -NUDGE)}
                  className="rounded p-1 hover:bg-[#efe3c6]"
                >
                  <MoveVertical size={14} className="rotate-90" />
                </button>
                <button
                  type="button"
                  aria-label={`第${index + 1}字下移`}
                  onClick={() => nudge(index, 0, NUDGE)}
                  className="rounded p-1 hover:bg-[#efe3c6]"
                >
                  <MoveVertical size={14} />
                </button>
                <span className="ml-auto text-xs text-[#8a7150] tabular-nums">
                  {offset.x},{offset.y}
                </span>
                <button
                  type="button"
                  onClick={() => resetOffset(index)}
                  className="text-xs text-[#8a7150] hover:text-[#b5342a]"
                >
                  复位
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
