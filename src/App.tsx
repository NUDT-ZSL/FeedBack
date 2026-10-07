import { useState } from 'react';
import { useCanvasState } from './hooks/useCanvasState.ts';
import { useConnections } from './hooks/useConnections.ts';
import Board from './components/Board.tsx';
import Toolbar from './components/Toolbar.tsx';
import OutlinePanel from './components/OutlinePanel.tsx';

export default function App() {
  const api = useCanvasState();
  const connections = useConnections(api);
  const [outlineOpen, setOutlineOpen] = useState(false);

  const newCardAtCenter = () => {
    const cx = (window.innerWidth / 2 - api.state.offsetX) / api.state.scale;
    const cy = (window.innerHeight / 2 - api.state.offsetY) / api.state.scale;
    api.addCard(cx, cy);
  };

  const createGroup = () => {
    api.createGroupFromCards(api.selectedCardIds, `卡组 ${api.state.groups.length + 1}`);
  };

  return (
    <div className="app">
      <Toolbar
        mode={api.mode}
        scale={api.state.scale}
        selectedCardCount={api.selectedCardIds.length}
        outlineOpen={outlineOpen}
        onModeChange={api.setMode}
        onNewCard={newCardAtCenter}
        onCreateGroup={createGroup}
        onToggleOutline={() => setOutlineOpen((v) => !v)}
        onZoom={(factor) => api.zoomBy(factor)}
      />
      <Board api={api} />
      <OutlinePanel
        open={outlineOpen}
        ordered={connections.outline.ordered}
        cyclic={connections.outline.cyclic}
        onReorder={api.setOutlineOrder}
        onClose={() => setOutlineOpen(false)}
      />
      <div className="toasts">
        {api.warnings.map((w) => (
          <div key={w.id} className="toast" role="alert">
            <div className="toast__text">⚠ {w.text}</div>
            {w.detail && <div className="toast__detail">{w.detail}</div>}
            <button type="button" className="icon-btn toast__close" onClick={() => api.dismissWarning(w.id)}>✕</button>
          </div>
        ))}
      </div>
    </div>
  );
}
