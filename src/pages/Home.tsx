import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDivinationStore } from '@/store';
import { getHexagramByBinary } from '@/data/hexagrams';
import { deriveBianBinary, getMovingPositions, yaoArrayToBinary } from '@/utils/hexagramCalc';
import CoinBox from '@/components/CoinBox';
import HexagramView from '@/components/HexagramView';
import DeductionView from '@/components/DeductionView';
import RecordList from '@/components/RecordList';
import RecordDetail from '@/components/RecordDetail';

type Tab = 'cast' | 'archive';

/** 摇卦过程中的六爻进度（未满六爻时空位显示虚线） */
function CastProgress() {
  const { yaos } = useDivinationStore();
  const slots = [6, 5, 4, 3, 2, 1];
  return (
    <div className="flex w-44 flex-col gap-1">
      {slots.map((position) => {
        const yao = yaos[position - 1];
        if (!yao) {
          return (
            <div key={position} className="flex items-center gap-2">
              <span className="w-4 shrink-0" />
              <div className="h-2.5 flex-1 rounded-sm border border-dashed border-stone-400/70" />
              <span className="w-4 shrink-0" />
            </div>
          );
        }
        return (
          <div key={position} className="flex items-center gap-2">
            <span
              className={cn(
                'w-4 shrink-0 text-center font-kai text-xs',
                yao.isMoving ? 'font-bold text-red-700' : 'text-stone-500'
              )}
            >
              {position}
            </span>
            <div className="h-2.5 flex-1">
              {yao.isYang ? (
                <div className={cn('h-full w-full rounded-sm', yao.isMoving ? 'bg-red-800' : 'bg-stone-800')} />
              ) : (
                <div className="flex h-full w-full items-stretch justify-between">
                  <div className={cn('h-full w-[46%] rounded-sm', yao.isMoving ? 'bg-red-800' : 'bg-stone-800')} />
                  <div className={cn('h-full w-[46%] rounded-sm', yao.isMoving ? 'bg-red-800' : 'bg-stone-800')} />
                </div>
              )}
            </div>
            <span
              className={cn(
                'w-4 shrink-0 text-center text-xs font-bold',
                yao.isMoving ? 'text-red-700' : 'text-transparent'
              )}
            >
              {yao.isYang ? '○' : '×'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** 成卦后的结果面板：本卦/变卦对照 + 断卦推演 + 所问之事 */
function CastResult() {
  const { yaos, currentRecordId, records, updateQuestion } = useDivinationStore();
  const record = records.find((r) => r.id === currentRecordId);
  const [question, setQuestion] = useState('');

  if (yaos.length !== 6) return null;

  const benBinary = yaoArrayToBinary(yaos);
  const movingPositions = getMovingPositions(yaos);
  const bianBinary = deriveBianBinary(benBinary, movingPositions);
  const ben = getHexagramByBinary(benBinary);
  const bian = getHexagramByBinary(bianBinary);

  return (
    <div className="fade-in mt-6 space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-amber-900/20 bg-[#f8f1e2] p-4">
          <h3 className="font-kai mb-3 text-center text-lg font-bold text-amber-900">本卦</h3>
          <div className="mb-3 flex justify-center">
            <HexagramView binary={benBinary} movingPositions={movingPositions} />
          </div>
          <p className="font-kai mb-2 text-center text-xl font-bold">{ben?.name}</p>
          <p className="font-kai text-sm leading-relaxed text-stone-800">{ben?.guaCi}</p>
          <p className="font-kai mt-2 text-sm leading-relaxed text-stone-600">{ben?.xiangCi}</p>
        </div>
        <div className="rounded-lg border border-amber-900/20 bg-[#f8f1e2] p-4">
          <h3 className="font-kai mb-3 text-center text-lg font-bold text-amber-900">
            {bianBinary === benBinary ? '变卦（无动爻，与本卦一致）' : '变卦'}
          </h3>
          <div className="mb-3 flex justify-center">
            <HexagramView binary={bianBinary} changedPositions={movingPositions} />
          </div>
          <p className="font-kai mb-2 text-center text-xl font-bold">{bian?.name}</p>
          <p className="font-kai text-sm leading-relaxed text-stone-800">{bian?.guaCi}</p>
          <p className="font-kai mt-2 text-sm leading-relaxed text-stone-600">{bian?.xiangCi}</p>
        </div>
      </div>

      <DeductionView benBinary={benBinary} movingPositions={movingPositions} />

      {record && (
        <div className="rounded-lg border border-amber-900/20 bg-[#f8f1e2] p-4">
          <label htmlFor="cast-question" className="mb-1 block text-sm font-bold text-stone-700">
            所问之事（随记录归档）
          </label>
          <div className="flex gap-2">
            <textarea
              id="cast-question"
              rows={2}
              defaultValue={record.question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="补记本次起卦所问之事…"
              className="flex-1 resize-none rounded border border-stone-300 bg-white px-3 py-2 text-sm focus:border-amber-700 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => updateQuestion(record.id, question)}
              className="flex items-center gap-1 self-start rounded bg-amber-800 px-3 py-2 text-sm text-white hover:bg-amber-900"
            >
              <Save className="h-4 w-4" /> 保存
            </button>
          </div>
          <p className="mt-2 text-xs text-stone-500">本卦已自动存入「卦录」，刷新页面后仍可回看。</p>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>('cast');
  const { selectedId, records, selectRecord, complete, currentRecordId } = useDivinationStore();
  const selected = records.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    if (selectedId && !selected) {
      selectRecord(null);
    }
  }, [selectedId, selected, selectRecord]);

  return (
    <div className="min-h-screen">
      <header className="border-b border-amber-900/20 bg-[#e8dcc8]/80">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <h1 className="font-kai text-2xl font-bold tracking-widest text-amber-950">六爻占卜</h1>
          <nav className="flex gap-2">
            {(
              [
                ['cast', '起卦'],
                ['archive', '卦录'],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  selectRecord(null);
                  setTab(key);
                }}
                className={cn(
                  'rounded-lg px-4 py-1.5 font-kai text-sm transition',
                  (selected ? 'archive' : tab) === key
                    ? 'bg-amber-800 text-white shadow'
                    : 'text-stone-700 hover:bg-amber-800/10'
                )}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main>
        {selected ? (
          <RecordDetail record={selected} />
        ) : tab === 'archive' ? (
          <RecordList />
        ) : (
          <div className="mx-auto max-w-4xl px-4 py-6">
            <div className="grid gap-6 md:grid-cols-2">
              <CoinBox />
              <div className="rounded-xl border border-amber-900/25 bg-[#e8dcc8] p-5">
                <h2 className="font-kai mb-3 text-xl font-bold text-amber-950">卦盘</h2>
                <div className="flex justify-center py-2">
                  <CastProgress />
                </div>
                {!complete && (
                  <p className="mt-2 text-center text-xs text-stone-500">
                    阳爻为实线，阴爻为断线；老阳 ○、老阴 × 为动爻（红色标记）
                  </p>
                )}
              </div>
            </div>
            {complete && <CastResult key={currentRecordId ?? 'none'} />}
          </div>
        )}
      </main>
    </div>
  );
}
