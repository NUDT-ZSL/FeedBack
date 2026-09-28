import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  User,
  CalendarDays,
  Edit,
  Trash2,
  Plus,
  AlertCircle,
} from 'lucide-react';
import { marked } from 'marked';
import type { Play, Role, Application } from '../types';
import { playApi, roleApi, applicationApi } from '../api';
import { useStore } from '../store/useStore';
import { formatDate } from '../utils/format';
import CountdownTimer from './ui/CountdownTimer';
import RoleCard from './ui/RoleCard';
import ApplicationModal from './ui/ApplicationModal';

export default function PlayDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = useStore((s) => s.user);
  const showToast = useStore((s) => s.showToast);

  const [play, setPlay] = useState<Play | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [applications, setApplications] = useState<Record<string, Application[]>>({});
  const [applyRole, setApplyRole] = useState<Role | null>(null);
  const [appliedRoles, setAppliedRoles] = useState<Set<string>>(new Set());

  const isDirector = user?.role === 'director' && user?.id === play?.directorId;
  const isActor = user?.role === 'actor';

  const loadPlay = async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const p = await playApi.get(id);
      setPlay(p);

      if (user?.role === 'actor') {
        try {
          const myApps = await applicationApi.myApplications();
          const roleSet = new Set(
            myApps.filter((a) => a.role?.playId === id).map((a) => a.roleId)
          );
          setAppliedRoles(roleSet);
        } catch (_err) {
          /* ignore */
        }
      }

      if (isDirector || user?.role === 'director') {
        const appsMap: Record<string, Application[]> = {};
        for (const role of p.roles) {
          try {
            const apps = await roleApi.applications(role.id);
            appsMap[role.id] = apps;
          } catch (_err) {
            appsMap[role.id] = [];
          }
        }
        setApplications(appsMap);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlay();
  }, [id, user?.id, user?.role]);

  const handleApply = async (role: Role) => {
    if (!user) {
      navigate('/login');
      return;
    }
    setApplyRole(role);
  };

  const handleSubmitApply = async (data: { introduction: string; experience: string }) => {
    if (!applyRole) return;
    try {
      await applicationApi.apply(applyRole.id, data);
      showToast('报名提交成功，等待导演审核', 'success');
      setAppliedRoles((prev) => new Set(prev).add(applyRole.id));
      setPlay((p) =>
        p
          ? {
              ...p,
              roles: p.roles.map((r) =>
                r.id === applyRole.id
                  ? { ...r, applicationCount: r.applicationCount + 1 }
                  : r
              ),
            }
          : p
      );
      loadPlay();
    } catch (err) {
      throw err;
    }
  };

  const handleApprove = async (appId: string) => {
    try {
      await applicationApi.updateStatus(appId, 'approved');
      showToast('已通过演员报名', 'success');
      loadPlay();
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  const handleReject = async (appId: string) => {
    try {
      await applicationApi.updateStatus(appId, 'rejected');
      showToast('已拒绝该演员报名', 'info');
      loadPlay();
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  const handleDelete = async () => {
    if (!play) return;
    if (!confirm('确定要删除这个剧本吗？此操作不可撤销。')) return;
    try {
      await playApi.delete(play.id);
      showToast('剧本已删除', 'success');
      navigate('/');
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="animate-spin w-12 h-12 border-4 border-gold-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !play) {
    return (
      <div className="card p-12 text-center">
        <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
        <h3 className="font-display text-2xl font-semibold mb-2">加载失败</h3>
        <p className="text-theater-textDim mb-6">{error || '剧本不存在'}</p>
        <button onClick={() => navigate('/')} className="btn-primary">
          <ArrowLeft className="w-4 h-4" />
          返回首页
        </button>
      </div>
    );
  }

  const synopsisHtml = marked.parse(play.synopsis || '') as string;

  return (
    <div className="space-y-8">
      <button
        onClick={() => navigate(-1)}
        className="btn-ghost text-sm self-start"
      >
        <ArrowLeft className="w-4 h-4" />
        返回
      </button>

      <section className="relative overflow-hidden card !p-0 fade-in-up">
        {play.coverUrl && (
          <div className="relative h-64 md:h-80 overflow-hidden">
            <img
              src={play.coverUrl}
              alt={play.title}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-wine-950 via-wine-950/60 to-transparent" />
          </div>
        )}
        <div className={`p-6 md:p-10 ${play.coverUrl ? '-mt-20 md:-mt-28 relative z-10' : ''}`}>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-4">
                <CountdownTimer deadline={play.deadline} size="md" />
                <span className="badge bg-wine-700/80 text-white text-xs px-3 py-1">
                  {play.roleCount || play.roles.length} 个角色
                </span>
              </div>

              <h1 className="font-display text-3xl md:text-5xl font-bold text-theater-text mb-3">
                {play.title}
              </h1>

              <div className="flex flex-wrap items-center gap-4 mb-6 text-sm text-theater-textDim">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-gold-500" />
                  <span>作者：{play.author}</span>
                </div>
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-gold-500" />
                  <span>发布于 {formatDate(play.createdAt)}</span>
                </div>
              </div>

              {play.director && (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-theater-bg/60 border border-theater-border/50 w-fit">
                  <img
                    src={play.director.avatar}
                    alt={play.director.name}
                    className="w-12 h-12 rounded-full border-2 border-gold-500/40"
                  />
                  <div>
                    <p className="text-xs text-theater-textMuted">导演</p>
                    <p className="font-semibold text-theater-text">{play.director.name}</p>
                  </div>
                </div>
              )}
            </div>

            {isDirector && (
              <div className="flex flex-col md:items-end gap-2 shrink-0">
                <button
                  onClick={() => navigate(`/play/edit/${play.id}`)}
                  className="btn-ghost text-sm"
                >
                  <Edit className="w-4 h-4" />
                  编辑剧本
                </button>
                <button onClick={handleDelete} className="btn-danger text-sm">
                  <Trash2 className="w-4 h-4" />
                  删除剧本
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6 md:p-8 fade-in-up" style={{ animationDelay: '0.1s' }}>
            <h2 className="font-display text-2xl font-bold mb-6 gold-gradient-text">
              剧情简介
            </h2>
            <div
              className="markdown-body prose prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: synopsisHtml }}
            />
          </div>

          <div className="fade-in-up" style={{ animationDelay: '0.15s' }}>
            <div className="flex items-end justify-between mb-6">
              <div>
                <h2 className="page-title text-2xl md:text-3xl">招募角色</h2>
                <p className="text-theater-textDim mt-2 text-sm">
                  共 {play.roles.length} 个角色，点击角色卡片查看详情并报名
                </p>
              </div>
              {isDirector && (
                <button
                  onClick={() => navigate(`/play/edit/${play.id}`)}
                  className="btn-gold text-sm"
                >
                  <Plus className="w-4 h-4" />
                  管理角色
                </button>
              )}
            </div>

            {play.roles.length === 0 ? (
              <div className="card p-12 text-center">
                <Plus className="w-12 h-12 text-theater-textMuted mx-auto mb-3 opacity-40" />
                <p className="text-theater-textDim">
                  {isDirector ? '暂未添加角色，点击上方按钮添加角色' : '本剧本暂未发布角色'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 stagger">
                {play.roles.map((role, idx) => (
                  <RoleCard
                    key={role.id}
                    role={role}
                    index={idx}
                    isDirector={isDirector}
                    isActor={isActor}
                    currentUserId={user?.id}
                    hasApplied={appliedRoles.has(role.id)}
                    applications={applications[role.id] || []}
                    onApply={handleApply}
                    onApprove={handleApprove}
                    onReject={handleReject}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6 fade-in-up" style={{ animationDelay: '0.2s' }}>
          <div className="card p-6 sticky top-6">
            <h3 className="font-display text-xl font-semibold mb-4 flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-gold-400" />
              招募信息
            </h3>
            <ul className="space-y-4 text-sm">
              <li className="flex justify-between items-center pb-3 border-b border-theater-border/50">
                <span className="text-theater-textDim">报名截止</span>
                <CountdownTimer deadline={play.deadline} />
              </li>
              <li className="flex justify-between items-center pb-3 border-b border-theater-border/50">
                <span className="text-theater-textDim">角色总数</span>
                <span className="font-semibold text-theater-text">{play.roles.length} 个</span>
              </li>
              <li className="flex justify-between items-center pb-3 border-b border-theater-border/50">
                <span className="text-theater-textDim">总报名数</span>
                <span className="font-semibold text-gold-400">
                  {play.roles.reduce((sum, r) => sum + r.applicationCount, 0)} 人
                </span>
              </li>
              <li className="flex justify-between items-center">
                <span className="text-theater-textDim">已选定演员</span>
                <span className="font-semibold text-green-400">
                  {play.roles.filter((r) => r.selectedActor).length} 位
                </span>
              </li>
            </ul>

            {isActor && (
              <div className="mt-6 pt-5 border-t border-theater-border/50">
                <p className="text-xs text-theater-textMuted mb-3 leading-relaxed">
                  💡 温馨提示：报名前请仔细阅读角色要求，自我介绍不超过500字。
                  导演审核结果会通过通知中心推送。
                </p>
                <button
                  disabled={!user}
                  onClick={() =>
                    document
                      .querySelectorAll('.card.card-hover.overflow-hidden')[0]
                      ?.scrollIntoView({ behavior: 'smooth' })
                  }
                  className="btn-primary w-full text-sm"
                >
                  {user ? '查看并报名角色' : '登录后报名'}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      <ApplicationModal
        open={!!applyRole}
        role={applyRole}
        onClose={() => setApplyRole(null)}
        onSubmit={handleSubmitApply}
      />
    </div>
  );
}
