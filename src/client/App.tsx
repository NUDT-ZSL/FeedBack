import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CanvasElement } from './Canvas';
import Toolbar from './Toolbar';
import Canvas from './Canvas';

const App: React.FC = () => {
  const [color, setColor] = useState<string>('#000000');
  const [brushSize, setBrushSize] = useState<number>(3);
  const [tool, setTool] = useState<'freehand' | 'rectangle' | 'circle' | 'line' | 'text' | 'sticker'>('freehand');
  const [sticker, setSticker] = useState<string>('😊');
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const hue = Math.floor(Math.random() * 360);
    const hsl = `hsl(${hue}, 70%, 50%)`;
    const temp = document.createElement('canvas').getContext('2d');
    if (temp) {
      temp.fillStyle = hsl;
      const hex = temp.fillStyle;
      setColor(hex);
    }
  }, []);

  const connectWebSocket = useCallback(() => {
    const ws = new WebSocket(`ws://${window.location.hostname}:3001`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.action) {
          case 'snapshot':
            setElements(data.elements);
            break;
          case 'draw':
            setElements((prev) => [...prev, data.element]);
            break;
          case 'move':
            setElements((prev) =>
              prev.map((el) =>
                el.id === data.id ? { ...el, x: data.x, y: data.y } : el
              )
            );
            break;
          case 'delete':
            setElements((prev) => prev.filter((el) => el.id !== data.id));
            break;
          case 'clear':
            setElements([]);
            break;
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message', e);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setTimeout(() => {
        connectWebSocket();
      }, 3000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error', error);
    };
  }, []);

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectWebSocket]);

  const onDraw = useCallback((element: CanvasElement) => {
    setElements((prev) => [...prev, element]);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'draw', element }));
    }
  }, []);

  const onMove = useCallback((id: string, x: number, y: number) => {
    setElements((prev) =>
      prev.map((el) => (el.id === id ? { ...el, x, y } : el))
    );
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'move', id, x, y }));
    }
  }, []);

  const onDelete = useCallback((id: string) => {
    setElements((prev) => prev.filter((el) => el.id !== id));
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'delete', id }));
    }
  }, []);

  const onClear = useCallback(() => {
    setElements([]);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'clear' }));
    }
  }, []);

  const onAddElements = useCallback((newElements: CanvasElement[]) => {
    setElements(newElements);
  }, []);

  return (
    <>
      <Toolbar
        color={color}
        brushSize={brushSize}
        tool={tool}
        sticker={sticker}
        onColorChange={setColor}
        onBrushSizeChange={setBrushSize}
        onToolChange={setTool}
        onStickerSelect={setSticker}
        onClear={onClear}
      />
      <Canvas
        color={color}
        brushSize={brushSize}
        tool={tool}
        sticker={sticker}
        onDraw={onDraw}
        onMove={onMove}
        onDelete={onDelete}
        elements={elements}
        onAddElements={onAddElements}
      />
    </>
  );
};

export default App;
