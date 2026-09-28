import { HistoryCard } from '../types';

interface HistoryGalleryProps {
  history: HistoryCard[];
  onRestore: (item: HistoryCard) => void;
  onDelete: (id: string) => void;
}

export default function HistoryGallery({ history, onRestore, onDelete }: HistoryGalleryProps) {
  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  if (history.length === 0) {
    return (
      <div className="empty-state">
        <div className="icon">📭</div>
        <p>还没有保存的贺卡，快去制作一张吧！</p>
      </div>
    );
  }

  return (
    <div className="history-grid">
      {history.map(item => (
        <div
          key={item.id}
          className="history-item"
          onClick={() => onRestore(item)}
        >
          <div className="history-thumb">
            {item.thumbnail ? (
              <img src={item.thumbnail} alt="贺卡预览" />
            ) : (
              <div style={{
                width: '100%', height: '100%',
                display: 'flex', alignItems: 'center',
                justifyContent: 'center', fontSize: '48px',
                background: item.backgroundColor,
              }}>
                🎂
              </div>
            )}
          </div>
          <div className="history-info">
            <div className="date">{formatDate(item.savedAt)}</div>
            <div className="actions">
              <button
                className="btn btn-small"
                onClick={(e) => { e.stopPropagation(); onRestore(item); }}
              >
                ✏️ 继续编辑
              </button>
              <button
                className="btn btn-danger btn-small"
                onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
              >
                🗑️
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
