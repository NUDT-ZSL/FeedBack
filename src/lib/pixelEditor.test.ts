import { describe, expect, it } from "vitest";
import { createPixelEditor, EMPTY_PIXEL } from "./pixelEditor";

const RED = "#ff0000";
const GREEN = "#00ff00";
const BLUE = "#0000ff";

function paintedPixels(pixels: string[]): Array<[number, string]> {
  const result: Array<[number, string]> = [];
  pixels.forEach((color, index) => {
    if (color !== EMPTY_PIXEL) result.push([index, color]);
  });
  return result;
}

describe("尺寸切换链路", () => {
  it("切换尺寸后画布尺寸与像素数组长度一致", () => {
    const editor = createPixelEditor(8, 8);
    editor.resize(16, 16);
    const state = editor.getState();
    expect(state.width).toBe(16);
    expect(state.height).toBe(16);
    expect(state.pixels).toHaveLength(16 * 16);
  });

  it("放大尺寸时保留左上角已有像素，新增区域为空", () => {
    const editor = createPixelEditor(8, 8);
    editor.setPixel(0, 0, RED);
    editor.setPixel(7, 7, BLUE);
    editor.resize(16, 16);
    const state = editor.getState();
    expect(state.pixels[0]).toBe(RED);
    expect(state.pixels[7 * 16 + 7]).toBe(BLUE);
    expect(paintedPixels(state.pixels)).toHaveLength(2);
  });

  it("缩小尺寸时保留左上角重叠区域，裁掉越界像素", () => {
    const editor = createPixelEditor(16, 16);
    editor.setPixel(0, 0, RED);
    editor.setPixel(15, 15, BLUE);
    editor.resize(8, 8);
    const state = editor.getState();
    expect(state.pixels).toHaveLength(64);
    expect(state.pixels[0]).toBe(RED);
    expect(paintedPixels(state.pixels)).toHaveLength(1);
  });

  it("切换尺寸进入历史：撤销后尺寸与像素都回到切换前", () => {
    const editor = createPixelEditor(8, 8);
    editor.setPixel(3, 4, GREEN);
    editor.resize(16, 16);
    expect(editor.undo()).toBe(true);
    const state = editor.getState();
    expect(state.width).toBe(8);
    expect(state.height).toBe(8);
    expect(state.pixels).toHaveLength(64);
    expect(state.pixels[4 * 8 + 3]).toBe(GREEN);
  });

  it("撤销尺寸切换后重做，尺寸与像素再次切到新尺寸", () => {
    const editor = createPixelEditor(8, 8);
    editor.setPixel(1, 1, RED);
    editor.resize(16, 16);
    editor.undo();
    expect(editor.redo()).toBe(true);
    const state = editor.getState();
    expect(state.width).toBe(16);
    expect(state.pixels).toHaveLength(256);
    expect(state.pixels[1 * 16 + 1]).toBe(RED);
  });
});
describe("撤销重做链路", () => {
  it("连续绘制后可逐步撤销回空白画布", () => {
    const editor = createPixelEditor(8, 8);
    editor.setPixel(0, 0, RED);
    editor.setPixel(1, 1, GREEN);
    editor.setPixel(2, 2, BLUE);

    editor.undo();
    expect(paintedPixels(editor.getState().pixels)).toEqual([
      [0, RED],
      [1 * 8 + 1, GREEN],
    ]);

    editor.undo();
    expect(paintedPixels(editor.getState().pixels)).toEqual([[0, RED]]);

    editor.undo();
    expect(paintedPixels(editor.getState().pixels)).toEqual([]);
    expect(editor.canUndo()).toBe(false);
  });

  it("撤销到底后继续撤销返回 false 且状态不变", () => {
    const editor = createPixelEditor(8, 8);
    editor.setPixel(0, 0, RED);
    editor.undo();
    const before = editor.exportPixels();
    expect(editor.undo()).toBe(false);
    expect(editor.exportPixels()).toEqual(before);
  });

  it("连续撤销后可按相反顺序重做到最新状态", () => {
    const editor = createPixelEditor(8, 8);
    editor.setPixel(0, 0, RED);
    editor.setPixel(1, 1, GREEN);
    editor.setPixel(2, 2, BLUE);
    editor.undo();
    editor.undo();
    editor.undo();

    editor.redo();
    expect(paintedPixels(editor.getState().pixels)).toEqual([[0, RED]]);
    editor.redo();
    expect(paintedPixels(editor.getState().pixels)).toEqual([
      [0, RED],
      [1 * 8 + 1, GREEN],
    ]);
    editor.redo();
    expect(paintedPixels(editor.getState().pixels)).toEqual([
      [0, RED],
      [1 * 8 + 1, GREEN],
      [2 * 8 + 2, BLUE],
    ]);
    expect(editor.canRedo()).toBe(false);
  });

  it("撤销后进行新的绘制会清空重做栈", () => {
    const editor = createPixelEditor(8, 8);
    editor.setPixel(0, 0, RED);
    editor.undo();
    editor.setPixel(5, 5, GREEN);
    expect(editor.canRedo()).toBe(false);
    expect(editor.redo()).toBe(false);
    expect(paintedPixels(editor.getState().pixels)).toEqual([[5 * 8 + 5, GREEN]]);
  });

  it("覆盖同一像素时撤销恢复的是上一次的值", () => {
    const editor = createPixelEditor(8, 8);
    editor.setPixel(2, 2, RED);
    editor.setPixel(2, 2, BLUE);
    editor.undo();
    expect(editor.getState().pixels[2 * 8 + 2]).toBe(RED);
    editor.undo();
    expect(editor.getState().pixels[2 * 8 + 2]).toBe(EMPTY_PIXEL);
  });
});
describe("导出链路", () => {
  it("导出结果与当前画布尺寸和像素完全一致", () => {
    const editor = createPixelEditor(8, 8);
    editor.setPixel(0, 0, RED);
    editor.setPixel(3, 5, GREEN);
    const snapshot = editor.exportPixels();
    expect(snapshot.width).toBe(8);
    expect(snapshot.height).toBe(8);
    expect(snapshot.pixels).toEqual(editor.getState().pixels);
  });

  it("导出的是快照副本：之后继续绘制不影响已导出结果", () => {
    const editor = createPixelEditor(8, 8);
    editor.setPixel(0, 0, RED);
    const snapshot = editor.exportPixels();
    editor.setPixel(1, 1, GREEN);
    expect(snapshot.pixels[1 * 8 + 1]).toBe(EMPTY_PIXEL);
    expect(paintedPixels(snapshot.pixels)).toEqual([[0, RED]]);
  });

  it("撤销后导出反映撤销后的画布状态", () => {
    const editor = createPixelEditor(8, 8);
    editor.setPixel(0, 0, RED);
    editor.setPixel(1, 1, GREEN);
    editor.undo();
    const snapshot = editor.exportPixels();
    expect(paintedPixels(snapshot.pixels)).toEqual([[0, RED]]);
  });

  it("切换尺寸后导出的尺寸与新画布一致", () => {
    const editor = createPixelEditor(8, 8);
    editor.setPixel(2, 2, BLUE);
    editor.resize(16, 16);
    const snapshot = editor.exportPixels();
    expect(snapshot.width).toBe(16);
    expect(snapshot.height).toBe(16);
    expect(snapshot.pixels).toHaveLength(256);
    expect(snapshot.pixels[2 * 16 + 2]).toBe(BLUE);
  });
});
