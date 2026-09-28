import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import rough from 'roughjs/bundled/rough.esm';
import Node from './Node';
import Toolbar from './Toolbar';
import {
  type FlowNode,
  type Connection,
  type HistoryManager,
  type NodeType,
  NODE_SIZES,
  NODE_LABELS,
  generateId,
  createInitialHistory,
  pushHistory,
  undoHistory,
  redoHistory,
  getConnectionPoints,
  getBezierPath,
  getConnectionAngle,
  findNodeAtPosition,
  cloneState,
} from './utils';

const Editor: React.FC = () => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const roughSvgRef = useRef<SVGSVGElement>(null);
  const [history, setHistory] = useState<HistoryManager>(createInitialHistory());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isConnectMode, setIsConnectMode] = useState(false);
  const [connectFromNodeId, setConnectFromNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [tempEditText, setTempEditText] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [animatingConnections, setAnimatingConnections] = useState<Set<string>>(new Set());

  const { nodes, connections } = history.present;

  const pushNewState = useCallback(
    (newNodes: FlowNode[], newConnections: Connection[]) => {
      setHistory((prev) =>
        pushHistory(prev, { nodes: newNodes, connections: newConnections })
      );
    },
    []
  );

  const handleUndo = useCallback(() => {
    setHistory((prev) => undoHistory(prev));
    setSelectedNodeId(null);
    setIsConnectMode(false);
    setConnectFromNodeId(null);
  }, []);

  const handleRedo = useCallback(() => {
    setHistory((prev) => redoHistory(prev));
    setSelectedNodeId(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === 'y' || (e.key === 'z' && e.shiftKey))
      ) {
        e.preventDefault();
        handleRedo();
      }
      if (e.key === 'Escape') {
        setIsConnectMode(false);
        setConnectFromNodeId(null);
        setSelectedNodeId(null);
        setEditingNodeId(null);
      }
      if (e.key === 'Delete' && selectedNodeId && !editingNodeId) {
        const newNodes = nodes.filter((n) => n.id !== selectedNodeId);
        const newConnections = connections.filter(
          (c) => c.fromNodeId !== selectedNodeId && c.toNodeId !== selectedNodeId
        );
        pushNewState(newNodes, newConnections);
        setSelectedNodeId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, selectedNodeId, editingNodeId, nodes, connections, pushNewState]);

  const addNode = useCallback(
    (type: NodeType, x: number, y: number) => {
      const size = NODE_SIZES[type];
      const newNode: FlowNode = {
        id: generateId(),
        type,
        x: x - size.width / 2,
        y: y - size.height / 2,
        width: size.width,
        height: size.height,
        text: NODE_LABELS[type],
      };
      const newNodes = [...nodes, newNode];
      pushNewState(newNodes, connections);
      setSelectedNodeId(newNode.id);
    },
    [nodes, connections, pushNewState]
  );

  const handleNodeMouseDown = useCallback(
    (e: React.MouseEvent, node: FlowNode) => {
      if (isConnectMode) return;

      e.stopPropagation();
      setSelectedNodeId(node.id);
      setIsDragging(true);
      setDraggingNodeId(node.id);

      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (canvasRect) {
        setDragOffset({
          x: e.clientX - canvasRect.left - node.x,
          y: e.clientY - canvasRect.top - node.y,
        });
      }
    },
    [isConnectMode]
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;

      const x = e.clientX - canvasRect.left;
      const y = e.clientY - canvasRect.top;
      setMousePos({ x, y });

      if (isDragging && draggingNodeId) {
        const newX = x - dragOffset.x;
        const newY = y - dragOffset.y;

        setHistory((prev) => {
          const newNodes = prev.present.nodes.map((n) =>
            n.id === draggingNodeId ? { ...n, x: newX, y: newY } : n
          );
          return {
            ...prev,
            present: { ...prev.present, nodes: newNodes },
          };
        });
      }
    },
    [isDragging, draggingNodeId, dragOffset]
  );

  const handleCanvasMouseUp = useCallback(() => {
    if (isDragging && draggingNodeId) {
      pushNewState(
        history.present.nodes,
        history.present.connections
      );
    }
    setIsDragging(false);
    setDraggingNodeId(null);
  }, [isDragging, draggingNodeId, history.present, pushNewState]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent) => {
      if (isConnectMode && connectFromNodeId) {
        const canvasRect = canvasRef.current?.getBoundingClientRect();
        if (!canvasRect) return;

        const x = e.clientX - canvasRect.left;
        const y = e.clientY - canvasRect.top;
        const targetNode = findNodeAtPosition(x, y, nodes);

        if (targetNode && targetNode.id !== connectFromNodeId) {
          const exists = connections.some(
            (c) =>
              c.fromNodeId === connectFromNodeId && c.toNodeId === targetNode.id
          );

          if (!exists) {
            const newConnection: Connection = {
              id: generateId(),
              fromNodeId: connectFromNodeId,
              toNodeId: targetNode.id,
            };
            const newConnections = [...connections, newConnection];
            pushNewState(nodes, newConnections);

            setAnimatingConnections((prev) => new Set(prev).add(newConnection.id));
            setTimeout(() => {
              setAnimatingConnections((prev) => {
                const next = new Set(prev);
                next.delete(newConnection.id);
                return next;
              });
            }, 300);
          }
        }
        setConnectFromNodeId(null);
      } else {
        setSelectedNodeId(null);
      }
    },
    [isConnectMode, connectFromNodeId, nodes, connections, pushNewState]
  );

  const handleConnectionStart = useCallback(
    (nodeId: string) => {
      if (isConnectMode) {
        if (connectFromNodeId === null) {
          setConnectFromNodeId(nodeId);
        } else if (connectFromNodeId !== nodeId) {
          const exists = connections.some(
            (c) => c.fromNodeId === connectFromNodeId && c.toNodeId === nodeId
          );

          if (!exists) {
            const newConnection: Connection = {
              id: generateId(),
              fromNodeId: connectFromNodeId,
              toNodeId: nodeId,
            };
            const newConnections = [...connections, newConnection];
            pushNewState(nodes, newConnections);

            setAnimatingConnections((prev) => new Set(prev).add(newConnection.id));
            setTimeout(() => {
              setAnimatingConnections((prev) => {
                const next = new Set(prev);
                next.delete(newConnection.id);
                return next;
              });
            }, 300);
          }
          setConnectFromNodeId(null);
        }
      }
    },
    [isConnectMode, connectFromNodeId, nodes, connections, pushNewState]
  );

  const handleToggleConnectMode = useCallback(() => {
    setIsConnectMode((prev) => !prev);
    setConnectFromNodeId(null);
  }, []);

  const handleDoubleClick = useCallback((nodeId: string) => {
    setEditingNodeId(nodeId);
  }, []);

  const handleTextChange = useCallback((nodeId: string, text: string) => {
    setTempEditText(text);
    setHistory((prev) => ({
      ...prev,
      present: {
        ...prev.present,
        nodes: prev.present.nodes.map((n) =>
          n.id === nodeId ? { ...n, text } : n
        ),
      },
    }));
  }, []);

  const handleTextConfirm = useCallback(() => {
    if (editingNodeId) {
      pushNewState(
        history.present.nodes.map((n) =>
          n.id === editingNodeId ? { ...n, text: tempEditText } : n
        ),
        history.present.connections
      );
    }
    setEditingNodeId(null);
    setTempEditText('');
  }, [editingNodeId, tempEditText, history.present, pushNewState]);

  const handleDragStart = useCallback(
    (e: React.DragEvent, nodeType: NodeType) => {
      e.dataTransfer.setData('nodeType', nodeType);
      e.dataTransfer.effectAllowed = 'copy';
    },
    []
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const nodeType = e.dataTransfer.getData('nodeType') as NodeType;
      if (!nodeType || !canvasRef.current) return;

      const canvasRect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - canvasRect.left;
      const y = e.clientY - canvasRect.top;

      addNode(nodeType, x, y);
    },
    [addNode]
  );

  const handleExport = useCallback(() => {
    const exportCanvas = document.createElement('canvas');
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return;

    exportCanvas.width = 1920;
    exportCanvas.height = 1080;

    ctx.fillStyle = '#FFF8F0';
    ctx.fillRect(0, 0, 1920, 1080);

    ctx.strokeStyle = 'rgba(211, 197, 181, 0.15)';
    ctx.lineWidth = 1;
    for (let x = 0; x < 1920; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 1080);
      ctx.stroke();
    }
    for (let y = 0; y < 1080; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(1920, y);
      ctx.stroke();
    }

    const rc = rough.canvas(exportCanvas);

    connections.forEach((conn) => {
      const fromNode = nodes.find((n) => n.id === conn.fromNodeId);
      const toNode = nodes.find((n) => n.id === conn.toNodeId);
      if (!fromNode || !toNode) return;

      const { startX, startY, endX, endY } = getConnectionPoints(fromNode, toNode);
      const path = getBezierPath(startX, startY, endX, endY);

      const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathElement.setAttribute('d', path);

      rc.path(path, {
        stroke: '#8B5E3C',
        strokeWidth: 2,
        roughness: 1.2,
      });

      const angle = getConnectionAngle(startX, startY, endX, endY);
      const rad = (angle * Math.PI) / 180;
      const arrowSize = 10;

      const p1x = endX - arrowSize * Math.cos(rad - Math.PI / 6);
      const p1y = endY - arrowSize * Math.sin(rad - Math.PI / 6);
      const p2x = endX - arrowSize * Math.cos(rad + Math.PI / 6);
      const p2y = endY - arrowSize * Math.sin(rad + Math.PI / 6);

      rc.polygon(
        [
          [p1x, p1y],
          [endX, endY],
          [p2x, p2y],
        ],
        {
          stroke: '#8B5E3C',
          strokeWidth: 2,
          fill: '#8B5E3C',
          fillStyle: 'solid',
          roughness: 1,
        }
      );
    });

    nodes.forEach((node) => {
      const { x, y, width, height, type, text } = node;

      switch (type) {
        case 'start':
          rc.rectangle(x, y, width, height, {
            stroke: '#8B5E3C',
            strokeWidth: 2,
            roughness: 1.5,
            bowing: 2,
            fill: '#FFFEF7',
            fillStyle: 'solid',
            rx: height / 2,
            ry: height / 2,
          });
          break;
        case 'process':
          rc.rectangle(x, y, width, height, {
            stroke: '#8B5E3C',
            strokeWidth: 2,
            roughness: 1.5,
            bowing: 2,
            fill: '#FFFEF7',
            fillStyle: 'solid',
          });
          break;
        case 'decision': {
          const cx = x + width / 2;
          const cy = y + height / 2;
          const halfW = width / 2;
          const halfH = height / 2;
          rc.polygon(
            [
              [cx, cy - halfH],
              [cx + halfW, cy],
              [cx, cy + halfH],
              [cx - halfW, cy],
            ],
            {
              stroke: '#8B5E3C',
              strokeWidth: 2,
              roughness: 1.5,
              bowing: 2,
              fill: '#FFFEF7',
              fillStyle: 'solid',
            }
          );
          break;
        }
        case 'subprocess':
          rc.rectangle(x + 4, y + 4, width, height, {
            stroke: '#D3C5B5',
            strokeWidth: 2,
            roughness: 1.5,
            bowing: 2,
            fill: '#E8DFD4',
            fillStyle: 'solid',
          });
          rc.rectangle(x, y, width, height, {
            stroke: '#8B5E3C',
            strokeWidth: 2,
            roughness: 1.5,
            bowing: 2,
            fill: '#FFFEF7',
            fillStyle: 'solid',
          });
          break;
      }

      ctx.fillStyle = '#5C4033';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + width / 2, y + height / 2);
    });

    const link = document.createElement('a');
    link.download = 'flowchart.png';
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  }, [nodes, connections]);

  const connectionPaths = useMemo(() => {
    return connections.map((conn) => {
      const fromNode = nodes.find((n) => n.id === conn.fromNodeId);
      const toNode = nodes.find((n) => n.id === conn.toNodeId);
      if (!fromNode || !toNode) return null;

      const { startX, startY, endX, endY } = getConnectionPoints(fromNode, toNode);
      const path = getBezierPath(startX, startY, endX, endY);
      const angle = getConnectionAngle(startX, startY, endX, endY);

      return { id: conn.id, path, startX, startY, endX, endY, angle };
    }).filter(Boolean) as Array<{
      id: string;
      path: string;
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      angle: number;
    }>;
  }, [nodes, connections]);

  const tempConnectionPath = useMemo(() => {
    if (!isConnectMode || !connectFromNodeId) return null;

    const fromNode = nodes.find((n) => n.id === connectFromNodeId);
    if (!fromNode) return null;

    const { startX, startY } = getConnectionPoints(fromNode, {
      id: 'temp',
      type: 'process',
      x: mousePos.x - 50,
      y: mousePos.y - 30,
      width: 100,
      height: 60,
      text: '',
    });

    return getBezierPath(startX, startY, mousePos.x, mousePos.y);
  }, [isConnectMode, connectFromNodeId, nodes, mousePos]);

  const nodeTypes: { type: NodeType; label: string }[] = [
    { type: 'start', label: '开始/结束' },
    { type: 'process', label: '流程' },
    { type: 'decision', label: '判断' },
    { type: 'subprocess', label: '子流程' },
  ];

  useEffect(() => {
    const g = roughSvgRef.current;
    const svg = svgRef.current;
    if (!g || !svg) return;

    while (g.firstChild) {
      g.removeChild(g.firstChild);
    }

    const rc = rough.svg(svg);

    connectionPaths.forEach(({ id, path, endX, endY, angle }) => {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('data-connection-id', id);
      group.classList.add('connection-group');

      const roughPath = rc.path(path, {
        stroke: '#8B5E3C',
        strokeWidth: 2,
        roughness: 1.2,
        bowing: 1,
      });

      if (animatingConnections.has(id)) {
        roughPath.style.strokeDasharray = '1000';
        roughPath.style.strokeDashoffset = '1000';
        roughPath.style.animation = 'drawLine 0.3s ease-out forwards';
      }

      group.appendChild(roughPath);

      const rad = (angle * Math.PI) / 180;
      const arrowSize = 10;
      const p1x = endX - arrowSize * Math.cos(rad - Math.PI / 6);
      const p1y = endY - arrowSize * Math.sin(rad - Math.PI / 6);
      const p2x = endX - arrowSize * Math.cos(rad + Math.PI / 6);
      const p2y = endY - arrowSize * Math.sin(rad + Math.PI / 6);

      const arrow = rc.polygon(
        [
          [p1x, p1y],
          [endX, endY],
          [p2x, p2y],
        ],
        {
          stroke: '#8B5E3C',
          strokeWidth: 2,
          fill: '#8B5E3C',
          fillStyle: 'solid',
          roughness: 0.8,
        }
      );

      group.appendChild(arrow);
      g.appendChild(group);
    });
  }, [connectionPaths, animatingConnections]);

  return (
    <div className="editor-container">
      <Toolbar
        isConnectMode={isConnectMode}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onToggleConnectMode={handleToggleConnectMode}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onExport={handleExport}
      />

      <div className="editor-body">
        <button
          className="sidebar-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          ☰
        </button>

        <div className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
          <h3 className="sidebar-title">节点库</h3>
          <div className="node-palette">
            {nodeTypes.map(({ type, label }) => (
              <div
                key={type}
                className="palette-item"
                draggable
                onDragStart={(e) => handleDragStart(e, type)}
              >
                <div className={`palette-icon ${type}`}>
                  {type === 'start' && '⬭'}
                  {type === 'process' && '▭'}
                  {type === 'decision' && '◇'}
                  {type === 'subprocess' && '▫'}
                </div>
                <span className="palette-label">{label}</span>
              </div>
            ))}
          </div>
          <div className="sidebar-tips">
            <p>💡 提示：</p>
            <ul>
              <li>拖拽节点到画布创建</li>
              <li>双击节点编辑文字</li>
              <li>Delete键删除选中</li>
              <li>Ctrl+Z 撤销</li>
              <li>Ctrl+Shift+Z 重做</li>
            </ul>
          </div>
        </div>

        <div
          ref={canvasRef}
          className={`canvas ${isConnectMode ? 'connect-mode' : ''}`}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          onClick={handleCanvasClick}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <svg
            ref={svgRef}
            className="connection-layer"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
            }}
          >
            <g ref={roughSvgRef} className="rough-connections" />
            {tempConnectionPath && (
              <path
                d={tempConnectionPath}
                fill="none"
                stroke="#8B5E3C"
                strokeWidth="2"
                strokeDasharray="5,5"
                opacity="0.6"
              />
            )}
          </svg>

          {nodes.map((node) => (
            <Node
              key={node.id}
              node={node}
              isSelected={selectedNodeId === node.id}
              isConnecting={isConnectMode}
              onMouseDown={handleNodeMouseDown}
              onDoubleClick={handleDoubleClick}
              onConnectionStart={handleConnectionStart}
              editingNodeId={editingNodeId}
              onTextChange={handleTextChange}
              onTextConfirm={handleTextConfirm}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default Editor;
