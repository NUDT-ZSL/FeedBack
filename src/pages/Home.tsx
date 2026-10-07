import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ShowStore } from '../state/showStore';
import { validateShow } from '../state/validation';
import { audioManager } from '../utils/audio';
import { PuppetView } from '../puppet';
import { BellsPanel } from '../bells';
import {
  MAX_RECORDING_MS,
  PROP_SPECS,
  PUPPET_HEIGHT,
  PUPPET_SPECS,
  PUPPET_WIDTH,
  PROP_HEIGHT,
  PROP_WIDTH,
} from '../state/constants';
import type { JointName, Particle, Prop, Puppet, ValidationIssue } from '../types';

interface DragState {
  kind: 'puppet' | 'prop';
  id: string;
  fromStage: boolean;
  startClientX: number;
  startClientY: number;
  moved: boolean;
  x: number;
  y: number;
}

let particleSeq = 0;

export default function Home() {
  const storeRef = useRef<ShowStore | null>(null);
  if (storeRef.current === null) storeRef.current = new ShowStore();
  const store = storeRef.current;

  const [, forceRender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => store.subscribe(forceRender), [store]);

  const show = store.activeShow;
  const stageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const [recordElapsed, setRecordElapsed] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const recordTimerRef = useRef<number | null>(null);

  // 切换场次后清空校验面板与回放指示，舞台与侧栏完全由新场次状态驱动
  const activeId = show.id;
  useEffect(() => {
    setIssues(null);
    setIsPlaying(false);
    setDrag(null);
  }, [activeId]);

  // 录制计时与 30 秒自动停止
  useEffect(() => {
    if (!store.isRecording) {
      setRecordElapsed(0);
      if (recordTimerRef.current !== null) {
        window.clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      return;
    }
    recordTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - store.activeShow.recording.startTime;
      setRecordElapsed(elapsed);
      if (elapsed >= MAX_RECORDING_MS) store.stopRecording();
    }, 100);
    return () => {
      if (recordTimerRef.current !== null) window.clearInterval(recordTimerRef.current);
    };
  }, [store, store.isRecording]);

  const stagePoint = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: -9999, y: -9999 };
    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const spawnParticles = useCallback((x: number, y: number) => {
    const burst: Particle[] = Array.from({ length: 12 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 2;
      return {
        id: `p${++particleSeq}`,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 3 + Math.random() * 2,
        opacity: 1,
        color: '#ffd700',
      };
    });
    setParticles((ps) => [...ps, ...burst]);
    window.setTimeout(
      () => setParticles((ps) => ps.filter((p) => !burst.some((b) => b.id === p.id))),
      550,
    );
  }, []);

  // ---------- 拖拽 ----------

  const beginDrag = (
    e: ReactPointerEvent,
    kind: 'puppet' | 'prop',
    id: string,
    fromStage: boolean,
  ) => {
    e.preventDefault();
    void audioManager.init();
    setDrag({
      kind,
      id,
      fromStage,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
      x: e.clientX,
      y: e.clientY,
    });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      setDrag((d) =>
        d
          ? {
              ...d,
              x: e.clientX,
              y: e.clientY,
              moved:
                d.moved ||
                Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY) > 5,
            }
          : d,
      );
    };
    const onUp = (e: PointerEvent) => {
      const d = drag;
      setDrag(null);
      if (!d) return;
      const pt = stagePoint(e.clientX, e.clientY);
      const insideStage =
        pt.x >= 0 && pt.y >= 0 && pt.x <= 1000 && pt.y <= 600;

      if (d.kind === 'puppet') {
        if (!d.moved && d.fromStage) {
          store.toggleJoint(d.id, e.shiftKey ? 'leftLeg' : 'rightArm');
          store.toggleJoint(d.id, e.shiftKey ? 'rightLeg' : 'leftArm');
          return;
        }
        if (insideStage) {
          store.movePuppet(
            d.id,
            Math.max(0, Math.min(1000 - PUPPET_WIDTH, pt.x - PUPPET_WIDTH / 2)),
            Math.max(0, Math.min(600 - PUPPET_HEIGHT, pt.y - PUPPET_HEIGHT / 2)),
            true,
          );
        } else if (d.fromStage) {
          const idx = show.puppets.findIndex((p) => p.id === d.id);
          store.movePuppet(d.id, 0, Math.max(0, idx) * 130, false);
        }
        return;
      }

      // 道具：落到台上某个影人身上则吸附
      if (insideStage) {
        const target = show.puppets.find(
          (p) =>
            p.isOnStage &&
            pt.x >= p.position.x &&
            pt.x <= p.position.x + PUPPET_WIDTH &&
            pt.y >= p.position.y &&
            pt.y <= p.position.y + PUPPET_HEIGHT,
        );
        if (target) {
          const prop = show.props.find((p) => p.id === d.id);
          const spec = PROP_SPECS.find((s) => s.name === prop?.name);
          const result = store.attachProp(d.id, target.id, spec?.defaultPoint ?? 'back');
          if (result.ok) {
            audioManager.playPropSound(prop?.name ?? '');
            spawnParticles(pt.x, pt.y);
          }
        }
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, show, stagePoint, store, spawnParticles]);

  // ---------- 编钟 ----------

  const handleBellClick = (note: Parameters<typeof audioManager.playBell>[0]) => {
    audioManager.playBell(note);
    if (store.isRecording) store.recordNote(note);
  };

  const handlePlay = () => {
    store.playActiveShow({
      playNote: (note) => audioManager.playBell(note),
      onDance: (action) => {
        store.setDanceActionForOnStage(action);
        window.setTimeout(() => store.setDanceActionForOnStage('idle'), 800);
      },
      onFinish: () => setIsPlaying(false),
    });
    setIsPlaying(true);
  };

  // ---------- 渲染 ----------

  const trayPuppets = show.puppets.filter((p) => !p.isOnStage);
  const stagePuppets = show.puppets.filter((p) => p.isOnStage);
  const trayProps = show.props.filter((p) => p.attachedTo === null);
  const summaries = store.listShows();

  return (
    <div className="app-container">
      <h1 className="title">皮影戏模拟器 · {show.name}</h1>
      <p className="instruction">
        拖拽影人上台，点击影人抬臂（Shift+点击抬腿）；拖拽道具到影人身上吸附；点击编钟配乐
      </p>
      <div className="main-layout">
        <aside className="sidebar">
          <div className="sidebar-title">道具库</div>
          {trayProps.map((prop: Prop) => {
            const spec = PROP_SPECS.find((s) => s.name === prop.name);
            return (
              <div
                key={prop.id}
                className="prop-slot"
                onPointerDown={(e) => beginDrag(e, 'prop', prop.id, false)}
              >
                <div className="prop-chip">{spec?.label ?? prop.name}</div>
              </div>
            );
          })}
          {trayProps.length === 0 && (
            <div className="sidebar-hint">全部道具已挂载</div>
          )}
          <div className="sidebar-title" style={{ marginTop: 12 }}>
            已挂载
          </div>
          {show.props
            .filter((p) => p.attachedTo !== null)
            .map((p) => {
              const owner = show.puppets.find((x) => x.id === p.attachedTo);
              const ownerSpec = PUPPET_SPECS.find((s) => s.name === owner?.name);
              const spec = PROP_SPECS.find((s) => s.name === p.name);
              return (
                <div
                  key={p.id}
                  className="ledger-row"
                  title="点击摘除"
                  onClick={() => store.detachProp(p.id)}
                >
                  {spec?.label} → {ownerSpec?.label ?? p.attachedTo}（{p.attachmentPoint}）
                </div>
              );
            })}
        </aside>

        <div className="stage-container" ref={stageRef}>
          <div className="stage-curtain">
            <div className="curtain-tassels">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="tassel" />
              ))}
            </div>
          </div>
          <div className="lantern lantern-left">
            <div className="lantern-body" />
          </div>
          <div className="lantern lantern-right">
            <div className="lantern-body" />
          </div>
          <div className="performance-area" />
          {stagePuppets.map((puppet: Puppet) => (
            <PuppetView
              key={puppet.id}
              puppet={puppet}
              style={{ left: puppet.position.x, top: puppet.position.y }}
              dragging={drag?.kind === 'puppet' && drag.id === puppet.id}
              onPointerDown={(e) => beginDrag(e, 'puppet', puppet.id, true)}
            />
          ))}
          {particles.map((p) => (
            <span
              key={p.id}
              className="particle"
              style={{
                left: p.x,
                top: p.y,
                width: p.size,
                height: p.size,
                background: p.color,
                transform: `translate(${p.vx * 30}px, ${p.vy * 30}px)`,
                opacity: 0,
                transition: 'all 0.5s ease-out',
              }}
            />
          ))}
        </div>

        <aside className="sidebar">
          <div className="sidebar-title">影人</div>
          {trayPuppets.map((puppet) => (
            <div
              key={puppet.id}
              className="puppet-slot"
              onPointerDown={(e) => beginDrag(e, 'puppet', puppet.id, false)}
            >
              <PuppetView
                puppet={puppet}
                style={{ position: 'relative', transform: 'scale(0.85)' }}
              />
            </div>
          ))}
          {trayPuppets.length === 0 && <div className="sidebar-hint">全部影人已登台</div>}
        </aside>

        <aside className="sidebar show-sidebar">
          <div className="sidebar-title">场次</div>
          {summaries.map((s) => (
            <div
              key={s.id}
              className={`show-item ${s.id === activeId ? 'active' : ''}`}
              onClick={() => store.switchShow(s.id)}
              onDoubleClick={() => {
                const name = window.prompt('场次名称', s.name);
                if (name) store.renameShow(s.id, name);
              }}
            >
              <div className="show-name">{s.name}</div>
              <div className="show-meta">
                登台 {s.onStageCount}/{s.puppetCount} · 道具 {s.attachedPropCount} · 音符{' '}
                {s.eventCount} · {(s.duration / 1000).toFixed(1)}s
              </div>
            </div>
          ))}
          <button className="control-btn small" onClick={() => store.createShow()}>
            ＋ 新建场次
          </button>
          <button
            className="control-btn small"
            onClick={() => store.duplicateShow(activeId)}
          >
            ⧉ 复制本场
          </button>
          <button
            className="control-btn small"
            onClick={() => {
              if (window.confirm(`删除「${show.name}」？其道具归属与录音将被清理`)) {
                store.deleteShow(activeId);
              }
            }}
          >
            ✕ 删除本场
          </button>
          <button
            className="control-btn small validate"
            onClick={() => setIssues(validateShow(show))}
          >
            ✓ 校验本场
          </button>
          {issues !== null && (
            <div className="validation-panel">
              {issues.length === 0 ? (
                <div className="validation-ok">「{show.name}」校验通过</div>
              ) : (
                issues.map((issue, i) => (
                  <div key={i} className={`validation-issue ${issue.severity}`}>
                    <div className="issue-message">
                      [{issue.severity === 'error' ? '错误' : '警告'}] {issue.message}
                    </div>
                    {issue.evidence.map((ev, j) => (
                      <div key={j} className="issue-evidence">
                        · {ev.detail}
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}
        </aside>
      </div>

      <BellsPanel
        isRecording={store.isRecording}
        isPlaying={isPlaying}
        eventCount={show.recording.events.length}
        durationMs={show.duration}
        elapsedMs={recordElapsed}
        onBellClick={handleBellClick}
        onToggleRecord={() =>
          store.isRecording ? store.stopRecording() : store.startRecording()
        }
        onPlay={handlePlay}
        onStopPlay={() => {
          store.playback.interrupt();
          setIsPlaying(false);
        }}
      />

      {drag && (
        <div
          className="drag-ghost"
          style={{ left: drag.x, top: drag.y }}
        >
          {drag.kind === 'puppet'
            ? PUPPET_SPECS.find(
                (s) => s.name === show.puppets.find((p) => p.id === drag.id)?.name,
              )?.label ?? '影人'
            : PROP_SPECS.find(
                (s) => s.name === show.props.find((p) => p.id === drag.id)?.name,
              )?.label ?? '道具'}
        </div>
      )}
    </div>
  );
}
