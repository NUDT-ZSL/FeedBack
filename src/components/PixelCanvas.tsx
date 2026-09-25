import { useState } from "react";
import { createPixelEditor, EMPTY_PIXEL, type PixelEditor } from "@/lib/pixelEditor";

const SIZES = [8, 16, 32] as const;
const DEFAULT_COLOR = "#00c853";

export default function PixelCanvas() {
  const [editor] = useState<PixelEditor>(() => createPixelEditor(16, 16));
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);

  const state = editor.getState();

  const paint = (x: number, y: number) => {
    editor.setPixel(x, y, color);
    refresh();
  };

  const resize = (size: number) => {
    editor.resize(size, size);
    refresh();
  };

  const undo = () => {
    editor.undo();
    refresh();
  };

  const redo = () => {
    editor.redo();
    refresh();
  };

  const exportPng = () => {
    const snapshot = editor.exportPixels();
    const scale = 16;
    const canvas = document.createElement("canvas");
    canvas.width = snapshot.width * scale;
    canvas.height = snapshot.height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    snapshot.pixels.forEach((pixel, index) => {
      if (pixel === EMPTY_PIXEL) return;
      ctx.fillStyle = pixel;
      ctx.fillRect((index % snapshot.width) * scale, Math.floor(index / snapshot.width) * scale, scale, scale);
    });
    const link = document.createElement("a");
    link.download = `pixel-art-${snapshot.width}x${snapshot.height}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <span>尺寸:</span>
        {SIZES.map((size) => (
          <button
            key={size}
            onClick={() => resize(size)}
            className={state.width === size ? "font-bold underline" : ""}
          >
            {size}x{size}
          </button>
        ))}
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        <button disabled={!editor.canUndo()} onClick={undo}>撤销</button>
        <button disabled={!editor.canRedo()} onClick={redo}>重做</button>
        <button onClick={exportPng}>导出 PNG</button>
      </div>
      <div
        data-testid="pixel-grid"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${state.width}, 20px)`,
          gap: 1,
          background: "#ccc",
          width: "fit-content",
        }}
      >
        {state.pixels.map((pixel, index) => (
          <div
            key={index}
            data-testid={`pixel-${index}`}
            onClick={() => paint(index % state.width, Math.floor(index / state.width))}
            style={{
              width: 20,
              height: 20,
              background: pixel === EMPTY_PIXEL ? "#fff" : pixel,
              cursor: "pointer",
            }}
          />
        ))}
      </div>
    </div>
  );
}
