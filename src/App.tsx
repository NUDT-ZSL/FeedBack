import { useEffect } from 'react';
import { Board } from './components/Board.tsx';
import { GroupsPanel } from './components/GroupsPanel.tsx';
import { Toolbar } from './components/Toolbar.tsx';
import { VerifyPanel } from './components/VerifyPanel.tsx';
import { useBoardState } from './hooks/useBoardState.ts';

export default function App() {
  const api = useBoardState();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        api.deleteSelection();
      } else if (event.key === 'Escape') {
        api.setSelection({ cardIds: [], groupIds: [], connectionId: null });
        api.setPendingConnectFrom(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [api]);

  return (
    <div className="app">
      <Toolbar api={api} />
      <div className="app__body">
        <Board api={api} />
        <GroupsPanel api={api} />
      </div>
      <div className="toasts">
        {api.toasts.map((toast) => (
          <div key={toast.key} className={`toast toast--${toast.kind}`}>
            {toast.message}
          </div>
        ))}
      </div>
      {api.verifyReport && (
        <VerifyPanel report={api.verifyReport} onClose={() => api.setVerifyReport(null)} />
      )}
    </div>
  );
}
