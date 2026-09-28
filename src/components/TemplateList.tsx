import { Template, TEMPLATES } from '../types';

interface TemplateListProps {
  onSelect: (template: Template) => void;
  currentId?: string;
  compact?: boolean;
}

export default function TemplateList({ onSelect, currentId, compact = false }: TemplateListProps) {
  const thumbnails = [
    { id: 'cute', name: '可爱风', bg: '#FFE4EC', emoji: '🎈' },
    { id: 'simple', name: '简约风', bg: '#FFFFFF', emoji: '✨' },
    { id: 'vintage', name: '复古风', bg: '#F5E6D3', emoji: '📜' },
    { id: 'elegant', name: '优雅风', bg: 'linear-gradient(135deg, #667eea, #764ba2)', emoji: '💜' },
    { id: 'playful', name: '活泼风', bg: 'linear-gradient(135deg, #FFD93D, #FF6B6B)', emoji: '🎉' },
    { id: 'romantic', name: '浪漫风', bg: 'linear-gradient(135deg, #FFE4EC, #B5FFFC)', emoji: '💕' },
  ];

  const handleClick = (id: string) => {
    const full = TEMPLATES.find(tt => tt.id === id);
    if (full) onSelect(full);
  };

  if (!compact) {
    return (
      <div className="template-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', marginBottom: '0' }}>
        {thumbnails.map(t => (
          <div
            key={t.id}
            className={`template-thumb ${currentId === t.id ? 'selected' : ''}`}
            style={{
              border: currentId === t.id ? '3px solid #764ba2' : '2px solid #E0E0E0',
            }}
            onClick={() => handleClick(t.id)}
          >
            <div
              className="template-preview"
              style={{
                height: '100px',
                background: t.bg,
                fontSize: '32px',
              }}
            >
              {t.emoji}
            </div>
            <div className="template-name" style={{ marginTop: '8px' }}>{t.name}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="template-grid">
      {thumbnails.map(t => (
        <div
          key={t.id}
          className={`template-thumb ${currentId === t.id ? 'selected' : ''}`}
          style={{
            border: currentId === t.id ? '2px solid #764ba2' : '2px solid #E0E0E0',
          }}
          onClick={() => handleClick(t.id)}
        >
          <div
            className="template-preview"
            style={{ background: t.bg }}
          >
            {t.emoji}
          </div>
          <div className="template-name">{t.name}</div>
        </div>
      ))}
    </div>
  );
}
