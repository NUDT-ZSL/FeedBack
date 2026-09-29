import { memo, useState } from 'react';
import { Search, Calendar, User, AlertCircle, Clock } from 'lucide-react';
import type { Order } from '@/utils/types';
import { useAppStore } from '@/store/useAppStore';
import { getOrderById as fetchOrderById } from '@/services/dataService';
import {
  STYLE_NAMES,
  LEATHER_NAMES,
  COLOR_NAMES,
  STATUS_NAMES,
  STATUS_COLORS,
  STAGE_NAMES,
  ORDER_ID_LENGTH,
} from '@/utils/constants';
import { ProgressBar } from '@/modules/common/ProgressBar';

export const TrackOrderForm = memo(function TrackOrderForm() {
  const { calculateProgressPercent } = useAppStore();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Order | null>(null);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const code = input.trim().toUpperCase();
    setError('');
    setResult(null);

    if (code.length !== ORDER_ID_LENGTH) {
      setError(`请输入${ORDER_ID_LENGTH}位订单号`);
      return;
    }

    setLoading(true);
    try {
      const order = await fetchOrderById(code);
      if (order) {
        setResult(order);
      } else {
        setError('未找到对应订单，请确认订单号是否正确');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-8 space-y-6">
      <div className="text-center mb-2">
        <h2 className="font-display text-2xl md:text-3xl font-bold text-brand-dark mb-2">
          查询定制进度
        </h2>
        <p className="text-sm text-brand-dark/60">
          请输入您的{ORDER_ID_LENGTH}位订单号，实时查看制作进度
        </p>
      </div>

      <form
        onSubmit={handleSearch}
        className="card-leather rounded-card shadow-card p-5 md:p-6"
      >
        <label className="block text-sm text-brand-dark/70 mb-2">
          订单号
        </label>
        <div className="flex gap-2 md:gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-brand-dark/40" />
            <input
              type="text"
              value={input}
              onChange={(e) =>
                setInput(
                  e.target.value
                    .replace(/[^A-Za-z0-9]/g, '')
                    .toUpperCase()
                    .slice(0, ORDER_ID_LENGTH),
                )
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch();
              }}
              placeholder={`请输入${ORDER_ID_LENGTH}位订单号，如：AB1234`}
              className={`w-full pl-12 pr-4 py-3.5 rounded-xl border text-lg font-mono-num tracking-widest
                focus:outline-none focus:ring-2 focus:ring-brand-brown/20 transition
                ${error
                  ? 'border-danger/50 focus:border-danger/60'
                  : 'border-brand-dark/10 focus:border-brand-brown/40'
                } bg-white/80`}
              maxLength={ORDER_ID_LENGTH}
            />
          </div>
          <button
            type="submit"
            disabled={loading || input.length !== ORDER_ID_LENGTH}
            className="px-5 md:px-7 py-3.5 rounded-xl bg-gradient-to-r from-brand-brown to-[#A67F1D] text-white font-semibold
              interactive-btn disabled:opacity-50 disabled:cursor-not-allowed
              shadow-lg shadow-brand-brown/20 flex items-center gap-2 whitespace-nowrap"
          >
            {loading ? (
              <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <Search className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">查询</span>
          </button>
        </div>
        {error && (
          <div className="mt-3 px-3 py-2 rounded-lg bg-danger/10 text-danger text-xs flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {error}
          </div>
        )}
      </form>

      {result && (
        <div className="card-leather rounded-card shadow-card p-5 md:p-7 animate-slideInTop space-y-6">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                <span className="font-display text-2xl font-bold text-brand-brown font-mono-num">
                  #{result.id}
                </span>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full border ${STATUS_COLORS[result.status]} font-medium`}
                >
                  {STATUS_NAMES[result.status]}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-brand-dark/60">
                <span className="flex items-center gap-1">
                  <User className="w-3.5 h-3.5" />
                  {result.customerName}
                </span>
                <span>·</span>
                <span>
                  {STYLE_NAMES[result.style]} · {LEATHER_NAMES[result.leatherType]} ·{' '}
                  {COLOR_NAMES[result.color]} · {result.size}
                </span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-brand-dark/50 uppercase tracking-wider mb-1">
                预计完成
              </div>
              <div className="flex items-center gap-1 text-brand-dark font-semibold">
                <Calendar className="w-4 h-4 text-brand-brown" />
                {result.estimatedCompletionDate}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-brand-dark">
                整体进度
              </h4>
              <span className="font-mono-num text-xl font-bold text-brand-brown">
                {calculateProgressPercent(result)}%
              </span>
            </div>
            <ProgressBar stages={result.stages} size="lg" showPercent={false} />
          </div>

          <div className="border-t border-brand-dark/10 pt-5">
            <h4 className="text-sm font-semibold text-brand-dark mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-brand-brown" />
              阶段时间日志
            </h4>
            <div className="space-y-1.5">
              {result.stages.map((s, idx) => {
                const alt = idx % 2 === 0;
                const statusLabel =
                  s.status === 'completed'
                    ? '已完成'
                    : s.status === 'current'
                      ? '进行中'
                      : '待开始';
                const statusColor =
                  s.status === 'completed'
                    ? 'bg-success/10 text-success'
                    : s.status === 'current'
                      ? 'bg-warning/10 text-warning'
                      : 'bg-brand-dark/5 text-brand-dark/40';
                return (
                  <div
                    key={s.stage}
                    className={`px-4 py-3 rounded-xl flex items-center gap-4 transition-colors duration-200
                      ${alt ? 'bg-white/70' : 'bg-brand-dark/[0.03]'}
                      hover:bg-brand-brown/10 cursor-default`}
                  >
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center font-display font-bold text-sm flex-shrink-0
                        ${s.status === 'completed'
                          ? 'bg-gradient-to-br from-success to-[#7CB068] text-white'
                          : s.status === 'current'
                            ? 'bg-gradient-to-br from-warning to-[#F5A962] text-white animate-pulseGlow'
                            : 'bg-progress-gray/60 text-white/80'
                        }`}
                    >
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-medium text-brand-dark text-sm">
                          {STAGE_NAMES[s.stage]}
                        </span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor}`}
                        >
                          {statusLabel}
                        </span>
                      </div>
                      <div className="text-xs text-brand-dark/50 truncate">
                        {s.startedAt ? (
                          <>
                            开始 {s.startedAt}
                            {s.completedAt && (
                              <>
                                {' '}
                                → 完成 {s.completedAt}
                                {s.durationMinutes && (
                                  <span className="text-brand-brown ml-1">
                                    （{s.durationMinutes}分钟）
                                  </span>
                                )}
                              </>
                            )}
                          </>
                        ) : (
                          <span className="italic">尚未开始</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {result.remark && (
            <div className="pt-4 border-t border-brand-dark/10">
              <div className="text-xs text-brand-dark/50 mb-1">定制备注</div>
              <p className="text-sm text-brand-dark/80 leading-relaxed bg-white/60 rounded-lg px-4 py-2.5 border border-white/80">
                {result.remark}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
