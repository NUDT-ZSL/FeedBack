import { memo, useState } from 'react';
import { X, Plus, User, Phone, FileText, Send } from 'lucide-react';
import type { ProductStyle, LeatherType, PresetColor } from '@/utils/types';
import {
  PRODUCT_STYLES,
  LEATHER_TYPES,
  SIZE_OPTIONS,
  STYLE_NAMES,
  LEATHER_NAMES,
  REMARK_MAX_LENGTH,
} from '@/utils/constants';
import { ColorSwatch } from '@/modules/common/ColorSwatch';
import { useAppStore } from '@/store/useAppStore';

interface NewOrderFormProps {
  open: boolean;
  onClose: () => void;
}

export const NewOrderForm = memo(function NewOrderForm({
  open,
  onClose,
}: NewOrderFormProps) {
  const { createOrder, showToast, fetchLowStock } = useAppStore();
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [style, setStyle] = useState<ProductStyle>('wallet');
  const [leatherType, setLeatherType] = useState<LeatherType>('vegetable_tanned');
  const [color, setColor] = useState<PresetColor | null>('tan');
  const [size, setSize] = useState<string>(SIZE_OPTIONS.wallet[0]);
  const [remark, setRemark] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!open) return null;

  const sizes = SIZE_OPTIONS[style];

  const handleStyleChange = (s: ProductStyle) => {
    setStyle(s);
    setSize(SIZE_OPTIONS[s][0]);
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!customerName.trim()) e.customerName = '请输入客户姓名';
    if (!/^1[3-9]\d{9}$/.test(customerPhone))
      e.customerPhone = '请输入有效的手机号';
    if (!color) e.color = '请选择颜色';
    if (remark.length > REMARK_MAX_LENGTH)
      e.remark = `备注不能超过${REMARK_MAX_LENGTH}字`;
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !color) return;
    setSubmitting(true);
    try {
      const order = await createOrder({
        customerName: customerName.trim(),
        customerPhone,
        style,
        leatherType,
        color,
        size,
        remark: remark.trim(),
      });
      showToast(`订单 #${order.id} 创建成功！`, 'success');
      await fetchLowStock();
      onClose();
      resetForm();
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setCustomerName('');
    setCustomerPhone('');
    setStyle('wallet');
    setLeatherType('vegetable_tanned');
    setColor('tan');
    setSize(SIZE_OPTIONS.wallet[0]);
    setRemark('');
    setErrors({});
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-0 md:p-6"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/50 animate-fadeOut"
        style={{ animation: 'fadeIn 0.2s ease-out' }}
        onClick={onClose}
      />
      <form
        onSubmit={handleSubmit}
        className="relative w-full md:max-w-xl md:max-h-[90vh] bg-brand-cream md:rounded-card rounded-t-3xl
          shadow-2xl overflow-hidden animate-slideInTop flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-dark/10 bg-white/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-brown to-[#A67F1D] flex items-center justify-center">
              <Plus className="w-4 h-4 text-white" />
            </div>
            <h3 className="font-display text-lg font-bold text-brand-dark">
              新建定制订单
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-brand-dark/5 active:scale-95 transition-all"
          >
            <X className="w-5 h-5 text-brand-dark/60" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-1.5 text-sm text-brand-dark/70 mb-1.5">
                <User className="w-3.5 h-3.5" />
                客户姓名 <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="请输入客户姓名"
                className={`w-full px-4 py-2.5 rounded-xl border text-sm
                  focus:outline-none focus:ring-2 focus:ring-brand-brown/20 transition
                  ${errors.customerName
                    ? 'border-danger/60 focus:border-danger/60'
                    : 'border-brand-dark/10 focus:border-brand-brown/40'
                  } bg-white/80`}
              />
              {errors.customerName && (
                <p className="text-[11px] text-danger mt-1">
                  {errors.customerName}
                </p>
              )}
            </div>
            <div>
              <label className="flex items-center gap-1.5 text-sm text-brand-dark/70 mb-1.5">
                <Phone className="w-3.5 h-3.5" />
                联系电话 <span className="text-danger">*</span>
              </label>
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) =>
                  setCustomerPhone(e.target.value.replace(/\D/g, '').slice(0, 11))
                }
                placeholder="11位手机号"
                className={`w-full px-4 py-2.5 rounded-xl border text-sm font-mono-num
                  focus:outline-none focus:ring-2 focus:ring-brand-brown/20 transition
                  ${errors.customerPhone
                    ? 'border-danger/60 focus:border-danger/60'
                    : 'border-brand-dark/10 focus:border-brand-brown/40'
                  } bg-white/80`}
              />
              {errors.customerPhone && (
                <p className="text-[11px] text-danger mt-1">
                  {errors.customerPhone}
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm text-brand-dark/70 mb-2">
              款式 <span className="text-danger">*</span>
            </label>
            <div className="grid grid-cols-4 gap-2">
              {PRODUCT_STYLES.map((s) => {
                const selected = s === style;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => handleStyleChange(s)}
                    className={`py-3 rounded-xl text-sm font-medium transition-all active:scale-95
                      ${selected
                        ? 'bg-gradient-to-br from-brand-brown to-[#A67F1D] text-white shadow-md shadow-brand-brown/20'
                        : 'bg-white/80 text-brand-dark/70 border border-brand-dark/10 hover:border-brand-brown/30 hover:text-brand-dark'
                      }`}
                  >
                    {STYLE_NAMES[s]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm text-brand-dark/70 mb-2">
              皮料类型 <span className="text-danger">*</span>
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {LEATHER_TYPES.map((l) => {
                const selected = l === leatherType;
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLeatherType(l)}
                    className={`py-2.5 px-3 rounded-xl text-sm font-medium transition-all active:scale-95
                      ${selected
                        ? 'bg-gradient-to-br from-brand-dark to-[#5A4230] text-white shadow-md shadow-brand-dark/20'
                        : 'bg-white/80 text-brand-dark/70 border border-brand-dark/10 hover:border-brand-brown/30 hover:text-brand-dark'
                      }`}
                  >
                    {LEATHER_NAMES[l]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm text-brand-dark/70 mb-2">
              颜色 <span className="text-danger">*</span>
            </label>
            <ColorSwatch value={color} onChange={setColor} size="lg" />
            {errors.color && (
              <p className="text-[11px] text-danger mt-2">{errors.color}</p>
            )}
          </div>

          <div>
            <label className="block text-sm text-brand-dark/70 mb-2">
              尺寸
            </label>
            <div className="flex flex-wrap gap-2">
              {sizes.map((sz) => {
                const selected = sz === size;
                return (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => setSize(sz)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-all active:scale-95
                      ${selected
                        ? 'bg-brand-brown text-white shadow-md shadow-brand-brown/20'
                        : 'bg-white/80 text-brand-dark/70 border border-brand-dark/10 hover:border-brand-brown/30 hover:text-brand-dark'
                      }`}
                  >
                    {sz}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="flex items-center justify-between text-sm text-brand-dark/70 mb-1.5">
              <span className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                客户备注
              </span>
              <span
                className={`text-[10px] font-mono-num ${
                  remark.length > REMARK_MAX_LENGTH ? 'text-danger' : 'text-brand-dark/40'
                }`}
              >
                {remark.length}/{REMARK_MAX_LENGTH}
              </span>
            </label>
            <textarea
              rows={3}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="特殊定制要求、刻字内容、加急需求等..."
              maxLength={REMARK_MAX_LENGTH + 20}
              className={`w-full px-4 py-2.5 rounded-xl border text-sm resize-none
                focus:outline-none focus:ring-2 focus:ring-brand-brown/20 transition
                ${errors.remark
                  ? 'border-danger/60 focus:border-danger/60'
                  : 'border-brand-dark/10 focus:border-brand-brown/40'
                } bg-white/80`}
            />
            {errors.remark && (
              <p className="text-[11px] text-danger mt-1">{errors.remark}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 px-5 py-4 border-t border-brand-dark/10 bg-white/50">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-brand-dark/10 text-brand-dark/70 font-medium hover:bg-brand-dark/5 active:scale-[0.98] transition-all"
          >
            取消
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-[1.5] py-3 rounded-xl bg-gradient-to-r from-brand-brown to-[#A67F1D] text-white font-semibold interactive-btn flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-brand-brown/20"
          >
            {submitting ? (
              <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            提交订单
          </button>
        </div>
      </form>
    </div>
  );
});
