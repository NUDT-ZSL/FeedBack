import type { Card, CardGroup } from '../types.ts';
import { groupDisplayRect } from '../engine/groups.ts';

interface GroupViewProps {
  group: CardGroup;
  memberCards: Card[];
  selected: boolean;
  onToggleCollapse: (groupId: string, collapsed: boolean) => void;
  onDelete: (groupId: string) => void;
  onRename: (groupId: string, name: string) => void;
  onPointerDown: (event: React.PointerEvent, groupId: string) => void;
}

export function GroupView({
  group,
  memberCards,
  selected,
  onToggleCollapse,
  onDelete,
  onRename,
  onPointerDown,
}: GroupViewProps) {
  const rect = groupDisplayRect(group);

  if (group.collapsed) {
    const preview = memberCards
      .slice(0, 3)
      .map((card) => card.title || '未命名')
      .join('、');
    return (
      <div
        className={`group group--collapsed ${selected ? 'group--selected' : ''}`}
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderColor: group.color }}
        onPointerDown={(event) => onPointerDown(event, group.id)}
        onDoubleClick={() => onToggleCollapse(group.id, false)}
        title="双击展开卡组"
      >
        <span className="group__dot" style={{ backgroundColor: group.color }} />
        <div className="group__summary">
          <div className="group__name">{group.name}</div>
          <div className="group__meta">
            {group.memberIds.length} 张卡片{preview ? ` · ${preview}` : ''}
          </div>
        </div>
        <button
          className="group__btn"
          title="展开"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onToggleCollapse(group.id, false)}
        >
          ▸
        </button>
      </div>
    );
  }

  return (
    <div
      className={`group group--expanded ${selected ? 'group--selected' : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderColor: group.color }}
    >
      <div
        className="group__header"
        style={{ backgroundColor: group.color }}
        onPointerDown={(event) => onPointerDown(event, group.id)}
      >
        <input
          className="group__name-input"
          value={group.name}
          onChange={(event) => onRename(group.id, event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
        />
        <span className="group__count">{group.memberIds.length}</span>
        <button
          className="group__btn"
          title="折叠"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onToggleCollapse(group.id, true)}
        >
          ▾
        </button>
        <button
          className="group__btn"
          title="删除卡组（成员与连线保留）"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onDelete(group.id)}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
