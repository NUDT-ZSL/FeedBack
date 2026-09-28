import { useState } from 'react';
import { X, FileText, Award, AlertCircle } from 'lucide-react';
import type { Role } from '../../types';

interface Props {
  role: Role | null;
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { introduction: string; experience: string }) => Promise<void>;
}

export default function ApplicationModal({ role, open, onClose, onSubmit }: Props) {
  const [introduction, setIntroduction] = useState('');
  const [experience, setExperience] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const resetForm = () => {
    setIntroduction('');
    setExperience('');
    setError('');
    setSubmitting(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (introduction.trim().length < 10) {
      setError('自我介绍至少10个字符');
      return;
    }
    if (introduction.length > 500) {
      setError('自我介绍不能超过500字');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await onSubmit({ introduction: introduction.trim(), experience: experience.trim() });
      handleClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || !role) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm animate-fade-in-up"
        onClick={handleClose}
      />
      <div
        className="relative w-full max-w-lg card !rounded-2xl !shadow-cardHover overflow-hidden
          animate-fade-in-up"
      >
        <div className="wine-gradient px-6 py-5 border-b border-theater-border">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-display text-2xl font-bold text-white">
                申请角色：{role.name}
              </h2>
              <p className="text-sm text-gold-300/80 mt-1">
                请认真填写，您的信息将提交给导演审核
              </p>
            </div>
            <button
              onClick={handleClose}
              className="text-white/70 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="input-label flex items-center gap-2">
              <FileText className="w-4 h-4 text-gold-400" />
              自我介绍 <span className="text-red-400">*</span>
              <span className="ml-auto text-xs text-theater-textMuted font-normal">
                {introduction.length}/500
              </span>
            </label>
            <textarea
              value={introduction}
              onChange={(e) => setIntroduction(e.target.value)}
              rows={5}
              maxLength={500}
              placeholder="请介绍您的表演经历、对这个角色的理解、为什么适合这个角色..."
              className="input resize-none font-body"
              required
            />
          </div>

          <div>
            <label className="input-label flex items-center gap-2">
              <Award className="w-4 h-4 text-gold-400" />
              过往经历
            </label>
            <textarea
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
              rows={3}
              maxLength={300}
              placeholder="列举您演过的剧目、角色名称、获奖情况等（选填）"
              className="input resize-none font-body"
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="btn-ghost"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-gold btn-shake min-w-[120px]"
            >
              {submitting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  提交中...
                </>
              ) : (
                '提交申请'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
