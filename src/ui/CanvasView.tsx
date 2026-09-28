import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { GradientEngine, type ColorStop, type GradientConfig } from '../core/GradientEngine';
import { CardTemplate, type CardLayout } from '../core/CardTemplate';
import './styles/CanvasView.css';

interface CanvasViewProps {
  stops: ColorStop[];
  gradient: GradientConfig;
  layout: CardLayout;
  selectedStopId: string | null;
  onSelectStop: (id: string | null) => void;
  onUpdateStopPosition: (id: string, position: number) => void;
}

const CanvasView: React.FC<CanvasViewProps> = ({
  stops,
  gradient,
  layout,
  selectedStopId,
  onSelectStop,
  onUpdateStopPosition,
}) => {
  const canvasRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [displayedGradient, setDisplayedGradient] = useState<GradientConfig>(gradient);
  const animFrameRef = useRef<number | null>(null);

  const template = CardTemplate.getTemplate(layout.templateId);
  const engine = useMemo(() => new GradientEngine(stops, gradient), [stops, gradient]);
  const sortedStops = useMemo(() => engine.getStopsSorted(), [engine]);

  useEffect(() => {
    const start = displayedGradient;
    const end = gradient;
    const duration = 400;
    const startTime = performance.now();

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

      const lerp = (a: number, b: number) => a + (b - a) * eased;

      setDisplayedGradient({
        type: end.type,
        angle:
          start.type === end.type ? lerp(start.angle, end.angle) : end.angle,
        centerX:
          start.type === end.type
            ? lerp(start.centerX, end.centerX)
            : end.centerX,
        centerY:
          start.type === end.type
            ? lerp(start.centerY, end.centerY)
            : end.centerY,
      });

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [gradient]);

  const displayEngine = useMemo(
    () => new GradientEngine(stops, displayedGradient),
    [stops, displayedGradient]
  );

  const gradientDef = useMemo(
    () => displayEngine.generateGradientDef('cardGradient'),
    [displayEngine]
  );

  const cardContent = useMemo(
    () =>
      CardTemplate.generateCardContent(
        template.width,
        template.height,
        layout,
        'cardGradient'
      ),
    [template, layout]
  );

  const conicBackground = useMemo(() => {
    if (displayedGradient.type === 'conic') {
      return displayEngine.generateConicCSS();
    }
    return '';
  }, [displayEngine, displayedGradient.type]);

  const svgContent = useMemo(() => {
    if (displayedGradient.type === 'conic') {
      return `
        <defs></defs>
        <foreignObject x="0" y="0" width="${template.width}" height="${template.height}">
          <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;background:${conicBackground};"></div>
        </foreignObject>
        ${cardContent
          .replace(/<rect[^>]*fill="url\(#cardGradient\)"[^>]*\/>/g, '')
          .trim()}
      `;
    }
    return `<defs>${gradientDef}</defs>${cardContent}`;
  }, [displayedGradient.type, template, gradientDef, cardContent, conicBackground]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, stopId: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDraggingId(stopId);
      onSelectStop(stopId);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [onSelectStop]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!draggingId || !trackRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
      onUpdateStopPosition(draggingId, Math.round(percent * 10) / 10);
    },
    [draggingId, onUpdateStopPosition]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (draggingId) {
        try {
          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        } catch (_err) {
          /* ignore */
        }
        setDraggingId(null);
      }
    },
    [draggingId]
  );

  return (
    <div className="canvas-container" ref={canvasRef}>
      <div
        className="canvas-card"
        style={{
          aspectRatio: `${template.width} / ${template.height}`,
          width: `min(${template.width}px, calc(100vw - 600px))`,
        }}
      >
        <svg
          viewBox={`0 0 ${template.width} ${template.height}`}
          width={template.width}
          height={template.height}
          xmlns="http://www.w3.org/2000/svg"
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
        <div className="anchor-overlay">
          {displayedGradient.type === 'linear' && (
            <>
              <div className="angle-indicator">{Math.round(gradient.angle)}°</div>
              <div
                className="angle-line"
                style={{
                  transform: `translate(-50%, -50%) rotate(${
                    displayedGradient.angle - 90
                  }deg)`,
                  transformOrigin: 'left center',
                  left: '50%',
                  top: '50%',
                }}
              />
            </>
          )}
          {displayedGradient.type === 'radial' && (
            <>
              <div
                className="center-indicator"
                style={{
                  left: `${displayedGradient.centerX}%`,
                  top: `${displayedGradient.centerY}%`,
                  width: '60%',
                  height: '60%',
                }}
              />
              <div
                className="center-dot"
                style={{
                  left: `${displayedGradient.centerX}%`,
                  top: `${displayedGradient.centerY}%`,
                }}
              />
            </>
          )}
          {displayedGradient.type === 'conic' && (
            <div className="angle-indicator">{Math.round(gradient.angle)}°</div>
          )}

          <div
            className="anchor-track"
            ref={trackRef}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onClick={e => e.stopPropagation()}
          >
            <div className="anchor-track-hint">拖拽锚点调整渐变位置</div>
            {sortedStops.map(stop => (
              <div
                key={stop.id}
                className={`anchor-stop ${selectedStopId === stop.id ? 'selected' : ''} ${
                  draggingId === stop.id ? 'dragging' : ''
                }`}
                style={{
                  left: `${stop.position}%`,
                  background: stop.color,
                }}
                onPointerDown={e => handlePointerDown(e, stop.id)}
                onClick={e => {
                  e.stopPropagation();
                  onSelectStop(stop.id);
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(CanvasView);
