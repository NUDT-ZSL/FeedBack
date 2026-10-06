import type { BoardApi } from '../hooks/useBoardState.ts';

interface GroupsPanelProps {
  api: BoardApi;
}

export function GroupsPanel({ api }: GroupsPanelProps) {
  const { canvas, selection } = api;

  return (
    <div className="groups-panel">
      <div className="groups-panel__title">卡组（{canvas.groups.length}）</div>
      {canvas.groups.length === 0 && (
        <div className="groups-panel__empty">框选卡片后点击「＋卡组」创建第一个卡组</div>
      )}
      {canvas.groups.map((group) => (
        <div
          key={group.id}
          className={`group-item ${selection.groupIds.includes(group.id) ? 'group-item--selected' : ''}`}
        >
          <div className="group-item__head">
            <span className="group-item__dot" style={{ backgroundColor: group.color }} />
            <input
              className="group-item__name"
              value={group.name}
              onChange={(event) => api.groupActions.rename(group.id, event.target.value)}
            />
            <button
              className="group-item__btn"
              title={group.collapsed ? '展开' : '折叠'}
              onClick={() => api.groupActions.setCollapsed(group.id, !group.collapsed)}
            >
              {group.collapsed ? '▸' : '▾'}
            </button>
            <button
              className="group-item__btn"
              title="删除卡组（成员与连线保留）"
              onClick={() => api.groupActions.remove(group.id)}
            >
              ✕
            </button>
          </div>
          <div className="group-item__members">
            {group.memberIds.map((cardId, index) => {
              const card = canvas.cards.find((item) => item.id === cardId);
              if (!card) return null;
              return (
                <div key={cardId} className="group-item__member">
                  <span className="group-item__order">{index + 1}</span>
                  <span className="group-item__member-name">{card.title || '未命名'}</span>
                  <button
                    className="group-item__btn"
                    disabled={index === 0}
                    title="上移"
                    onClick={() => api.groupActions.reorder(group.id, index, index - 1)}
                  >
                    ↑
                  </button>
                  <button
                    className="group-item__btn"
                    disabled={index === group.memberIds.length - 1}
                    title="下移"
                    onClick={() => api.groupActions.reorder(group.id, index, index + 1)}
                  >
                    ↓
                  </button>
                  <button
                    className="group-item__btn"
                    title="移出卡组"
                    onClick={() => api.groupActions.removeCard(group.id, cardId)}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
          <button
            className="group-item__add"
            disabled={selection.cardIds.length === 0}
            title="把当前选中的卡片加入该卡组；已属于其他卡组的卡片会提示冲突"
            onClick={() => {
              for (const cardId of selection.cardIds) api.groupActions.addCard(group.id, cardId);
            }}
          >
            加入选中卡片（{selection.cardIds.length}）
          </button>
        </div>
      ))}
    </div>
  );
}
