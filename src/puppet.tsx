import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { JointName, Puppet } from './types';
import { PROP_SPECS } from './state/constants';

interface PuppetViewProps {
  puppet: Puppet;
  style?: CSSProperties;
  dragging?: boolean;
  onPointerDown?: (e: ReactPointerEvent) => void;
  onToggleJoint?: (puppetId: string, joint: JointName, shiftKey: boolean) => void;
}

const ATTACH_BADGE_POS: Record<string, CSSProperties> = {
  leftHand: { left: -14, top: 34 },
  rightHand: { right: -14, top: 34 },
  back: { left: '50%', top: -12, transform: 'translateX(-50%)' },
};

/** 单个皮影剪影：单色剪影 + 关节动画 + 挂载道具徽标 */
export function PuppetView({ puppet, style, dragging, onPointerDown }: PuppetViewProps) {
  const { joints } = puppet;
  const danceClass =
    puppet.danceAction !== 'idle' ? `dancing-${puppet.danceAction}` : '';

  return (
    <div
      className={`puppet ${puppet.isOnStage ? 'on-stage' : ''} ${dragging ? 'dragging' : ''} ${danceClass}`}
      style={style}
      onPointerDown={onPointerDown}
      data-puppet-id={puppet.id}
    >
      <svg className="puppet-svg" viewBox="0 0 80 120">
        <g
          style={{
            transform: `rotate(${joints.head.rotation}deg)`,
            transformOrigin: '40px 30px',
            transition: 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
          }}
        >
          <circle cx="40" cy="18" r="12" fill={puppet.color} />
        </g>
        <rect x="28" y="30" width="24" height="50" rx="8" fill={puppet.color} />
        <rect
          x="22"
          y="32"
          width="7"
          height="38"
          rx="3"
          fill={puppet.color}
          style={{
            transform: `rotate(${joints.leftArm.angle}deg)`,
            transformOrigin: '26px 34px',
            transition: 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
          }}
        />
        <rect
          x="51"
          y="32"
          width="7"
          height="38"
          rx="3"
          fill={puppet.color}
          style={{
            transform: `rotate(${-joints.rightArm.angle}deg)`,
            transformOrigin: '54px 34px',
            transition: 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
          }}
        />
        <rect
          x="30"
          y="78"
          width="8"
          height="40"
          rx="3"
          fill={puppet.color}
          style={{
            transform: `rotate(${joints.leftLeg.angle}deg)`,
            transformOrigin: '34px 80px',
            transition: 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
          }}
        />
        <rect
          x="42"
          y="78"
          width="8"
          height="40"
          rx="3"
          fill={puppet.color}
          style={{
            transform: `rotate(${-joints.rightLeg.angle}deg)`,
            transformOrigin: '46px 80px',
            transition: 'transform 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
          }}
        />
      </svg>
      {puppet.props.map((prop) => {
        const spec = PROP_SPECS.find((s) => s.name === prop.name);
        return (
          <span
            key={prop.id}
            className="attach-badge"
            style={ATTACH_BADGE_POS[prop.attachmentPoint ?? 'back']}
            title={`${spec?.label ?? prop.name}（${prop.attachmentPoint}）`}
          >
            {spec?.label ?? prop.name}
          </span>
        );
      })}
    </div>
  );
}
