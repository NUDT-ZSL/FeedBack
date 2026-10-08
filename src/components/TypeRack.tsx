import type { TypeCharacter } from '../types/index.ts';

export const RACK_DRAG_TYPE = 'application/x-movable-type';

interface TypeRackProps {
  rack: TypeCharacter[];
}

export default function TypeRack({ rack }: TypeRackProps) {
  return (
    <aside className="type-rack" aria-label="字库架">
      <h2 className="panel-title">字库</h2>
      <div className="type-rack-grid">
        {rack.map((item) => (
          <div
            key={item.id}
            className="type-block"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(
                RACK_DRAG_TYPE,
                JSON.stringify({ source: 'rack', id: item.id })
              );
              event.dataTransfer.effectAllowed = 'move';
            }}
          >
            {item.char}
          </div>
        ))}
      </div>
    </aside>
  );
}
