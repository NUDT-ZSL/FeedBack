import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';

interface MindMapNode {
  id: string;
  parentId: string | null;
  text: string;
  x: number;
  y: number;
  level: number;
  color: string;
  textColor: string;
  lastModifiedBy: string;
  lastModifiedByName: string;
  lastModifiedAt: number;
  isNew?: boolean;
  fromAngle?: number;
  createdAt?: number;
}

interface RemoteUser {
  id: string;
  name: string;
  color: string;
  cursorX: number;
  cursorY: number;
  selectedNodeId: string | null;
  displayX?: number;
  displayY?: number;
}

const USER_COLORS = [
  '#e53935', '#fb8c00', '#fdd835', '#43a047',
  '#00acc1', '#1e88e5', '#8e24aa', '#ec407a'
];

const MIN_SCALE = 0.3;
const MAX_SCALE = 3;
const NODE_WIDTH = 140;
const NODE_HEIGHT = 48;
const ROOT_RADIUS = 50;

function computeBezierPath(
  x1: number, y1: number, x2: number, y2: number,
  isRoot: boolean
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const controlOffset = Math.min(dist * 0.5, 120);
  const nx = dx / dist;
  const ny = dy / dist;
  const cp1x = x1 + nx * controlOffset;
  const cp1y = y1 + ny * controlOffset;
  const cp2x = x2 - nx * controlOffset;
  const cp2y = y2 - ny * controlOffset;
  return `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
}

const App: React.FC = () => {
  const [nodes, setNodes] = useState<Map<string, MindMapNode>>(new Map());
  const [remoteUsers, setRemoteUsers] = useState<Map<string, RemoteUser>>(new Map());
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [currentUserColor, setCurrentUserColor] = useState<string>(USER_COLORS[5]);
  const [currentUserName, setCurrentUserName] = useState<string>('');
  const [roomId, setRoomId] = useState<string>('default');
  const [roomInput, setRoomInput] = useState<string>('');
  const [nameInput, setNameInput] = useState<string>('');
  const [connected, setConnected] = useState<boolean>(false);
  const [scale, setScale] = useState<number>(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [mouseCanvasPos, setMouseCanvasPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showPlusMenuFor, setShowPlusMenuFor] = useState<string | null>(null);
  const [myCursorCanvasPos, setMyCursorCanvasPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const wsRef = useRef<WebSocket | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const textThrottleRef = useRef<Map<string, number>>(new Map());
  const dragStartRef = useRef<{ x: number; y: number; nodeX: number; nodeY: number } | null>(null);
  const panStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const animFrameRef = useRef<number>(0);
  const localModeRef = useRef<boolean>(true);
  const localUserIdRef = useRef<string>(uuidv4());
  const nodesRef = useRef<Map<string, MindMapNode>>(new Map());

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const getLocalUserName = () => currentUserName || '我';
  const getLocalUserId = () => currentUserId || localUserIdRef.current;
  const getLocalUserColor = () => currentUserColor;

  const getNodeAnchor = useCallback((node: MindMapNode): { x: number; y: number } => {
    if (node.level === 0) {
      return { x: node.x, y: node.y };
    }
    return { x: node.x, y: node.y };
  }, []);

  const initLocalRoom = useCallback(() => {
    const rootId = uuidv4();
    const initialNodes = new Map<string, MindMapNode>();
    const now = Date.now();
    initialNodes.set(rootId, {
      id: rootId,
      parentId: null,
      text: '主题',
      x: 0,
      y: 0,
      level: 0,
      color: '#1565c0',
      textColor: '#ffffff',
      lastModifiedBy: localUserIdRef.current,
      lastModifiedByName: getLocalUserName(),
      lastModifiedAt: now,
      createdAt: now
    });
    setNodes(initialNodes);
    localModeRef.current = true;
  }, [currentUserName]);

  useEffect(() => {
    initLocalRoom();
  }, [initLocalRoom]);

  const screenToCanvas = useCallback((screenX: number, screenY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const x = (screenX - rect.left - rect.width / 2 - offset.x) / scale;
    const y = (screenY - rect.top - rect.height / 2 - offset.y) / scale;
    return { x, y };
  }, [offset, scale]);

  const connectWS = useCallback((room: string, name: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join_room', roomId: room, userName: name }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const now = Date.now();

        if (msg.type === 'room_joined') {
          setCurrentUserId(msg.userId);
          setCurrentUserColor(msg.userColor);
          setCurrentUserName(msg.userName);
          setConnected(true);
          localModeRef.current = false;
          const nodeMap = new Map<string, MindMapNode>();
          for (const n of msg.nodes) {
            nodeMap.set(n.id, { ...n, createdAt: now });
          }
          setNodes(nodeMap);
          const userMap = new Map<string, RemoteUser>();
          for (const u of msg.users) {
            if (u.id !== msg.userId) {
              userMap.set(u.id, { ...u, displayX: u.cursorX, displayY: u.cursorY });
            }
          }
          setRemoteUsers(userMap);
        } else if (msg.type === 'user_joined') {
          setRemoteUsers(prev => {
            const next = new Map(prev);
            next.set(msg.user.id, { ...msg.user, displayX: msg.user.cursorX, displayY: msg.user.cursorY });
            return next;
          });
        } else if (msg.type === 'user_left') {
          setRemoteUsers(prev => {
            const next = new Map(prev);
            next.delete(msg.userId);
            return next;
          });
        } else if (msg.type === 'cursor_update') {
          setRemoteUsers(prev => {
            const next = new Map(prev);
            const u = next.get(msg.userId);
            if (u) {
              next.set(msg.userId, { ...u, cursorX: msg.x, cursorY: msg.y });
            }
            return next;
          });
        } else if (msg.type === 'node_select') {
          setRemoteUsers(prev => {
            const next = new Map(prev);
            const u = next.get(msg.userId);
            if (u) {
              next.set(msg.userId, { ...u, selectedNodeId: msg.nodeId });
            }
            return next;
          });
        } else if (msg.type === 'node_add') {
          setNodes(prev => {
            const next = new Map(prev);
            next.set(msg.node.id, { ...msg.node, isNew: true, fromAngle: msg.fromAngle, createdAt: now });
            return next;
          });
        } else if (msg.type === 'node_update') {
          setNodes(prev => {
            const next = new Map(prev);
            const node = next.get(msg.node.id);
            if (node) {
              next.set(msg.node.id, { ...node, ...msg.node });
            }
            return next;
          });
        } else if (msg.type === 'node_delete') {
          setNodes(prev => {
            const next = new Map(prev);
            for (const id of msg.nodeIds) next.delete(id);
            return next;
          });
        } else if (msg.type === 'node_move') {
          setNodes(prev => {
            const next = new Map(prev);
            const node = next.get(msg.nodeId);
            if (node) {
              next.set(msg.nodeId, {
                ...node, x: msg.x, y: msg.y,
                lastModifiedBy: msg.lastModifiedBy,
                lastModifiedByName: msg.lastModifiedByName,
                lastModifiedAt: msg.lastModifiedAt
              });
            }
            return next;
          });
        } else if (msg.type === 'node_text_edit') {
          setNodes(prev => {
            const next = new Map(prev);
            const node = next.get(msg.nodeId);
            if (node && editingNodeId !== msg.nodeId) {
              next.set(msg.nodeId, {
                ...node, text: msg.text,
                lastModifiedBy: msg.lastModifiedBy,
                lastModifiedByName: msg.lastModifiedByName,
                lastModifiedAt: msg.lastModifiedAt
              });
            }
            return next;
          });
        } else if (msg.type === 'error') {
          alert(msg.message);
        }
      } catch (e) {
        console.error(e);
      }
    };

    ws.onclose = () => {
      setConnected(false);
    };
  }, [editingNodeId]);

  const sendMessage = useCallback((msg: object) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const addChildNode = useCallback((parentId: string, angle: number) => {
    const parent = nodesRef.current.get(parentId);
    if (!parent) return;
    if (parent.level >= 5) {
      alert('最多支持展开5层');
      return;
    }
    const rad = (angle * Math.PI) / 180;
    const distance = 200;
    const offsetX = Math.cos(rad) * distance;
    const offsetY = Math.sin(rad) * distance;
    const now = Date.now();
    const newNode: MindMapNode = {
      id: uuidv4(),
      parentId,
      text: '新节点',
      x: parent.x + offsetX,
      y: parent.y + offsetY,
      level: parent.level + 1,
      color: '#c0ca33',
      textColor: '#263238',
      lastModifiedBy: getLocalUserId(),
      lastModifiedByName: getLocalUserName(),
      lastModifiedAt: now,
      isNew: true,
      fromAngle: angle,
      createdAt: now
    };
    setNodes(prev => {
      const next = new Map(prev);
      next.set(newNode.id, newNode);
      return next;
    });
    if (!localModeRef.current) {
      sendMessage({ type: 'node_add', parentId, angle });
    }
    setShowPlusMenuFor(null);
  }, [sendMessage, currentUserName, currentUserId]);

  const deleteNode = useCallback((nodeId: string) => {
    const node = nodesRef.current.get(nodeId);
    if (!node || node.parentId === null) return;
    const collect = (id: string): string[] => {
      const ids = [id];
      for (const [nid, n] of nodesRef.current) {
        if (n.parentId === id) ids.push(...collect(nid));
      }
      return ids;
    };
    const idsToDelete = collect(nodeId);
    setNodes(prev => {
      const next = new Map(prev);
      for (const id of idsToDelete) next.delete(id);
      return next;
    });
    if (!localModeRef.current) {
      sendMessage({ type: 'node_delete', nodeId });
    }
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [selectedNodeId, sendMessage]);

  const updateNodeText = useCallback((nodeId: string, text: string) => {
    setNodes(prev => {
      const next = new Map(prev);
      const n = next.get(nodeId);
      if (n) {
        next.set(nodeId, {
          ...n, text,
          lastModifiedBy: getLocalUserId(),
          lastModifiedByName: getLocalUserName(),
          lastModifiedAt: Date.now()
        });
      }
      return next;
    });
    const now = Date.now();
    const lastSent = textThrottleRef.current.get(nodeId) || 0;
    if (!localModeRef.current && now - lastSent >= 500) {
      textThrottleRef.current.set(nodeId, now);
      sendMessage({ type: 'node_text_edit', nodeId, text });
    }
  }, [sendMessage, currentUserName, currentUserId]);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const node = nodesRef.current.get(nodeId);
    if (!node) return;
    const pos = screenToCanvas(e.clientX, e.clientY);
    dragStartRef.current = { x: pos.x, y: pos.y, nodeX: node.x, nodeY: node.y };
    setDraggingNodeId(nodeId);
    setSelectedNodeId(nodeId);
    if (!localModeRef.current) {
      sendMessage({ type: 'node_select', nodeId });
    }
  }, [screenToCanvas, sendMessage]);

  const handleNodeDoubleClick = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const node = nodesRef.current.get(nodeId);
    if (!node) return;
    setEditingNodeId(nodeId);
    setEditingText(node.text);
  }, []);

  const handleSvgMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = { x: e.clientX, y: e.clientY, offsetX: offset.x, offsetY: offset.y };
    } else if (e.button === 0) {
      setSelectedNodeId(null);
      setEditingNodeId(null);
      setShowPlusMenuFor(null);
      if (!localModeRef.current) {
        sendMessage({ type: 'node_select', nodeId: null });
      }
    }
  }, [offset, sendMessage]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const pos = screenToCanvas(e.clientX, e.clientY);
    setMouseCanvasPos(pos);
    setMyCursorCanvasPos(pos);

    if (isPanning && panStartRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setOffset({
        x: panStartRef.current.offsetX + dx,
        y: panStartRef.current.offsetY + dy
      });
    }

    if (draggingNodeId && dragStartRef.current) {
      const dx = pos.x - dragStartRef.current.x;
      const dy = pos.y - dragStartRef.current.y;
      const newX = dragStartRef.current.nodeX + dx;
      const newY = dragStartRef.current.nodeY + dy;
      setNodes(prev => {
        const next = new Map(prev);
        const n = next.get(draggingNodeId);
        if (n) {
          next.set(draggingNodeId, {
            ...n, x: newX, y: newY,
            lastModifiedBy: getLocalUserId(),
            lastModifiedByName: getLocalUserName(),
            lastModifiedAt: Date.now()
          });
        }
        return next;
      });
    }

    if (!localModeRef.current && connected) {
      const lastSent = textThrottleRef.current.get('__cursor__') || 0;
      const now = Date.now();
      if (now - lastSent >= 50) {
        textThrottleRef.current.set('__cursor__', now);
        sendMessage({ type: 'cursor_update', x: pos.x, y: pos.y });
      }
    }
  }, [isPanning, draggingNodeId, screenToCanvas, sendMessage, connected, currentUserName, currentUserId]);

  const handleMouseUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false);
      panStartRef.current = null;
    }
    if (draggingNodeId) {
      const node = nodesRef.current.get(draggingNodeId);
      if (node && !localModeRef.current) {
        sendMessage({ type: 'node_move', nodeId: draggingNodeId, x: node.x, y: node.y });
      }
      setDraggingNodeId(null);
      dragStartRef.current = null;
    }
  }, [isPanning, draggingNodeId, sendMessage]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * delta));
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left - rect.width / 2;
    const my = e.clientY - rect.top - rect.height / 2;
    const ratio = newScale / scale;
    setOffset({
      x: mx - (mx - offset.x) * ratio,
      y: my - (my - offset.y) * ratio
    });
    setScale(newScale);
  }, [scale, offset]);

  useEffect(() => {
    const tick = () => {
      setRemoteUsers(prev => {
        let changed = false;
        const next = new Map(prev);
        for (const [id, u] of next) {
          const tx = u.cursorX;
          const ty = u.cursorY;
          const cx = u.displayX ?? tx;
          const cy = u.displayY ?? ty;
          const dx = tx - cx;
          const dy = ty - cy;
          if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            next.set(id, { ...u, displayX: cx + dx * 0.2, displayY: cy + dy * 0.2 });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  useEffect(() => {
    const flush = setInterval(() => {
      for (const [nodeId, lastTime] of textThrottleRef.current) {
        if (nodeId === '__cursor__') continue;
        const now = Date.now();
        if (now - lastTime < 500) continue;
        const node = nodesRef.current.get(nodeId);
        if (node && !localModeRef.current) {
          sendMessage({ type: 'node_text_edit', nodeId, text: node.text });
        }
        textThrottleRef.current.delete(nodeId);
      }
    }, 200);
    return () => clearInterval(flush);
  }, [sendMessage]);

  const nodeList = useMemo(() => Array.from(nodes.values()), [nodes]);
  const userList = useMemo(() => Array.from(remoteUsers.values()), [remoteUsers]);
  const nodeCount = nodeList.length;
  const userCount = (connected ? 1 : 0) + remoteUsers.size;

  const getSelectionHighlights = () => {
    const highlights: { nodeId: string; color: string }[] = [];
    for (const u of userList) {
      if (u.selectedNodeId) highlights.push({ nodeId: u.selectedNodeId, color: u.color });
    }
    return highlights;
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#f5f5f5' }}>
      <div style={{
        height: 56, background: '#e3f2fd', display: 'flex', alignItems: 'center',
        padding: '0 20px', gap: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        zIndex: 10, flexShrink: 0
      }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#1565c0', letterSpacing: 1 }}>
          🧠 MindMeld
        </div>
        <div style={{ flex: 1 }} />
        <input
          placeholder="你的昵称"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') connectWS(roomInput || 'default', nameInput || `用户${Math.floor(Math.random() * 1000)}`); }}
          style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid #bbdefb',
            fontSize: 14, outline: 'none', width: 120, background: '#fff',
            transition: 'box-shadow 0.2s'
          }}
          onFocus={(e) => { e.target.style.boxShadow = '0 0 0 3px rgba(21,101,192,0.2)'; }}
          onBlur={(e) => { e.target.style.boxShadow = 'none'; }}
        />
        <input
          placeholder="房间号"
          value={roomInput}
          onChange={(e) => setRoomInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') connectWS(roomInput || 'default', nameInput || `用户${Math.floor(Math.random() * 1000)}`); }}
          style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid #bbdefb',
            fontSize: 14, outline: 'none', width: 140, background: '#fff',
            transition: 'box-shadow 0.2s'
          }}
          onFocus={(e) => { e.target.style.boxShadow = '0 0 0 3px rgba(21,101,192,0.2)'; }}
          onBlur={(e) => { e.target.style.boxShadow = 'none'; }}
        />
        <button
          onClick={() => connectWS(roomInput || 'default', nameInput || `用户${Math.floor(Math.random() * 1000)}`)}
          style={{
            padding: '8px 20px', borderRadius: 8, border: 'none',
            background: connected ? '#43a047' : '#1565c0', color: '#fff',
            fontSize: 14, fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.15s ease',
            boxShadow: '0 2px 4px rgba(21,101,192,0.3)'
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 8px rgba(21,101,192,0.4)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 4px rgba(21,101,192,0.3)'; }}
          onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.95)'; }}
          onMouseUp={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
        >
          {connected ? `✓ 已连接 ${roomId || 'default'}` : '加入协作'}
        </button>
        {connected && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#455a64' }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: currentUserColor }} />
            {getLocalUserName()}
          </div>
        )}
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', cursor: isPanning ? 'grabbing' : 'default' }}>
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          onMouseDown={handleSvgMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          style={{ display: 'block', userSelect: 'none' }}
        >
          <defs>
            <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
              <polygon points="0 0, 10 5, 0 10" fill="#90a4ae" />
            </marker>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e0e0e0" strokeWidth="0.5" />
            </pattern>
          </defs>

          <rect x="-100000" y="-100000" width="200000" height="200000" fill="url(#grid)" />

          <g transform={`translate(${window.innerWidth / 2 + offset.x}, ${window.innerHeight / 2 + offset.y}) scale(${scale})`}>
            <g>
              {nodeList.map(node => {
                if (node.parentId === null) return null;
                const parent = nodes.get(node.parentId);
                if (!parent) return null;
                const isRootParent = parent.level === 0;
                const start = getNodeAnchor(parent);
                const end = getNodeAnchor(node);
                const sx = isRootParent ? start.x + (end.x > start.x ? ROOT_RADIUS : -ROOT_RADIUS) : start.x;
                const sy = isRootParent ? start.y + (Math.abs(end.x - start.x) < 10 ? (end.y > start.y ? ROOT_RADIUS : -ROOT_RADIUS) : 0) : start.y;
                const ex = end.x - NODE_WIDTH / 2 * Math.sign(end.x - start.x || 1);
                const ey = end.y;
                return (
                  <path
                    key={`edge-${node.id}`}
                    d={computeBezierPath(sx, sy, ex, ey, isRootParent)}
                    fill="none"
                    stroke="#90a4ae"
                    strokeWidth={2}
                    markerEnd="url(#arrowhead)"
                    style={{ transition: 'none' }}
                  />
                );
              })}
            </g>

            {getSelectionHighlights().map((h, i) => {
              const n = nodes.get(h.nodeId);
              if (!n) return null;
              if (n.level === 0) {
                return (
                  <circle
                    key={`sel-${i}-${h.nodeId}`}
                    cx={n.x} cy={n.y}
                    r={ROOT_RADIUS + 6}
                    fill="none"
                    stroke={h.color}
                    strokeWidth={2}
                    strokeDasharray="4 3"
                    opacity={0.9}
                  />
                );
              }
              return (
                <rect
                  key={`sel-${i}-${h.nodeId}`}
                  x={n.x - NODE_WIDTH / 2 - 4}
                  y={n.y - NODE_HEIGHT / 2 - 4}
                  width={NODE_WIDTH + 8}
                  height={NODE_HEIGHT + 8}
                  rx={10} ry={10}
                  fill="none"
                  stroke={h.color}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  opacity={0.9}
                />
              );
            })}

            {selectedNodeId && (() => {
              const n = nodes.get(selectedNodeId);
              if (!n) return null;
              if (n.level === 0) {
                return (
                  <circle
                    cx={n.x} cy={n.y}
                    r={ROOT_RADIUS + 4}
                    fill="none"
                    stroke={getLocalUserColor()}
                    strokeWidth={2.5}
                    opacity={0.95}
                  />
                );
              }
              return (
                <rect
                  x={n.x - NODE_WIDTH / 2 - 3}
                  y={n.y - NODE_HEIGHT / 2 - 3}
                  width={NODE_WIDTH + 6}
                  height={NODE_HEIGHT + 6}
                  rx={10} ry={10}
                  fill="none"
                  stroke={getLocalUserColor()}
                  strokeWidth={2.5}
                  opacity={0.95}
                />
              );
            })()}

            {nodeList.map(node => {
              const isDragging = draggingNodeId === node.id;
              const isEditing = editingNodeId === node.id;
              const isRoot = node.level === 0;
              const showPlus = showPlusMenuFor === node.id;
              const age = node.createdAt ? (Date.now() - node.createdAt) : 9999;
              const justAppeared = node.isNew && age < 400;
              const animProgress = justAppeared ? Math.max(0, 1 - age / 200) : 0;
              const fromAngle = node.fromAngle ?? 0;
              const rad = (fromAngle * Math.PI) / 180;
              const slideDist = 80 * animProgress;
              const translateX = -Math.cos(rad) * slideDist;
              const translateY = -Math.sin(rad) * slideDist;
              const scaleVal = justAppeared ? 1 - animProgress * 0.5 : 1;

              if (isRoot) {
                return (
                  <g key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    style={{ cursor: 'grab' }}
                    onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                    onDoubleClick={(e) => handleNodeDoubleClick(e, node.id)}
                  >
                    {isDragging && (
                      <circle r={ROOT_RADIUS + 4} fill="#00000033" />
                    )}
                    <circle
                      r={ROOT_RADIUS}
                      fill={node.color}
                      style={{
                        transition: 'filter 0.15s',
                        transform: isDragging ? 'scale(1.1)' : 'scale(1)',
                        transformOrigin: 'center',
                        filter: isDragging ? 'drop-shadow(0 3px 12px #00000033)' : 'drop-shadow(0 2px 6px rgba(0,0,0,0.15))',
                        transformBox: 'fill-box'
                      } as React.CSSProperties}
                    />
                    {isEditing ? (
                      <foreignObject x={-45} y={-14} width={90} height={28}>
                        <input
                          autoFocus
                          value={editingText}
                          onChange={(e) => { setEditingText(e.target.value); updateNodeText(node.id, e.target.value); }}
                          onBlur={() => setEditingNodeId(null)}
                          onKeyDown={(e) => { if (e.key === 'Enter') setEditingNodeId(null); }}
                          style={{
                            width: '100%', height: '100%', background: 'transparent',
                            border: 'none', color: node.textColor, fontSize: 15,
                            fontWeight: 600, textAlign: 'center', outline: 'none', padding: 0
                          }}
                        />
                      </foreignObject>
                    ) : (
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={node.textColor}
                        fontSize={15}
                        fontWeight={600}
                        style={{ pointerEvents: 'none', userSelect: 'none' }}
                      >
                        {node.text}
                      </text>
                    )}
                    <g
                      transform={`translate(${ROOT_RADIUS + 2}, 0)`}
                      onClick={(e) => { e.stopPropagation(); setShowPlusMenuFor(showPlus ? null : node.id); }}
                      style={{ cursor: 'pointer' }}
                    >
                      <circle r={14} fill="#fff" stroke={node.color} strokeWidth={2}
                        style={{ transition: 'all 0.15s' }}
                      />
                      <text textAnchor="middle" dominantBaseline="central" fill={node.color} fontSize={18} fontWeight={700}
                        style={{ pointerEvents: 'none' }}>+</text>
                    </g>
                    {showPlus && (
                      <g>
                        {[0, 90, 180, 270].map(angle => {
                          const a = (angle * Math.PI) / 180;
                          const d = ROOT_RADIUS + 45;
                          return (
                            <g key={angle}
                              transform={`translate(${Math.cos(a) * d}, ${Math.sin(a) * d})`}
                              onClick={(e) => { e.stopPropagation(); addChildNode(node.id, angle); }}
                              style={{ cursor: 'pointer' }}
                            >
                              <circle r={13} fill="#c0ca33" stroke="#9e9d24" strokeWidth={1.5} />
                              <text textAnchor="middle" dominantBaseline="central" fill="#263238" fontSize={14} fontWeight={700}
                                style={{ pointerEvents: 'none' }}>+</text>
                            </g>
                          );
                        })}
                      </g>
                    )}
                    <text
                      x={0} y={ROOT_RADIUS + 22}
                      textAnchor="middle"
                      fill="#78909c"
                      fontSize={10}
                      style={{ pointerEvents: 'none' }}
                    >
                      {node.lastModifiedByName}
                    </text>
                  </g>
                );
              }

              return (
                <g key={node.id}
                  transform={`translate(${node.x + translateX}, ${node.y + translateY}) scale(${scaleVal})`}
                  style={{ cursor: 'grab', transformOrigin: `${node.x}px ${node.y}px` }}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                  onDoubleClick={(e) => handleNodeDoubleClick(e, node.id)}
                >
                  <rect
                    x={-NODE_WIDTH / 2} y={-NODE_HEIGHT / 2}
                    width={NODE_WIDTH} height={NODE_HEIGHT}
                    rx={NODE_HEIGHT / 2} ry={NODE_HEIGHT / 2}
                    fill={node.color}
                    style={{
                      transition: 'filter 0.15s',
                      filter: isDragging ? 'drop-shadow(0 3px 12px #00000033)' : 'drop-shadow(0 2px 6px rgba(0,0,0,0.12))',
                      transform: isDragging ? 'scale(1.1)' : 'scale(1)',
                      transformOrigin: 'center',
                      transformBox: 'fill-box'
                    } as React.CSSProperties}
                  />
                  {isEditing ? (
                    <foreignObject x={-NODE_WIDTH / 2 + 10} y={-NODE_HEIGHT / 2 + 6} width={NODE_WIDTH - 20} height={NODE_HEIGHT - 12}>
                      <input
                        autoFocus
                        value={editingText}
                        onChange={(e) => { setEditingText(e.target.value); updateNodeText(node.id, e.target.value); }}
                        onBlur={() => setEditingNodeId(null)}
                        onKeyDown={(e) => { if (e.key === 'Enter') setEditingNodeId(null); }}
                        style={{
                          width: '100%', height: '100%', background: 'transparent',
                          border: 'none', color: node.textColor, fontSize: 14,
                          fontWeight: 500, textAlign: 'center', outline: 'none', padding: 0
                        }}
                      />
                    </foreignObject>
                  ) : (
                    <text
                      textAnchor="middle" dominantBaseline="central"
                      fill={node.textColor}
                      fontSize={14} fontWeight={500}
                      style={{ pointerEvents: 'none', userSelect: 'none' }}
                    >
                      {node.text}
                    </text>
                  )}
                  {node.level < 5 && (
                    <g
                      transform={`translate(${NODE_WIDTH / 2 + 2}, 0)`}
                      onClick={(e) => { e.stopPropagation(); setShowPlusMenuFor(showPlus ? null : node.id); }}
                      style={{ cursor: 'pointer' }}
                    >
                      <circle r={12} fill="#fff" stroke={node.color} strokeWidth={1.5} />
                      <text textAnchor="middle" dominantBaseline="central" fill={node.color} fontSize={16} fontWeight={700}
                        style={{ pointerEvents: 'none' }}>+</text>
                    </g>
                  )}
                  {showPlus && (
                    <g>
                      {[0, 90, 180, 270].map(angle => {
                        const a = (angle * Math.PI) / 180;
                        const d = 55;
                        return (
                          <g key={angle}
                            transform={`translate(${Math.cos(a) * d}, ${Math.sin(a) * d})`}
                            onClick={(e) => { e.stopPropagation(); addChildNode(node.id, angle); }}
                            style={{ cursor: 'pointer' }}
                          >
                            <circle r={12} fill="#c0ca33" stroke="#9e9d24" strokeWidth={1.5} />
                            <text textAnchor="middle" dominantBaseline="central" fill="#263238" fontSize={13} fontWeight={700}
                              style={{ pointerEvents: 'none' }}>+</text>
                          </g>
                        );
                      })}
                    </g>
                  )}
                  {selectedNodeId === node.id && (
                    <g
                      transform={`translate(${NODE_WIDTH / 2 + 2}, ${-NODE_HEIGHT / 2 - 2})`}
                      onClick={(e) => { e.stopPropagation(); deleteNode(node.id); }}
                      style={{ cursor: 'pointer' }}
                    >
                      <circle r={11} fill="#ef5350" />
                      <text textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={14} fontWeight={700}
                        style={{ pointerEvents: 'none' }}>×</text>
                    </g>
                  )}
                  <text
                    x={0} y={NODE_HEIGHT / 2 + 14}
                    textAnchor="middle"
                    fill="#90a4ae"
                    fontSize={9.5}
                    style={{ pointerEvents: 'none' }}
                  >
                    {node.lastModifiedByName}
                  </text>
                </g>
              );
            })}

            {userList.map(u => {
              const x = u.displayX ?? u.cursorX;
              const y = u.displayY ?? u.cursorY;
              return (
                <g key={`cursor-${u.id}`} transform={`translate(${x}, ${y})`} style={{ pointerEvents: 'none' }}>
                  <circle r={8} fill={u.color} stroke="#fff" strokeWidth={2} />
                  <rect x={10} y={-10} rx={4} ry={4} width={u.name.length * 12 + 16} height={20} fill={u.color} opacity={0.9} />
                  <text x={18} y={4} fill="#fff" fontSize={12} fontWeight={600}>{u.name}</text>
                </g>
              );
            })}
          </g>
        </svg>

        <div style={{
          position: 'absolute', left: 20, bottom: 20,
          background: 'rgba(255,255,255,0.7)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderRadius: 12,
          padding: '12px 18px',
          display: 'flex', gap: 20, alignItems: 'center',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          fontSize: 13, color: '#37474f', fontWeight: 500,
          zIndex: 5
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>👥</span>
            <span>{userCount} 人在线</span>
            <div style={{ display: 'flex', gap: 3, marginLeft: 6 }}>
              {connected && <div style={{ width: 8, height: 8, borderRadius: '50%', background: currentUserColor }} />}
              {userList.slice(0, 7).map(u => (
                <div key={u.id} style={{ width: 8, height: 8, borderRadius: '50%', background: u.color }} />
              ))}
            </div>
          </div>
          <div style={{ width: 1, height: 16, background: '#cfd8dc' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>🗺️</span>
            <span>{nodeCount} 个节点</span>
          </div>
          <div style={{ width: 1, height: 16, background: '#cfd8dc' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#78909c' }}>
            <span>缩放 {Math.round(scale * 100)}%</span>
          </div>
        </div>

        <div style={{
          position: 'absolute', right: 20, bottom: 20,
          background: 'rgba(255,255,255,0.75)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderRadius: 10,
          padding: '10px 14px',
          fontSize: 11.5, color: '#607d8b',
          boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
          lineHeight: 1.7
        }}>
          <div>🖱️ 中键拖拽 · 平移画布</div>
          <div>🔍 滚轮 · 缩放</div>
          <div>✏️ 双击节点 · 编辑文字</div>
          <div>➕ 点击加号 · 展开子节点</div>
        </div>
      </div>
    </div>
  );
};

export default App;
