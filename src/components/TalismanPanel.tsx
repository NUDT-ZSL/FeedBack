import { useCallback } from 'react';
import { trigrams } from '../lib/starData';

interface TalismanPanelProps {
  onDragStart: (talismanName: string) => void;
  onDragEnd: () => void;
  draggedTalisman: string | null;
}

export default function TalismanPanel({ onDragStart, onDragEnd, draggedTalisman }: TalismanPanelProps) {
  const handleDragStart = useCallback((e: React.DragEvent, talismanName: string) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', talismanName);
    
    const dragImage = e.currentTarget.cloneNode(true) as HTMLElement;
    dragImage.style.position = 'absolute';
    dragImage.style.top = '-1000px';
    dragImage.style.opacity = '0.8';
    dragImage.style.transform = 'scale(1.2)';
    dragImage.style.boxShadow = '5px 5px 8px rgba(0, 0, 0, 0.5)';
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 30, 30);
    
    setTimeout(() => {
      document.body.removeChild(dragImage);
    }, 0);
    
    onDragStart(talismanName);
  }, [onDragStart]);

  return (
    <div className="talisman-panel">
      <div className="panel-title">符咒库</div>
      <div className="talisman-grid">
        {trigrams.map((trigram) => (
          <div
            key={trigram.name}
            className={`talisman-item ${draggedTalisman === trigram.name ? 'dragging' : ''}`}
            draggable
            onDragStart={(e) => handleDragStart(e, trigram.name)}
            onDragEnd={onDragEnd}
            title={trigram.name}
          >
            <span style={{ color: '#ffffff', fontSize: '32px', textShadow: '0 0 10px rgba(255,255,255,0.5)' }}>
              {trigram.symbol}
            </span>
            <span className="talisman-name">{trigram.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
