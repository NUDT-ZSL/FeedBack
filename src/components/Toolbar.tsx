import type { BoardApi } from '../hooks/useBoardState.ts';
import { CONNECTION_COLORS, LABEL_MAX_LENGTH } from '../types.ts';

interface ToolbarProps {
  api: BoardApi;
}

export function Toolbar({ api }: ToolbarProps) {
  const { canvas, tool, selection } = api;
  const selectedConnection = canvas.connections.find((conn) => conn.id === selection.connectionId);

  return (
    <div className="toolbar">
      <span className="toolbar__brand">数字灵感板</span>
      <div className="toolbar__group">
        {(['select', 'boxSelect', 'connect'] as const).map((mode) => (
          <button
            key={mode}
            className={`toolbar__btn ${tool === mode ? 'toolbar__btn--active' : ''}`}
            onClick={() => {
              api.setTool(mode);
              api.setPendingConnectFrom(null);
            }}
          >
            {mode === 'select' ? '选择/平移' : mode === 'boxSelect' ? '框选' : '连线'}
          </button>
        ))}
        {tool === 'connect' && (
          <button
            className="toolbar__btn"
            title="切换连线类型"
            onClick={() => api.setConnectType(api.connectType === 'arrow' ? 'dashed' : 'arrow')}
          >
            {api.connectType === 'arrow' ? '→ 箭头' : '┄ 虚线'}
          </button>
        )}
      </div>
      <div className="toolbar__group">
        <button className="toolbar__btn" onClick={api.addCard}>
          ＋卡片
        </button>
        <button
          className="toolbar__btn"
          disabled={selection.cardIds.length === 0}
          title="把选中的卡片归入一个新卡组"
          onClick={api.createGroupFromSelection}
        >
          ＋卡组（{selection.cardIds.length}）
        </button>
        <button
          className="toolbar__btn"
          disabled={selection.cardIds.length === 0 && selection.groupIds.length === 0 && !selection.connectionId}
          onClick={api.deleteSelection}
        >
          删除
        </button>
      </div>
      {selectedConnection && (
        <div className="toolbar__group toolbar__group--connection">
          <input
            className="toolbar__label-input"
            value={selectedConnection.label}
            maxLength={LABEL_MAX_LENGTH}
            placeholder="连线标签"
            onChange={(event) => api.updateConnection(selectedConnection.id, { label: event.target.value })}
          />
          {CONNECTION_COLORS.map((color) => (
            <button
              key={color}
              className="toolbar__color-dot"
              style={{ backgroundColor: color }}
              onClick={() => api.updateConnection(selectedConnection.id, { color })}
            />
          ))}
          <button
            className="toolbar__btn"
            onClick={() =>
              api.updateConnection(selectedConnection.id, {
                type: selectedConnection.type === 'arrow' ? 'dashed' : 'arrow',
              })
            }
          >
            {selectedConnection.type === 'arrow' ? '→' : '┄'}
          </button>
        </div>
      )}
      <div className="toolbar__group toolbar__group--right">
        <span className="toolbar__zoom">{Math.round(canvas.scale * 100)}%</span>
        <button className="toolbar__btn toolbar__btn--verify" onClick={api.runVerify}>
          批量验证
        </button>
        <span className="toolbar__save">
          {api.lastSavedAt ? `已保存 ${new Date(api.lastSavedAt).toLocaleTimeString()}` : '未保存'}
        </span>
      </div>
    </div>
  );
}
