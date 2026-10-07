import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { AttachmentPoint, BellNote, JointName } from '../types.ts';
import { browserPlaybackDriver, TheaterStore } from '../theater/store.ts';
import {
  ATTACHMENT_POINTS,
  PUPPET_HEIGHT,
  PUPPET_WIDTH,
  STAGE_HEIGHT,
  STAGE_WIDTH,
} from '../theater/model.ts';
import type { SceneValidationReport } from '../theater/validation.ts';
import { audioManager } from '../utils/audio.ts';
import { PROP_LABELS, PuppetSlot, PuppetView, PUPPET_LABELS } from '../puppet.tsx';
import { Bells } from '../bells.tsx';

type DragState =
  | { kind: 'puppet'; id: string; x: number; y: number }
  | { kind: 'prop'; id: string; x: number; y: number };

const JOINT_TARGET_ANGLE: Record<JointName, number> = {
  leftArm: -90,
  rightArm: 90,
  leftLeg: -30,
  rightLeg: 30,
};

const ATTACH_PRIORITY: AttachmentPoint[] = ['rightHand', 'leftHand', 'back'];

function makeStore(): TheaterStore {
  return new TheaterStore(
    browserPlaybackDriver((note) => {
      void audioManager.playBell(note);
    }),
  );
}

