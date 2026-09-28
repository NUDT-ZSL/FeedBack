import { useState, useEffect, useCallback, useRef } from 'react';
import { Target, Clock, BookOpen, ChevronRight, CheckCircle, Circle, PlayCircle, Loader2 } from 'lucide-react';
import { useSkillStore } from './store/useSkillStore';
import type { PathStage, StageStatus, SkillResource } from './types';

const JOB_OPTIONS = [
  { id: 'fullstack', label: '全栈工程师' },
  { id: 'devops', label: 'DevOps专家' },
  { id: 'frontend-architect', label: '前端架构师' },
  { id: 'backend', label: '后端工程师' },
];

const STATUS_CONFIG: Record<StageStatus, { label: string; icon: typeof Circle; color: string; bgColor: string }> = {
  'not-started': { label: '未学习', icon: Circle, color: '#6b7280', bgColor: 'rgba(107,114,128,0.15)' },
  'in-progress': { label: '学习中', icon: PlayCircle, color: '#3b82f6', bgColor: 'rgba(59,130,246,0.15)' },
  'completed': { label: '已完成', icon: CheckCircle, color: '#22c55e', bgColor: 'rgba(34,197,94,0.15)' },
};

const STATUS_ORDER: StageStatus[] = ['not-started', 'in-progress', 'completed'];

function ResourceLink({ resource, onClick }: { resource: SkillResource; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        color: '#e94560',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: 13,
        padding: 0,
      }}
    >
      <BookOpen style={{ width: 14, height: 14 }} />
      <span>{resource.title}</span>
      <ChevronRight style={{ width: 12, height: 12 }} />
    </button>
  );
}

