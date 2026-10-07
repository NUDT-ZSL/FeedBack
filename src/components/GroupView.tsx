import type { Card, CardGroup } from '../types.ts';
import { GROUP_HEADER_HEIGHT, GROUP_NAME_MAX_LENGTH } from '../types.ts';
import { collapsedGroupRect, expandedGroupRect } from '../utils/geometry.ts';
import { readGroupDropPayload } from './Card.tsx';

interface GroupViewProps {
  group: CardGroup;
  cardsById: Map<string, Card>;
  selected: boolean;
  /** 折叠时该组内部被隐藏的连线数量（可观察结果） */
  hiddenConnectionCount: number;
  onToggleCollapse: (groupId: string) => void;
  onDelete: (groupId: string) => void;
  onRename: (groupId: string, name: string) => void;
  onChipPointerDown: (e: React.PointerEvent, groupId: string) => void;
  onDropCard: (groupId: string, cardId: string) => void;
  onRemoveMember: (groupId: string, cardId: string) => void;
  onReorderMember: (groupId: string, fromIndex: number, toIndex: number) => void;
}

export default function GroupView({
  group,
  cardsById,
  selected,
  hiddenConnectionCount,
  onToggleCollapse,
  onDelete,
  onRename,
  onChipPointerDown,
  onDropCard,
  onRemoveMember,
  onReorderMember,
}: GroupViewProps) {
  const members = group.memberIds
    .map((id) => cardsById.get(id))
    .filter((c): c is Card => c !== undefined);

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const cardId = readGroupDropPayload(e);
      if (cardId) onDropCard(group.id, cardId);
    },
  };

  if (group.collapsed) {
    const rect = collapsedGroupRect(group);
    return (
      <div
        className={`group-chip ${selected ? 'group-chip--selected' : ''}`}
        style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderColor: group.color }}
        onPointerDown={(e) => onChipPointerDown(e, group.id)}
        {...dropProps}
      >
        <div className="group-chip__head">
          <span className="group-chip__dot" style={{ backgroundColor: group.color }} />
          <input
            className="group-chip__name"
            value={group.name}
            maxLength={GROUP_NAME_MAX_LENGTH}
            onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => onRename(group.id, e.target.value)}
          />
          <button
            type="button"
            className="icon-btn"
            title="展开卡组：成员卡片恢复原位置与大小"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(group.id);
            }}
          >
            ▣
          </button>
          <button
            type="button"
            className="icon-btn"
            title="删除卡组（成员卡片与连线保留）"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(group.id);
            }}
          >
            ✕
          </button>
        </div>
        <div className="group-chip__summary">
          {members.length === 0 && <span className="group-chip__empty">空卡组</span>}
          {members.slice(0, 3).map((m, i) => (
            <span key={m.id} className="group-chip__member">
              <span className="group-chip__member-title">{m.title || '未命名卡片'}</span>
              <button
                type="button"
                className="icon-btn icon-btn--tiny"
                title="上移成员"
                disabled={i === 0}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onReorderMember(group.id, i, i - 1);
                }}
              >
                ↑
              </button>
              <button
                type="button"
                className="icon-btn icon-btn--tiny"
                title="移出卡组"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveMember(group.id, m.id);
                }}
              >
                ⏏
              </button>
            </span>
          ))}
          {members.length > 3 && <span className="group-chip__more">…共 {members.length} 张</span>}
        </div>
        <div className="group-chip__meta">
          {hiddenConnectionCount > 0 && <span>⊘ {hiddenConnectionCount} 条组内连线已隐藏</span>}
          <span className="group-chip__hint">拖拽卡片到此处可入组</span>
        </div>
      </div>
    );
  }

  const rect = expandedGroupRect(group, cardsById);
  return (
    <div
      className={`group-frame ${selected ? 'group-frame--selected' : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderColor: group.color }}
    >
      <div
        className="group-frame__header"
        style={{ height: GROUP_HEADER_HEIGHT, backgroundColor: `${group.color}33` }}
        onPointerDown={(e) => onChipPointerDown(e, group.id)}
        {...dropProps}
      >
        <span className="group-chip__dot" style={{ backgroundColor: group.color }} />
        <input
          className="group-chip__name"
          value={group.name}
          maxLength={GROUP_NAME_MAX_LENGTH}
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onRename(group.id, e.target.value)}
        />
        <span className="group-frame__count">{members.length} 张</span>
        <button
          type="button"
          className="icon-btn"
          title="折叠卡组：隐藏成员卡片，跨组连线吸附到容器边界"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(group.id);
          }}
        >
          ▤
        </button>
        <button
          type="button"
          className="icon-btn"
          title="删除卡组（成员卡片与连线保留）"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(group.id);
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
