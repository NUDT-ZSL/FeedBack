import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDivinationStore } from '@/store/divinationStore';
import HexagramCompare from '@/components/HexagramCompare';
import DeductionPanel from '@/components/DeductionPanel';
import { formatDateTime } from '@/utils/datetime';

export default function RecordDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const record = useDivinationStore((s) => s.records.find((item) => item.id === id));
  const updateQuestion = useDivinationStore((s) => s.updateQuestion);
  const deleteRecord = useDivinationStore((s) => s.deleteRecord);

  if (!record) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-[#8a6d1f]/50 bg-[#faf3e3] p-10 text-center text-stone-500">
        <p className="text-lg">该记录不存在或已被删除</p>
        <Link
          to="/records"
          className="rounded-lg bg-[#5d3a1a] px-5 py-2 text-sm text-[#f0e6d3] transition hover:bg-[#6b4423]"
        >
          返回卦档
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[#2a1a0a]">
            {record.benGua.fullName}
            {record.bianGua.binary !== record.benGua.binary && (
              <span className="text-[#8a6d1f]"> 之 {record.bianGua.fullName}</span>
            )}
          </h2>
          <p className="mt-1 text-xs text-stone-500">起卦时刻：{formatDateTime(record.createdAt)}</p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/records"
            className="rounded-lg border border-[#8a6d1f]/50 px-4 py-2 text-sm text-[#5d3a1a] transition hover:bg-[#b8860b]/10"
          >
            返回卦档
          </Link>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('确认删除这条起卦记录？')) {
                deleteRecord(record.id);
                navigate('/records');
              }
            }}
            className="rounded-lg border border-red-700/50 px-4 py-2 text-sm text-red-700 transition hover:bg-red-700/10"
          >
            删除此记录
          </button>
        </div>
      </header>

      <section className="rounded-2xl border border-[#8a6d1f]/40 bg-[#faf3e3] p-6 shadow-sm">
        <HexagramCompare
          benGua={record.benGua}
          bianGua={record.bianGua}
          movingPositions={record.movingPositions}
          figureSize="lg"
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-[#8a6d1f]/40 bg-[#faf3e3] p-4 shadow-sm">
          <h3 className="mb-2 text-base font-bold text-[#5d3a1a]">本卦《{record.benGua.name}》</h3>
          <p className="text-sm leading-relaxed text-[#2a1a0a]">{record.benGua.guaCi}</p>
          <p className="mt-2 text-xs text-stone-500">象曰：{record.benGua.xiangCi}</p>
        </div>
        <div className="rounded-xl border border-[#8a6d1f]/40 bg-[#faf3e3] p-4 shadow-sm">
          <h3 className="mb-2 text-base font-bold text-[#5d3a1a]">
            变卦《{record.bianGua.name}》
            {record.bianGua.binary === record.benGua.binary && (
              <span className="ml-2 text-xs font-normal text-stone-500">（无动爻，同本卦）</span>
            )}
          </h3>
          <p className="text-sm leading-relaxed text-[#2a1a0a]">{record.bianGua.guaCi}</p>
          <p className="mt-2 text-xs text-stone-500">象曰：{record.bianGua.xiangCi}</p>
        </div>
      </section>

      <section className="rounded-xl border border-[#8a6d1f]/40 bg-[#faf3e3] p-4 shadow-sm">
        <label htmlFor="detail-question" className="mb-1 block text-sm font-bold text-[#5d3a1a]">
          所问之事
        </label>
        <textarea
          id="detail-question"
          rows={2}
          value={record.question}
          onChange={(event) => updateQuestion(record.id, event.target.value)}
          placeholder="补记本次所问之事，随记录一同保存…"
          className="w-full rounded-lg border border-[#b8860b]/40 bg-white/80 p-2 text-sm text-[#2a1a0a] outline-none focus:border-[#b8860b]"
        />
      </section>

      <DeductionPanel
        deduction={record.deduction}
        benGuaName={record.benGua.name}
        bianGuaName={record.bianGua.name}
      />
    </div>
  );
}
