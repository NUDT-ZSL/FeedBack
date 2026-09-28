import React, { useRef, useEffect, useState, useCallback } from 'react';
import rough from 'roughjs/bundled/rough.esm';
import type { FlowNode } from './utils';

interface NodeProps {
  node: FlowNode;
  isSelected: boolean;
  isConnecting: boolean;
  onMouseDown: (e: React.MouseEvent, node: FlowNode) => void;
  onDoubleClick: (nodeId: string) => void;
  onConnectionStart?: (nodeId: string) => void;
  editingNodeId: string | null;
  onTextChange: (nodeId: string, text: string) => void;
  onTextConfirm: () => void;
}

const roughConfig = {
  stroke: '#8B5E3C',
  strokeWidth: 2,
  roughness: 1.5,
  bowing: 2,
};

const Node: React.FC<NodeProps> = ({
  node,
  isSelected,
  isConnecting,
  onMouseDown,
  onDoubleClick,
  onConnectionStart,
  editingNodeId,
  onTextChange,
  onTextConfirm,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [editText, setEditText] = useState(node.text);
  const isEditing = editingNodeId === node.id;

  const drawNode = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const rc = rough.svg(svg);
    const oldNodes = svg.querySelectorAll('.rough-node');
    oldNodes.forEach((n) => n.remove());

    let shape;
    const { x, y, width, height, type } = node;

    switch (type) {
      case 'start':
        shape = rc.rectangle(4, 4, width, height, {
          ...roughConfig,
          fill: '#FFFEF7',
          fillStyle: 'solid',
          rx: height / 2,
          ry: height / 2,
        });
        break;
      case 'process':
        shape = rc.rectangle(4, 4, width, height, {
          ...roughConfig,
          fill: '#FFFEF7',
          fillStyle: 'solid',
        });
        break;
      case 'decision': {
        const cx = width / 2 + 4;
        const cy = height / 2 + 4;
        const halfW = width / 2;
        const halfH = height / 2;
        const points = [
          [cx, cy - halfH],
          [cx + halfW, cy],
          [cx, cy + halfH],
          [cx - halfW, cy],
        ];
        shape = rc.polygon(points, {
          ...roughConfig,
          fill: '#FFFEF7',
          fillStyle: 'solid',
        });
        break;
      }
      case 'subprocess': {
        const shadow1 = rc.rectangle(8, 8, width, height, {
          stroke: '#D3C5B5',
          strokeWidth: 2,
          roughness: 1.5,
          bowing: 2,
          fill: '#E8DFD4',
          fillStyle: 'solid',
        });
        shadow1.classList.add('rough-node');
        svg.appendChild(shadow1);

        shape = rc.rectangle(4, 4, width, height, {
          ...roughConfig,
          fill: '#FFFEF7',
          fillStyle: 'solid',
        });
        break;
      }
      default:
        shape = rc.rectangle(4, 4, width, height, roughConfig);
    }

    shape.classList.add('rough-node');
    svg.insertBefore(shape, svg.firstChild);
  }, [node]);

  useEffect(() => {
    drawNode();
  }, [drawNode]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditText(node.text);
  }, [node.text]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isEditing) return;
    e.stopPropagation();

    if (isConnecting && onConnectionStart) {
      onConnectionStart(node.id);
    } else {
      onMouseDown(e, node);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDoubleClick(node.id);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onTextConfirm();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditText(e.target.value);
    onTextChange(node.id, e.target.value);
  };

  const handleInputBlur = () => {
    onTextConfirm();
  };

  return (
    <div
      className={`flow-node ${isSelected ? 'selected' : ''} ${isConnecting ? 'connecting-mode' : ''}`}
      style={{
        position: 'absolute',
        left: node.x,
        top: node.y,
        width: node.width + 8,
        height: node.height + 8,
        cursor: isConnecting ? 'crosshair' : 'move',
        userSelect: 'none',
      }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
    >
      <svg
        ref={svgRef}
        width={node.width + 12}
        height={node.height + 12}
        style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
      />
      <div
        className="node-text"
        style={{
          position: 'absolute',
          left: 4,
          top: 4,
          width: node.width,
          height: node.height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          padding: '0 8px',
          boxSizing: 'border-box',
        }}
      >
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editText}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onBlur={handleInputBlur}
            style={{
              width: '90%',
              textAlign: 'center',
              border: '2px solid #8B5E3C',
              borderRadius: '4px',
              padding: '4px',
              fontSize: '14px',
              outline: 'none',
              background: '#FFF8F0',
              pointerEvents: 'auto',
            }}
          />
        ) : (
          <span
            style={{
              color: '#5C4033',
              fontSize: '14px',
              fontWeight: 500,
              textAlign: 'center',
              wordBreak: 'break-word',
              lineHeight: 1.3,
            }}
          >
            {node.text || '节点'}
          </span>
        )}
      </div>
    </div>
  );
};

export default React.memo(Node);
