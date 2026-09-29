import { memo, useEffect, useState } from 'react';
import {
  User,
  Phone,
  Calendar,
  Clock,
  Package,
  Palette,
  Ruler,
  FileText,
  ArrowLeft,
  CheckCircle2,
} from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import type { Order, OrderStage } from '@/utils/types';
import {
  STYLE_NAMES,
  LEATHER_NAMES,
  COLOR_PALETTE,
  COLOR_NAMES,
  STATUS_NAMES,
  STATUS_COLORS,
  STAGE_ORDER,
  REMARK_MAX_LENGTH,
} from '@/utils/constants';
import { useAppStore } from '@/store/useAppStore';
import { getOrderById as fetchOrderById } from '@/services/dataService';
import { StageBubble } from '@/modules/common/StageBubble';
import { ProgressBar } from '@/modules/common/ProgressBar';

export const OrderDetailPanel = memo(function OrderDetailPanel() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    getOrderById,
    fetchOrders,
    completeStageAction,
    calculateProgressPercent,
    showToast,
  } = useAppStore();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [durationInput, setDurationInput] = useState<Record<string, string>>({});
  const [noteInput, setNoteInput] = useState<Record<string, string>>({});
  const [completingStage, setCompletingStage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!id) return;
      setLoading(true);
      let found = getOrderById(id);
      if (!found) {
        await fetchOrders('all', 1, 200);
        found = getOrderById(id);
      }
      if (!found) {
        const remote = await fetchOrderById(id);
        found = remote ?? null;
      }
      setOrder(found);
      setLoading(false);
    })();
  }, [id, getOrderById, fetchOrders]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="flex items-center gap-3 text-brand-dark/60">
          <div className="w-5 h-5 border-2 border-brand-brown/30 border-t-brand-brown rounded-full animate-spin" />
          正在加载订单详情...
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="p-8 text-center">
        <div className="text-brand-dark/60 mb-4">未找到订单 #{id}</div>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="px-4 py-2 rounded-card bg-brand-brown text-white interactive-btn"
        >
          返回看板
        </button>
      </div>
    );
  }

  const percent = calculateProgressPercent(order);

  const handleCompleteStage = async (stageKey: OrderStage) => {
    const durStr = durationInput[stageKey] || '';
    const dur = parseInt(durStr, 10);
    if (!dur || dur <= 0) {
      showToast('请填写有效的耗时（分钟）', 'error');
      return;
    }
    setCompletingStage(stageKey);
    const updated = await completeStageAction(
      order!.id,
      stageKey,
      dur,
      noteInput[stageKey] || undefined,
    );
    if (updated) {
      setOrder(updated);
      showToast(`${STAGE_NAMES_MAP[stageKey]} 阶段完成`, 'success');
      setDurationInput((p) => ({ ...p, [stageKey]: '' }));
      setNoteInput((p) => ({ ...p, [stageKey]: '' }));
    }
    setCompletingStage(null);
  };

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="p-2 rounded-xl hover:bg-brand-dark/5 active:scale-95 transition-all"
          aria-label="返回"
        >
          <ArrowLeft className="w-5 h-5 text-brand-dark" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-display text-2xl font-bold text-brand-dark">
              订单 <span className="font-mono-num">#{order.id}</span>
            </h2>
            <span
              className={`text-xs px-3 py-1 rounded-full border ${STATUS_COLORS[order.status]} font-medium`}
            >
              {STATUS_NAMES[order.status]}
            </span>
          </div>
          <div className="text-xs text-brand-dark/50 mt-1">
            创建于 {order.createdAt}
          </div>
        </div>
        <div className="hidden md:block w-16 h-16 rounded-2xl shadow-inner border-4 border-white/60"
          style={{ backgroundColor: COLOR_PALETTE[order.color] }}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 card-leather rounded-card shadow-card p-5 md:p-6 space-y-4">
          <h3 className="font-semibold text-brand-dark flex items-center gap-2">
            <div className="w-1 h-5 rounded-full bg-brand-brown" />
            制作进度看板
          </h3>
          <div className="pb-2">
            <ProgressBar stages={order.stages} size="lg" showPercent={false} />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-brand-dark/60">总进度</span>
              <span className="font-mono-num text-lg font-bold text-brand-brown">
                {percent}%
              </span>
            </div>
          </div>
          <div className="relative pt-4">
            <div className="flex gap-2 md:gap-3 overflow-x-auto scrollbar-thin pb-2 -mx-1 px-1">
              {order.stages.map((stage, idx) => {
                const isLast = idx === order.stages.length - 1;
                const canComplete = stage.status === 'current';

                const actionPanel = (
                  <div className="w-full rounded-xl border border-brand-dark/10 bg-white/70 p-3 mt-2 text-left shadow-sm animate-fadeOut">
                    {stage.startedAt && (
                      <div className="text-[11px] text-brand-dark/50 mb-2">
                        开始于 {stage.startedAt}
                      </div>
                    )}
                    <div className="space-y-2">
                      <div>
                        <label className="block text-[11px] text-brand-dark/60 mb-1">
                          耗时（分钟）
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={durationInput[stage.stage] || stage.durationMinutes || ''}
                          onChange={(e) =>
                            setDurationInput((p) => ({
                              ...p,
                              [stage.stage]: e.target.value,
                            }))
                          }
                          className="w-full px-3 py-2 rounded-lg border border-brand-dark/10 text-sm focus:outline-none focus:border-brand-brown/40 focus:ring-2 focus:ring-brand-brown/10 transition"
                          placeholder="例如：120"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-brand-dark/60 mb-1">
                          备注（可选）
                        </label>
                        <textarea
                          rows={2}
                          value={noteInput[stage.stage] || stage.note || ''}
                          onChange={(e) =>
                            setNoteInput((p) => ({
                              ...p,
                              [stage.stage]: e.target.value,
                            }))
                          }
                          maxLength={REMARK_MAX_LENGTH}
                          className="w-full px-3 py-2 rounded-lg border border-brand-dark/10 text-sm focus:outline-none focus:border-brand-brown/40 focus:ring-2 focus:ring-brand-brown/10 transition resize-none"
                          placeholder="本阶段的特殊说明..."
                        />
                      </div>
                      {canComplete && (
                        <button
                          type="button"
                          disabled={completingStage === stage.stage}
                          onClick={() => handleCompleteStage(stage.stage)}
                          className="w-full py-2 rounded-lg bg-gradient-to-r from-success to-[#7CB068] text-white text-sm font-semibold interactive-btn flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {completingStage === stage.stage ? (
                            <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4" />
                          )}
                          标记完成
                        </button>
                      )}
                    </div>
                  </div>
                );

                return (
                  <StageBubble
                    key={stage.stage}
                    stage={stage}
                    index={idx}
                    isLast={isLast}
                    actionPanel={canComplete || stage.status === 'completed' ? actionPanel : undefined}
                  />
                );
              })}
            </div>
          </div>

          <div className="mt-6 border-t border-brand-dark/10 pt-4">
            <h4 className="text-sm font-semibold text-brand-dark mb-3">
              阶段时间日志
            </h4>
            <div className="space-y-1 text-xs">
              {order.stages.map((s, idx) => {
                const alt = idx % 2 === 0;
                return (
                  <div
                    key={s.stage}
                    className={`px-3 py-2 rounded-lg flex items-center gap-3 transition-colors duration-200
                      ${alt ? 'bg-white/60' : 'bg-brand-dark/[0.03]'}
                      hover:bg-brand-brown/10`}
                  >
                    <span className="w-24 text-brand-dark/60 flex-shrink-0">
                      {s.name}
                    </span>
                    <span className="flex-1 min-w-0 text-brand-dark/80 truncate">
                      {s.startedAt ? (
                        <>
                          {s.startedAt.slice(5)}
                          {s.completedAt && ` → ${s.completedAt.slice(5)}`}
                        </>
                      ) : (
                        <span className="text-brand-dark/30">未开始</span>
                      )}
                    </span>
                    {s.durationMinutes && (
                      <span className="font-mono-num text-brand-brown font-semibold flex-shrink-0">
                        {s.durationMinutes}分钟
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="card-leather rounded-card shadow-card p-5 space-y-3">
            <h3 className="font-semibold text-brand-dark flex items-center gap-2">
              <div className="w-1 h-5 rounded-full bg-brand-brown" />
              客户信息
            </h3>
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center gap-2.5">
                <User className="w-4 h-4 text-brand-brown flex-shrink-0" />
                <span className="text-brand-dark/60 w-14">客户</span>
                <span className="font-medium text-brand-dark">
                  {order.customerName}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <Phone className="w-4 h-4 text-brand-brown flex-shrink-0" />
                <span className="text-brand-dark/60 w-14">电话</span>
                <span className="font-mono-num text-brand-dark">
                  {order.customerPhone}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <Calendar className="w-4 h-4 text-brand-brown flex-shrink-0" />
                <span className="text-brand-dark/60 w-14">下单</span>
                <span className="text-brand-dark text-xs">
                  {order.createdAt}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-brand-brown flex-shrink-0" />
                <span className="text-brand-dark/60 w-14">预计</span>
                <span className="text-brand-dark text-xs">
                  {order.estimatedCompletionDate}
                </span>
              </div>
            </div>
          </div>

          <div className="card-leather rounded-card shadow-card p-5 space-y-3">
            <h3 className="font-semibold text-brand-dark flex items-center gap-2">
              <div className="w-1 h-5 rounded-full bg-brand-brown" />
              定制规格
            </h3>
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center gap-2.5">
                <Package className="w-4 h-4 text-brand-brown flex-shrink-0" />
                <span className="text-brand-dark/60 w-14">款式</span>
                <span className="font-medium text-brand-dark">
                  {STYLE_NAMES[order.style]}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <Palette className="w-4 h-4 text-brand-brown flex-shrink-0" />
                <span className="text-brand-dark/60 w-14">皮料</span>
                <span className="text-brand-dark">
                  {LEATHER_NAMES[order.leatherType]}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                  <div
                    className="w-4 h-4 rounded-md border border-white/60 shadow-inner"
                    style={{ backgroundColor: COLOR_PALETTE[order.color] }}
                  />
                </div>
                <span className="text-brand-dark/60 w-14">颜色</span>
                <span className="text-brand-dark">
                  {COLOR_NAMES[order.color]}
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <Ruler className="w-4 h-4 text-brand-brown flex-shrink-0" />
                <span className="text-brand-dark/60 w-14">尺寸</span>
                <span className="text-brand-dark">{order.size}</span>
              </div>
            </div>
          </div>

          {order.remark && (
            <div className="card-leather rounded-card shadow-card p-5 space-y-2">
              <h3 className="font-semibold text-brand-dark flex items-center gap-2">
                <div className="w-1 h-5 rounded-full bg-brand-brown" />
                客户备注
              </h3>
              <div className="flex items-start gap-2.5 text-sm">
                <FileText className="w-4 h-4 text-brand-brown mt-0.5 flex-shrink-0" />
                <p className="text-brand-dark/80 leading-relaxed">
                  {order.remark}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

const STAGE_NAMES_MAP: Record<OrderStage, string> = {
  design: '设计确认',
  cutting: '开料',
  stitching: '缝制',
  edge_painting: '边油',
  hardware: '五金安装',
};
