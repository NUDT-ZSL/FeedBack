import {
  User,
  Users,
  MessageSquareQuote,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
} from 'lucide-react';
import type { Role, User as UserType, Application } from '../../types';
import { formatGender } from '../../utils/format';

interface Props {
  role: Role;
  index?: number;
  isDirector?: boolean;
  isActor?: boolean;
  currentUserId?: string;
  hasApplied?: boolean;
  applications?: Application[];
  onApply?: (role: Role) => void;
  onViewApplications?: (role: Role) => void;
  onApprove?: (appId: string) => void;
  onReject?: (appId: string) => void;
}

export default function RoleCard({
  role,
  index = 0,
  isDirector = false,
  isActor = false,
  currentUserId,
  hasApplied = false,
  applications = [],
  onApply,
  onViewApplications,
  onApprove,
  onReject,
}: Props) {
  const animDelay = Math.min(index * 0.08, 0.7);

  return (
    <div
      className="card card-hover overflow-hidden fade-in-up"
      style={{ animationDelay: `${animDelay}s` }}
    >
      <div className="wine-gradient px-5 py-4 relative">
        <div className="absolute top-0 right-0 w-32 h-32 bg-gold-500/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <h3 className="font-display text-2xl font-bold text-white">{role.name}</h3>
            <div className="flex items-center gap-3 mt-2 text-sm">
              <span className="inline-flex items-center gap-1.5 text-white/80">
                <User className="w-3.5 h-3.5" />
                {formatGender(role.gender)}
              </span>
              <span className="inline-flex items-center gap-1.5 text-white/80">
                <Users className="w-3.5 h-3.5" />
                {role.ageMin}-{role.ageMax}岁
              </span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <span className="badge bg-theater-bg/60 text-white backdrop-blur-sm border border-white/20">
              {role.applicationCount} 人报名
            </span>
            {role.selectedActor && (
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gold-500/20 border border-gold-500/40">
                <img
                  src={role.selectedActor.avatar}
                  alt={role.selectedActor.name}
                  className="w-5 h-5 rounded-full border border-gold-400/50"
                />
                <span className="text-xs text-gold-300 font-medium">
                  {role.selectedActor.name}
                </span>
                <CheckCircle2 className="w-3.5 h-3.5 text-gold-400" />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div className="p-4 rounded-lg bg-theater-bg border-l-4 border-gold-500/60">
          <div className="flex items-center gap-2 text-xs text-gold-400 mb-2">
            <MessageSquareQuote className="w-3.5 h-3.5" />
            试读台词片段
          </div>
          <p className="text-sm text-theater-text leading-relaxed italic">
            "{role.dialogue || '暂无台词片段'}"
          </p>
        </div>

        {isActor && (
          <button
            onClick={() => onApply?.(role)}
            disabled={hasApplied || !!role.selectedActor}
            className={`w-full btn btn-shake ${
              hasApplied || role.selectedActor
                ? 'bg-theater-border/50 !text-theater-textMuted cursor-not-allowed'
                : 'btn-gold'
            }`}
          >
            {role.selectedActor ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                已选定演员
              </>
            ) : hasApplied ? (
              <>
                <CheckCircle2 className="w-4 h-4" />
                已报名
              </>
            ) : (
              '立即报名'
            )}
          </button>
        )}

        {isDirector && (
          <div className="space-y-3">
            <button
              onClick={() => onViewApplications?.(role)}
              className="w-full btn-primary text-sm"
            >
              <Eye className="w-4 h-4" />
              查看报名名单 ({applications.length})
            </button>

            {applications.length > 0 && (
              <div className="space-y-2 pt-3 border-t border-theater-border/50 max-h-60 overflow-y-auto">
                <p className="text-xs text-theater-textMuted font-medium">
                  报名演员资质卡：
                </p>
                {applications.map((app, idx) => (
                  <div
                    key={app.id}
                    className={`p-3 rounded-lg border transition-all ${
                      app.status === 'approved'
                        ? 'bg-green-500/10 border-green-500/40'
                        : app.status === 'rejected'
                        ? 'bg-red-500/10 border-red-500/30 opacity-60'
                        : 'bg-theater-bg border-theater-border hover:border-gold-500/30'
                    }`}
                    style={{ animationDelay: `${idx * 0.05}s` }}
                  >
                    <div className="flex items-start gap-3">
                      <img
                        src={app.actor?.avatar}
                        alt={app.actor?.name}
                        className="w-10 h-10 rounded-full border border-gold-500/30 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-theater-text text-sm">
                            {app.actor?.name}
                          </p>
                          {app.status === 'approved' && (
                            <span className="badge bg-green-500/20 text-green-400 border border-green-500/30">
                              已通过
                            </span>
                          )}
                          {app.status === 'rejected' && (
                            <span className="badge bg-red-500/20 text-red-400 border border-red-500/30">
                              已拒绝
                            </span>
                          )}
                          {app.status === 'pending' && (
                            <span className="badge bg-gold-500/10 text-gold-400 border border-gold-500/30">
                              <Clock className="w-3 h-3 mr-0.5 inline" />
                              待审核
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-theater-textMuted mt-1 line-clamp-2">
                          {app.introduction}
                        </p>

                        {app.status === 'pending' && (
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              onClick={() => onApprove?.(app.id)}
                              className="flex-1 py-1.5 text-xs rounded-md bg-green-600/80 text-white
                                hover:bg-green-500 transition-colors flex items-center justify-center gap-1"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              通过
                            </button>
                            <button
                              onClick={() => onReject?.(app.id)}
                              className="flex-1 py-1.5 text-xs rounded-md bg-red-600/80 text-white
                                hover:bg-red-500 transition-colors flex items-center justify-center gap-1"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              拒绝
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
