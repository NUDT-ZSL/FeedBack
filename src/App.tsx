import { useCallback, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import html2canvas from 'html2canvas';
import CompositionArea from './components/CompositionArea.tsx';
import InkControl from './components/InkControl.tsx';
import TypeRack from './components/TypeRack.tsx';
import {
  clearBoard,
  createInitialState,
  exportSnapshot,
  movePlaced,
  placeFromRack,
  setFontSize,
  setInkColor,
  setInkMix,
  takeBack,
  type CompositionState
} from './state/composition.ts';

const SHAKE_DURATION_MS = 300;

export default function App() {
  const [state, setState] = useState<CompositionState>(() =>
    createInitialState({ createId: () => uuidv4() })
  );
  const [shakingCell, setShakingCell] = useState<number | null>(null);
  const [imprint, setImprint] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);

  const rejectAt = useCallback((position: number) => {
    setShakingCell(position);
    window.setTimeout(() => setShakingCell(null), SHAKE_DURATION_MS);
  }, []);

  const handlePlace = useCallback(
    (charId: string, position: number) => {
      try {
        setState(placeFromRack(state, charId, position));
      } catch {
        rejectAt(position);
      }
    },
    [state, rejectAt]
  );

  const handleMove = useCallback(
    (fromPosition: number, toPosition: number) => {
      try {
        setState(movePlaced(state, fromPosition, toPosition));
      } catch {
        rejectAt(toPosition);
      }
    },
    [state, rejectAt]
  );

  const handleTakeBack = useCallback((charId: string) => {
    setState((current) => takeBack(current, charId));
  }, []);

  const handleClear = useCallback(() => {
    setState((current) => clearBoard(current));
  }, []);

  const handleInkColor = useCallback((value: string) => {
    setState((current) => setInkColor(current, value));
  }, []);

  const handleFontSize = useCallback((value: number) => {
    setState((current) => setFontSize(current, value));
  }, []);

  const handleInkMix = useCallback((value: number) => {
    setState((current) => setInkMix(current, value));
  }, []);

  const handleImprint = useCallback(() => {
    setImprint(true);
    window.setTimeout(() => setImprint(false), 2000);
  }, []);

  const handleExport = useCallback(() => {
    const element = boardRef.current;
    if (element === null) return;
    const snapshot = exportSnapshot(state);
    void html2canvas(element, {
      backgroundColor: '#f5e6c8',
      scale: 4,
      useCORS: true
    }).then((canvas) => {
      const link = document.createElement('a');
      link.download = `活字排样-${snapshot.placedCount}字-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    });
  }, [state]);

  return (
    <main className="workbench">
      <h1 className="workbench-title">活字印刷排样</h1>
      <div className="workbench-layout">
        <CompositionArea
          state={state}
          shakingCell={shakingCell}
          imprint={imprint}
          boardRef={boardRef}
          onPlace={handlePlace}
          onMove={handleMove}
          onTakeBack={handleTakeBack}
          onClear={handleClear}
        />
        <InkControl
          state={state}
          onInkColor={handleInkColor}
          onFontSize={handleFontSize}
          onInkMix={handleInkMix}
          onImprint={handleImprint}
          onExport={handleExport}
        />
        <TypeRack rack={state.rack} />
      </div>
    </main>
  );
}
