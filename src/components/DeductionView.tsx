import { deduce } from '@/utils/divination';

interface DeductionViewProps {
  benBinary: string;
  movingPositions: number[];
}

/** 断卦推演：变卦推导说明 + 变爻结论 + 参考卦辞 */
export default function DeductionView({ benBinary, movingPositions }: DeductionViewProps) {
  const result = deduce(benBinary, movingPositions);

  return (
    <div className="fade-in rounded-lg border border-amber-900/20 bg-[#f8f1e2] p-4">
      <h3 className="font-kai mb-2 text-lg font-bold text-amber-900">断卦推演</h3>

      <p className="mb-1 text-sm text-stone-700">
        动爻 {result.movingCount} 个
        {result.movingCount > 0 && `（第 ${[...movingPositions].sort((a, b) => a - b).join('、')} 爻）`}
        ，{result.allMoving ? '六爻全动' : result.movingCount === 0 ? '六爻安静' : '部分爻动'}。
      </p>
      <p className="mb-3 text-sm text-stone-700">
        本卦「{result.ben.name}」
        {result.bianBinary === result.benBinary
          ? '，无动爻，不变。'
          : `，之「${result.bian.name}」。`}
      </p>
      <p className="mb-3 rounded bg-amber-100/70 px-3 py-2 text-sm font-medium text-amber-900">
        {result.rule}
      </p>

      {result.yongCi && (
        <div className="mb-3 rounded border border-red-800/30 bg-red-50 px-3 py-2">
          <span className="font-kai font-bold text-red-800">{result.yongCi}</span>
        </div>
      )}

      {result.readings.length > 0 && (
        <div className="mb-3">
          <h4 className="mb-1 text-sm font-bold text-stone-800">变爻结论</h4>
          <ul className="space-y-2">
            {result.readings.map((reading) => (
              <li
                key={reading.position}
                className="rounded border border-stone-300/60 bg-white/60 px-3 py-2"
              >
                <div className="mb-0.5 flex items-baseline gap-2 text-sm">
                  <span className="font-kai font-bold text-amber-900">{reading.label}</span>
                  <span className="text-xs text-stone-500">
                    取自{reading.source === 'ben' ? '本卦' : '变卦'}「{reading.hexagramName}」
                  </span>
                  {reading.primary ? (
                    <span className="rounded bg-red-800/10 px-1.5 text-xs text-red-800">主断</span>
                  ) : (
                    <span className="rounded bg-stone-500/10 px-1.5 text-xs text-stone-500">辅断</span>
                  )}
                </div>
                <p className="font-kai text-sm text-stone-800">{reading.yaoCi}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.guaCiRefs.length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-bold text-stone-800">卦辞参考</h4>
          <ul className="space-y-2">
            {result.guaCiRefs.map((ref) => (
              <li
                key={ref.source}
                className="rounded border border-stone-300/60 bg-white/60 px-3 py-2"
              >
                <div className="mb-0.5 text-sm">
                  <span className="font-kai font-bold text-amber-900">{ref.hexagramName}</span>
                  <span className="ml-2 text-xs text-stone-500">{ref.note}</span>
                </div>
                <p className="font-kai text-sm text-stone-800">{ref.guaCi}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