function TimelineStageCard({
  stage,
  isFirst,
  isLast,
}: {
  stage: PathStage;
  isFirst: boolean;
  isLast: boolean;
}) {
  const updateStageStatus = useSkillStore((s) => s.updateStageStatus);
  const setSelectedResourceId = useSkillStore((s) => s.setSelectedResourceId);
  const [statusOpacity, setStatusOpacity] = useState(1);
  const isTransitioning = useRef(false);

  const config = STATUS_CONFIG[stage.status];
  const StatusIcon = config.icon;

  const cycleStatus = useCallback(() => {
    if (isTransitioning.current) return;
    isTransitioning.current = true;
    setStatusOpacity(0);

    requestAnimationFrame(() => {
      const currentIndex = STATUS_ORDER.indexOf(stage.status);
      const nextStatus = STATUS_ORDER[(currentIndex + 1) % STATUS_ORDER.length];
      updateStageStatus(stage.id, nextStatus);

      requestAnimationFrame(() => {
        setStatusOpacity(1);
        isTransitioning.current = false;
      });
    });
  }, [stage.id, stage.status, updateStageStatus]);

  return (
    <div style={{ position: 'relative', display: 'flex', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: `2px solid ${stage.status === 'completed' ? '#22c55e' : stage.status === 'in-progress' ? '#3b82f6' : '#6b7280'}`,
            background: stage.status === 'not-started' ? 'transparent' : undefined,
            backgroundColor: stage.status === 'not-started' ? undefined : (stage.status === 'completed' ? '#22c55e' : '#3b82f6'),
            marginTop: isFirst ? 6 : 0,
          }}
        />
        {!isLast && (
          <div
            style={{
              width: 2,
              flex: 1,
              marginTop: 4,
              background: stage.status === 'completed' ? 'rgba(34,197,94,0.4)' : 'rgba(107,114,128,0.3)',
            }}
          />
        )}
      </div>

      <div
        style={{
          flex: 1,
          marginBottom: 24,
          padding: 20,
          background: '#16213e',
          borderRadius: 12,
          border: '1px solid rgba(233,69,96,0.15)',
          marginTop: isFirst ? 0 : undefined,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#fff' }}>
              {stage.skillName}
            </h3>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'rgba(255,255,255,0.6)', fontSize: 13 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Clock style={{ width: 14, height: 14 }} />
                <span>{stage.estimatedDuration}小时</span>
              </div>
            </div>

            {stage.resources.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                {stage.resources.slice(0, 3).map((res) => (
                  <ResourceLink
                    key={res.id}
                    resource={res}
                    onClick={() => setSelectedResourceId(res.id)}
                  />
                ))}
              </div>
            )}
          </div>

          <div
            style={{
              transition: 'opacity 200ms ease-in-out',
              opacity: statusOpacity,
            }}
          >
            <button
              onClick={cycleStatus}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                color: config.color,
                backgroundColor: config.bgColor,
                whiteSpace: 'nowrap',
              }}
            >
              <StatusIcon style={{ width: 16, height: 16 }} />
              <span>{config.label}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PathPlanner() {
  const learningPath = useSkillStore((s) => s.learningPath);
  const targetJobId = useSkillStore((s) => s.targetJobId);
  const isPathGenerating = useSkillStore((s) => s.isPathGenerating);
  const totalEstimatedHours = useSkillStore((s) => s.totalEstimatedHours);
  const jobTitle = useSkillStore((s) => s.jobTitle);
  const generateLearningPath = useSkillStore((s) => s.generateLearningPath);
  const setTargetJob = useSkillStore((s) => s.setTargetJob);
  const skills = useSkillStore((s) => s.skills);

  const [selectedJobId, setSelectedJobId] = useState<string>(targetJobId ?? '');

  useEffect(() => {
    if (targetJobId) {
      setSelectedJobId(targetJobId);
    }
  }, [targetJobId]);

  const handleJobSelect = useCallback(
    (jobId: string) => {
      setSelectedJobId(jobId);
      setTargetJob(jobId);
      if (jobId) {
        void generateLearningPath(jobId);
      }
    },
    [setTargetJob, generateLearningPath]
  );

  const handleGenerate = useCallback(() => {
    if (selectedJobId) {
      void generateLearningPath(selectedJobId);
    }
  }, [selectedJobId, generateLearningPath]);

  useEffect(() => {
    if (targetJobId && skills.length > 0 && learningPath.length === 0 && !isPathGenerating) {
      void generateLearningPath(targetJobId);
    }
  }, [skills, targetJobId, learningPath.length, isPathGenerating, generateLearningPath]);

  const completedCount = learningPath.filter((s) => s.status === 'completed').length;
  const progressPercent = learningPath.length > 0 ? Math.round((completedCount / learningPath.length) * 100) : 0;

  return (
    <div style={{ padding: 24, color: '#fff', maxWidth: 800, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
        <Target style={{ width: 24, height: 24, color: '#e94560' }} />
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>职业路径规划</h2>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <select
          value={selectedJobId}
          onChange={(e) => handleJobSelect(e.target.value)}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid rgba(233,69,96,0.3)',
            background: '#16213e',
            color: '#fff',
            fontSize: 14,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          <option value="" disabled>
            选择目标职位...
          </option>
          {JOB_OPTIONS.map((job) => (
            <option key={job.id} value={job.id} style={{ background: '#16213e', color: '#fff' }}>
              {job.label}
            </option>
          ))}
        </select>

        <button
          onClick={handleGenerate}
          disabled={!selectedJobId || isPathGenerating}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 20px',
            borderRadius: 8,
            border: 'none',
            background: selectedJobId && !isPathGenerating ? '#e94560' : 'rgba(233,69,96,0.4)',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: selectedJobId && !isPathGenerating ? 'pointer' : 'not-allowed',
            whiteSpace: 'nowrap',
          }}
        >
          {isPathGenerating ? (
            <>
              <Loader2 style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
              <span>生成中...</span>
            </>
          ) : (
            <>
              <Target style={{ width: 16, height: 16 }} />
              <span>生成路径</span>
            </>
          )}
        </button>
      </div>

      {isPathGenerating && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 60,
            gap: 16,
          }}
        >
          <Loader2 style={{ width: 40, height: 40, color: '#e94560', animation: 'spin 1s linear infinite' }} />
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 14 }}>正在生成学习路径...</span>
        </div>
      )}

      {!isPathGenerating && learningPath.length > 0 && (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 16,
              padding: 16,
              background: '#16213e',
              borderRadius: 10,
              border: '1px solid rgba(233,69,96,0.15)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>
                目标职位：{jobTitle || JOB_OPTIONS.find((j) => j.id === targetJobId)?.label}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff', fontSize: 15, fontWeight: 600 }}>
                <Clock style={{ width: 16, height: 16, color: '#e94560' }} />
                <span>总预估学习时长：{totalEstimatedHours}小时</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)' }}>完成进度</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: '#22c55e' }}>{progressPercent}%</span>
            </div>
          </div>

          {learningPath.length > 0 && (
            <div style={{ marginBottom: 16, height: 4, borderRadius: 2, background: 'rgba(107,114,128,0.3)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  borderRadius: 2,
                  background: 'linear-gradient(to right, #3b82f6, #22c55e)',
                  width: `${progressPercent}%`,
                  transition: 'width 300ms ease-in-out',
                }}
              />
            </div>
          )}

          <div>
            {learningPath.map((stage, index) => (
              <TimelineStageCard
                key={stage.id}
                stage={stage}
                isFirst={index === 0}
                isLast={index === learningPath.length - 1}
              />
            ))}
          </div>
        </>
      )}

      {!isPathGenerating && learningPath.length === 0 && selectedJobId && (
        <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
          请点击"生成路径"开始规划
        </div>
      )}

      {!isPathGenerating && !selectedJobId && (
        <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>
          请先选择目标职位
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
