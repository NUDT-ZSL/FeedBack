import type { PointerEvent as ReactPointerEvent } from 'react';
import type { JointName, Puppet } from './types.ts';

export const PUPPET_LABELS: Record<Puppet['name'], string> = {
  scholar: '书生',
  general: '武将',
  heroine: '花旦',
  clown: '小丑',
};

export const PROP_LABELS: Record<string, string> = {
  moneyBag: '钱袋',
  sword: '长剑',
  fan: '团扇',
  wineCup: '酒杯',
  letter: '书信',
  drum: '锣鼓',
};

const JOINT_SEGMENTS: Array<{
  joint: JointName;
  x1: number;
  y1: number;
  length: number;
  width: number;
}> = [
  { joint: 'leftArm', x1: 22, y1: 42, length: 34, width: 7 },
  { joint: 'rightArm', x1: 58, y1: 42, length: 34, width: 7 },
  { joint: 'leftLeg', x1: 32, y1: 92, length: 26, width: 8 },
  { joint: 'rightLeg', x1: 48, y1: 92, length: 26, width: 8 },
];

interface PuppetViewProps {
  puppet: Puppet;
  onPointerDown?: (event: ReactPointerEvent, puppetId: string) => void;
  onJointClick?: (puppetId: string, joint: JointName) => void;
  dragging?: boolean;
}

export function PuppetView({ puppet, onPointerDown, onJointClick, dragging }: PuppetViewProps) {
  const classNames = ['puppet'];
  if (puppet.isOnStage) classNames.push('on-stage');
  if (dragging) classNames.push('dragging');
  if (puppet.danceAction !== 'idle') classNames.push(`dancing-${puppet.danceAction}`);

  return (
    <div
      className={classNames.join(' ')}
      style={{ left: puppet.position.x, top: puppet.position.y }}
      data-puppet-id={puppet.id}
      onPointerDown={(event) => onPointerDown?.(event, puppet.id)}
    >
      <svg className="puppet-svg" viewBox="0 0 80 120">
        <g
          style={{
            transform: `rotate(${puppet.joints.head.rotation}deg)`,
            transformOrigin: '40px 22px',
          }}
        >
          <circle cx={40} cy={18} r={12} fill={puppet.color} />
        </g>
        <ellipse cx={40} cy={62} rx={18} ry={32} fill={puppet.color} />
        {JOINT_SEGMENTS.map(({ joint, x1, y1, length, width }) => (
          <rect
            key={joint}
            className="joint"
            data-joint={joint}
            x={x1 - width / 2}
            y={y1}
            width={width}
            height={length}
            rx={width / 2}
            fill={puppet.color}
            style={{
              transform: `rotate(${puppet.joints[joint].angle}deg)`,
              transformOrigin: `${x1}px ${y1}px`,
            }}
            onClick={(event) => {
              event.stopPropagation();
              onJointClick?.(puppet.id, joint);
            }}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ))}
      </svg>
      {puppet.props.map((prop) => (
        <div
          key={prop.id}
          className="attached-prop"
          data-point={prop.attachmentPoint ?? undefined}
        >
          {PROP_LABELS[prop.name] ?? prop.name}
        </div>
      ))}
    </div>
  );
}

export function PuppetSlot({
  puppet,
  onPointerDown,
}: {
  puppet: Puppet;
  onPointerDown?: (event: ReactPointerEvent, puppetId: string) => void;
}) {
  return (
    <div
      className="puppet-slot"
      data-puppet-id={puppet.id}
      onPointerDown={(event) => onPointerDown?.(event, puppet.id)}
    >
      <svg width={52} height={78} viewBox="0 0 80 120">
        <circle cx={40} cy={18} r={12} fill={puppet.color} />
        <ellipse cx={40} cy={62} rx={18} ry={32} fill={puppet.color} />
      </svg>
      <span className="slot-label">{PUPPET_LABELS[puppet.name]}</span>
    </div>
  );
}
