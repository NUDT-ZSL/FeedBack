import { Link } from 'react-router-dom';
import { useDivinationStore } from '@/store/divinationStore';
import CoinBox from '@/components/CoinBox';
import HexagramFigure from '@/components/HexagramFigure';
import HexagramCompare from '@/components/HexagramCompare';
import DeductionPanel from '@/components/DeductionPanel';
import { yaoArrayToBinary } from '@/utils/hexagramCalc';

const YAO_TYPE_TEXT: Record<string, string> = {
  'lao-yang': '老阳（三正，阳动）',
  'lao-yin': '老阴（三背，阴动）',
  'shao-yang': '少阳（两正一背）',
  'shao-yin': '少阴（两背一正）',
};

export default function CastPage() {
  const yaos = useDivinationStore((s) => s.yaos);
  const casting = useDivinationStore((s) => s.casting);
  const lastCoins = useDivinationStore((s) => s.lastCoins);
  const lastRecordId = useDivinationStore((s) => s.lastRecordId);
  const records = useDivinationStore((s) => s.records);
  const throwCoins = useDivinationStore((s) => s.throwCoins);
  const resetBoard = useDivinationStore((s) => s.resetBoard);
  const updateQuestion = useDivinationStore((s) => s.updateQuestion);

  const complete = yaos.length === 6;
  const record = complete ? records.find((item) => item.id === lastRecordId) : undefined;
  const lastYao = yaos[yaos.length - 1];

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
      {/* 占卦桌 */}
      <section className="flex flex-col items-center gap-5 rounded-2xl border border-[#8a6d1f]/40 bg-[#faf3e3] p-6 shadow-sm">
        <h2 className="text-lg font-bold text-[#5d3a1a]">占卦桌</h2>

        <CoinBox casting={casting} lastCoins={lastCoins} disabled={complete} onThrow={throwCoins} />

        {/* 步骤指示器 */}
        <div className="flex items-center gap-2">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <span
              key={index}
              className={
                index < yaos.length
                  ? 'h-3 w-3 rounded-full bg-[#b8860b]'
                  : 'h-3 w-3 rounded-full border border-[#b8860b]/50'
              }
            />
          ))}
          <span className="ml-2 text-sm text-stone-500">
            {complete ? '卦已成' : `已摇 ${yaos.length}/6 爻`}
          </span>
        </div>

        {lastYao && !complete && (
          <p className="text-sm text-stone-600">
            第{['一', '二', '三', '四', '五', '六'][yaos.length - 1]}爻：
            {YAO_TYPE_TEXT[lastYao.type]}
            {lastYao.isMoving && <span className="ml-1 font-bold text-red-700">· 动爻</span>}
          </p>
        )}

        {/* 实时卦象（自下而上） */}
        {yaos.length > 0 && (
          <div className="flex flex-col items-center gap-2">
            <HexagramFigure
              binary={yaoArrayToBinary(yaos).padEnd(6, '0')}
              movingPositions={yaos.filter((y) => y.isMoving).map((y) => y.position)}
              dimmedPositions={[1, 2, 3, 4, 5, 6].filter((p) => p > yaos.length)}
              size="md"
            />
            <p className="text-xs text-stone-400">初爻在最下，未摇出的爻以空爻占位</p>
          </div>
        )}

        <button
          type="button"
          onClick={resetBoard}
          className="rounded-lg border border-[#8a6d1f]/50 px-4 py-2 text-sm text-[#5d3a1a] transition hover:bg-[#b8860b]/10"
        >
          清空卦盘，重新起卦
        </button>
      </section>

      {/* 卦成展示 */}
      <section className="rounded-2xl border border-[#8a6d1f]/40 bg-[#faf3e3] p-6 shadow-sm">
        {!record ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center gap-3 text-center text-stone-500">
            <p className="text-base">六爻摇满后，本卦、变卦与断卦推演将在此呈现</p>
            <p className="text-xs">三正为老阳（阳动），三背为老阴（阴动），动爻阴阳互换即成变卦</p>
          </div>
        ) : (
          <div className="space-y-5">
            <header className="border-b border-[#b8860b]/30 pb-3">
              <h2 className="text-xl font-bold text-[#2a1a0a]">
                {record.benGua.fullName}
                {record.bianGua.binary !== record.benGua.binary && (
                  <span className="text-[#8a6d1f]"> 之 {record.bianGua.fullName}</span>
                )}
              </h2>
              <p className="mt-1 text-xs text-stone-500">已自动归档，刷新后仍可在「卦档」中回看</p>
            </header>

            <HexagramCompare
              benGua={record.benGua}
              bianGua={record.bianGua}
              movingPositions={record.movingPositions}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-white/60 p-3">
                <p className="mb-1 text-xs font-bold text-[#8a6d1f]">本卦卦辞</p>
                <p className="text-sm leading-relaxed text-[#2a1a0a]">{record.benGua.guaCi}</p>
                <p className="mt-1 text-xs text-stone-500">象曰：{record.benGua.xiangCi}</p>
              </div>
              {record.bianGua.binary !== record.benGua.binary && (
                <div className="rounded-lg bg-white/60 p-3">
                  <p className="mb-1 text-xs font-bold text-[#8a6d1f]">变卦卦辞</p>
                  <p className="text-sm leading-relaxed text-[#2a1a0a]">{record.bianGua.guaCi}</p>
                  <p className="mt-1 text-xs text-stone-500">象曰：{record.bianGua.xiangCi}</p>
                </div>
              )}
            </div>

            <div>
              <label htmlFor="question" className="mb-1 block text-sm font-bold text-[#5d3a1a]">
                所问之事
              </label>
              <textarea
                id="question"
                rows={2}
                value={record.question}
                onChange={(event) => updateQuestion(record.id, event.target.value)}
                placeholder="可补记本次所问之事，随记录一同保存…"
                className="w-full rounded-lg border border-[#b8860b]/40 bg-white/80 p-2 text-sm text-[#2a1a0a] outline-none focus:border-[#b8860b]"
              />
            </div>

            <DeductionPanel
              deduction={record.deduction}
              benGuaName={record.benGua.name}
              bianGuaName={record.bianGua.name}
            />

            <Link
              to={`/records/${record.id}`}
              className="inline-block rounded-lg bg-[#5d3a1a] px-4 py-2 text-sm text-[#f0e6d3] transition hover:bg-[#6b4423]"
            >
              查看归档详情
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