export default function Home() {
  const storeRef = useRef<TheaterStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = makeStore();
  }
  const store = storeRef.current;

  const snapshot = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
  );
  const activeScene = snapshot.scenes.find((scene) => scene.id === snapshot.activeSceneId)!;

  const stageRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [report, setReport] = useState<SceneValidationReport | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const recordStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => setDrag((cur) => (cur ? { ...cur, x: event.clientX, y: event.clientY } : cur));
    const up = (event: PointerEvent) => {
      handleDrop(event);
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id]);

  useEffect(() => {
    return () => {
      if (recordStopTimer.current) clearTimeout(recordStopTimer.current);
    };
  }, []);

  const showFlash = (message: string) => {
    setFlash(message);
    setTimeout(() => setFlash((cur) => (cur === message ? null : cur)), 2200);
  };

  const stagePoint = (clientX: number, clientY: number) => {
    const rect = stageRef.current!.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top, inside: clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom };
  };

  const startPuppetDrag = (event: ReactPointerEvent, puppetId: string) => {
    event.preventDefault();
    setDrag({ kind: 'puppet', id: puppetId, x: event.clientX, y: event.clientY });
  };

  const startPropDrag = (event: ReactPointerEvent, propId: string) => {
    event.preventDefault();
    setDrag({ kind: 'prop', id: propId, x: event.clientX, y: event.clientY });
  };

  const handleDrop = (event: PointerEvent) => {
    if (!drag) return;
    if (drag.kind === 'puppet') {
      const point = stagePoint(event.clientX, event.clientY);
      if (!point.inside) return;
      const x = Math.min(Math.max(point.x - PUPPET_WIDTH / 2, 0), STAGE_WIDTH - PUPPET_WIDTH);
      const y = Math.min(Math.max(point.y - PUPPET_HEIGHT / 2, 0), STAGE_HEIGHT - PUPPET_HEIGHT);
      store.movePuppet(drag.id, x, y);
      store.setPuppetOnStage(drag.id, true);
      return;
    }
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const target = activeScene.puppets.find((puppet) => {
      if (!puppet.isOnStage) return false;
      return (
        event.clientX >= rect.left + puppet.position.x &&
        event.clientX <= rect.left + puppet.position.x + PUPPET_WIDTH &&
        event.clientY >= rect.top + puppet.position.y &&
        event.clientY <= rect.top + puppet.position.y + PUPPET_HEIGHT
      );
    });
    if (!target) return;
    const occupied = new Set(target.props.map((prop) => prop.attachmentPoint));
    const point = ATTACH_PRIORITY.find((candidate) => !occupied.has(candidate));
    if (!point) {
      showFlash(`${PUPPET_LABELS[target.name]} 的挂载点已满`);
      return;
    }
    try {
      store.attachProp(drag.id, target.id, point);
      audioManager.playPropSound(drag.id.replace('prop-', ''));
    } catch (error) {
      showFlash((error as Error).message);
    }
  };

  const toggleJoint = (puppetId: string, joint: JointName) => {
    const puppet = activeScene.puppets.find((item) => item.id === puppetId)!;
    const angle = puppet.joints[joint].angle === 0 ? JOINT_TARGET_ANGLE[joint] : 0;
    store.setJoint(puppetId, joint, angle);
  };

  const strikeBell = (note: BellNote) => {
    audioManager.playBell(note);
    if (snapshot.isRecording) store.recordEvent(note);
  };

  const toggleRecording = () => {
    if (snapshot.isRecording) {
      store.stopRecording();
      if (recordStopTimer.current) clearTimeout(recordStopTimer.current);
      return;
    }
    store.startRecording();
    void audioManager.init();
    recordStopTimer.current = setTimeout(() => store.stopRecording(), activeScene.duration);
  };

  const switchTo = (sceneId: string) => {
    store.switchScene(sceneId);
    setReport(null);
  };

  const addScene = () => {
    const id = store.createScene();
    store.switchScene(id);
    setReport(null);
  };

  const duplicateActive = () => {
    const id = store.duplicateScene(snapshot.activeSceneId);
    store.switchScene(id);
    setReport(null);
  };

  const deleteActive = () => {
    try {
      store.deleteScene(snapshot.activeSceneId);
      setReport(null);
    } catch (error) {
      showFlash((error as Error).message);
    }
  };

  const runValidation = () => {
    const result = store.validateActiveScene();
    setReport(result);
    if (result.issues.length === 0) showFlash(`「${result.sceneName}」校验通过`);
  };

  return (
    <div className="app-container">
      <h1 className="title">皮影戏 · 多场次编排台</h1>

      <div className="scene-bar">
        <span className="scene-bar-label">场次</span>
        {snapshot.scenes.map((scene) => (
          <button
            key={scene.id}
            className={`scene-tab${scene.id === snapshot.activeSceneId ? ' active' : ''}`}
            onClick={() => switchTo(scene.id)}
          >
            {scene.name}
            <span className="scene-tab-meta">
              {scene.recording.length}音/{scene.duration / 1000}s
            </span>
          </button>
        ))}
        <button className="scene-action" onClick={addScene}>＋ 新增</button>
        <button className="scene-action" onClick={duplicateActive}>⧉ 复制</button>
        <button className="scene-action danger" onClick={deleteActive}>🗑 删除</button>
      </div>

      <div className="main-layout">
        <div className="sidebar">
          <div className="sidebar-title">影人</div>
          {activeScene.puppets.map((puppet) => (
            <PuppetSlot key={puppet.id} puppet={puppet} onPointerDown={startPuppetDrag} />
          ))}
        </div>

        <div>
          <div className="stage-container" ref={stageRef}>
            <div className="stage-curtain">
              <div className="curtain-tassels">
                {Array.from({ length: 14 }).map((_, index) => (
                  <div key={index} className="tassel" />
                ))}
              </div>
            </div>
            <div className="lantern lantern-left"><div className="lantern-body" /></div>
            <div className="lantern lantern-right"><div className="lantern-body" /></div>
            <div className="performance-area" />
            {activeScene.puppets
              .filter((puppet) => puppet.isOnStage)
              .map((puppet) => (
                <PuppetView
                  key={puppet.id}
                  puppet={puppet}
                  dragging={drag?.kind === 'puppet' && drag.id === puppet.id}
                  onPointerDown={startPuppetDrag}
                  onJointClick={toggleJoint}
                />
              ))}
            <div className="scene-nameplate">{activeScene.name}</div>
            {snapshot.isPlaying && (
              <div className="playback-banner">正在回放 · {activeScene.name}</div>
            )}
          </div>

          <div className="bells-container">
            <Bells recording={snapshot.isRecording} onStrike={strikeBell} />
            <div className="control-buttons">
              <button
                className={`control-btn${snapshot.isRecording ? ' recording' : ''}`}
                onClick={toggleRecording}
              >
                {snapshot.isRecording ? '■ 停止录制' : '● 开始录制'}
              </button>
              <button
                className="control-btn"
                disabled={activeScene.recording.length === 0 || snapshot.isPlaying}
                onClick={() => store.playScene()}
              >
                ▶ 回放本场
              </button>
              <button className="control-btn" onClick={() => store.clearRecording()}>
                ✕ 清空录音
              </button>
              <button className="control-btn" onClick={runValidation}>
                ✓ 校验本场
              </button>
            </div>
            <div className="recording-time">
              本场录音 {activeScene.recording.length} 个事件 · 时长上限 {activeScene.duration / 1000}s
              {snapshot.isRecording ? ' · 录制中…' : ''}
              {snapshot.isPlaying ? ' · 回放中…' : ''}
            </div>
          </div>
        </div>

        <div className="sidebar">
          <div className="sidebar-title">道具</div>
          {activeScene.props.map((prop) => {
            const holder = prop.attachedTo
              ? activeScene.puppets.find((puppet) => puppet.id === prop.attachedTo)
              : undefined;
            return (
              <div
                key={prop.id}
                className={`prop-slot${prop.attachedTo ? ' disabled' : ''}`}
                onPointerDown={(event) => {
                  if (!prop.attachedTo) startPropDrag(event, prop.id);
                }}
              >
                <span className="slot-label">{PROP_LABELS[prop.name]}</span>
                {holder && (
                  <span className="prop-holder">
                    {PUPPET_LABELS[holder.name]}·
                    {prop.attachmentPoint === 'leftHand' ? '左手' : prop.attachmentPoint === 'rightHand' ? '右手' : '背'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {report && (
        <div className="validation-panel">
          <div className="validation-header">
            校验结果 · {report.sceneName}
            <button className="validation-close" onClick={() => setReport(null)}>×</button>
          </div>
          {report.issues.length === 0 ? (
            <div className="validation-ok">全部通过，无冲突</div>
          ) : (
            <ul className="validation-list">
              {report.issues.map((issue, index) => (
                <li key={`${issue.kind}-${index}`} className="validation-item">
                  <span className={`validation-kind kind-${issue.kind}`}>{issue.message}</span>
                  <ul>
                    {issue.refs.map((ref, refIndex) => (
                      <li key={refIndex} className="validation-ref">
                        {ref.objectType}/{ref.objectId} — {ref.detail}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {flash && <div className="flash-message">{flash}</div>}

      {drag && (
        <div
          className="drag-ghost"
          style={{ left: drag.x, top: drag.y }}
        >
          {drag.kind === 'puppet'
            ? PUPPET_LABELS[activeScene.puppets.find((p) => p.id === drag.id)!.name]
            : PROP_LABELS[activeScene.props.find((p) => p.id === drag.id)!.name]}
        </div>
      )}
    </div>
  );
}
