import { memo } from 'react';
import { CheckCircle, AlertCircle, Info } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { ToastMessage } from '@/utils/types';

function ToastItem({ toast }: { toast: ToastMessage }) {
  const { removeToast, toasts } = useAppStore();
  const idx = toasts.findIndex((t) => t.id === toast.id);
  const bottomOffset = idx * 60;
  const fade = Date.now() - toast.createdAt > 2000;

  const bgMap: Record<ToastMessage['type'], string> = {
    success: 'bg-gradient-to-r from-success to-[#7CB068]',
    error: 'bg-gradient-to-r from-danger to-[#D86256]',
    info: 'bg-gradient-to-r from-[#5B8FA8] to-[#7CB0C4]',
  };

  const iconMap: Record<ToastMessage['type'], React.ReactNode> = {
    success: <CheckCircle className="w-5 h-5" strokeWidth={2.5} />,
    error: <AlertCircle className="w-5 h-5" strokeWidth={2.5} />,
    info: <Info className="w-5 h-5" strokeWidth={2.5} />,
  };

  return (
    <div
      className={`fixed z-[100] left-1/2 -translate-x-1/2 w-[92%] max-w-sm pointer-events-auto
        ${bgMap[toast.type]} text-white rounded-card shadow-cardHover
        flex items-center gap-3 px-4 py-3
        ${fade ? 'animate-fadeOut' : 'animate-slideInTop'}`}
      style={{ top: 20 + bottomOffset }}
      role="alert"
    >
      {iconMap[toast.type]}
      <span className="flex-1 text-sm font-medium">{toast.text}</span>
      <button
        type="button"
        onClick={() => removeToast(toast.id)}
        className="text-white/80 hover:text-white text-lg leading-none px-1 active:scale-90 transition-all"
        aria-label="关闭提示"
      >
        ×
      </button>
    </div>
  );
}

function ToastContainerComponent() {
  const toasts = useAppStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-0 z-[99]">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

ToastContainerComponent.displayName = 'ToastContainer';
export const ToastContainer = memo(ToastContainerComponent);
