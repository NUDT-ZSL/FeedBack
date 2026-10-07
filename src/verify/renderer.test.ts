import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EXPORT_SEAL_SIZE,
  EXPORT_SIZE,
  buildDesignSvg,
  buildExportSvg,
  buildStampSvg,
  drawPaperBackground,
  exportSealPng,
  svgToDataUrl,
  type PngExportDeps,
} from '../core/renderer.ts';
import { createEmptySealState, setCharactersOnState, setFontOnState } from '../core/seal.ts';
import type { SealState } from '../types/index.ts';

const stateWith = (text: string, overrides: Partial<SealState> = {}): SealState => ({
  ...setCharactersOnState(createEmptySealState(), Array.from(text)),
  ...overrides,
});

describe('渲染：当前状态一致性', () => {
  it('设计预览随文字 / 字体 / 刀法 / 尺寸即时变化', () => {
    const state = stateWith('印');
    const svg1 = buildDesignSvg(state);
    assert.match(svg1, /data-char="印"/);

    const fontState = setFontOnState(state, 'jiudiezhuan');
    const svg2 = buildDesignSvg(fontState);
    assert.match(svg2, /data-font="jiudiezhuan"/);
    assert.notEqual(svg1, svg2);

    const yangke = buildDesignSvg({ ...state, style: 'yangke' });
    const yinke = buildDesignSvg({ ...state, style: 'yinke' });
    assert.match(yangke, /data-style="yangke"/);
    assert.match(yinke, /data-style="yinke"/);
    assert.notEqual(yangke, yinke);

    const small = buildDesignSvg({ ...state, size: '1cun' });
    const large = buildDesignSvg({ ...state, size: '2cun' });
    assert.match(small, /width="200"/);
    assert.match(large, /width="400"/);
  });

  it('笔画偏移与归位位置进入渲染结果', () => {
    const state = stateWith('印');
    const moved: SealState = {
      ...state,
      strokes: [{ ...state.strokes[0], position: { x: 12, y: -8 } }],
    };
    const svg = buildDesignSvg(moved);
    assert.match(svg, /translate\(112\.00 -8\.00\)/);
    const dragging: SealState = {
      ...moved,
      strokes: [
        { ...moved.strokes[0], tempOffset: { x: 5, y: 0 } },
      ],
    };
    assert.match(buildDesignSvg(dragging), /translate\(117\.00 -8\.00\)/);
  });

  it('不同印章的渲染互不残留', () => {
    const sealA = buildDesignSvg(stateWith('印'));
    const sealB = buildDesignSvg(stateWith('章'));
    assert.doesNotMatch(sealB, /data-char="印"/);
    assert.doesNotMatch(sealA, /data-char="章"/);
  });
});

describe('导出：480 宣纸 PNG 正确性', () => {
  it('PNG 导出为 480x480、含朱砂印文与宣纸背景', async () => {
    const calls: string[] = [];
    class FakeCtx {
      fillStyle = '';
      strokeStyle = '';
      globalAlpha = 1;
      lineWidth = 1;
      drawnImages: Array<{ src: string; x: number; y: number; width: number; height: number }> = [];
      fillRect = (x: number, y: number, width: number, height: number) => {
        calls.push(`fillRect:${x},${y},${width},${height}`);
      };
      beginPath() {}
      moveTo() {}
      lineTo() {}
      stroke() {}
      drawImage = (img: { src: string }, x: number, y: number, width: number, height: number) => {
        this.drawnImages.push({ src: img.src, x, y, width, height });
      };
    }
    const fakeCtx = new FakeCtx();
    const deps: PngExportDeps = {
      createCanvas: (width, height) => {
        const canvas = {
          width,
          height,
          getContext: () => fakeCtx,
          toDataURL: () => 'data:image/png;base64,FAKE',
        } as unknown as HTMLCanvasElement;
        return canvas;
      },
      loadImage: async (src) => ({ src }) as HTMLImageElement,
    };

    const result = await exportSealPng(stateWith('印章'), deps);
    assert.equal(result, 'data:image/png;base64,FAKE');
    assert.deepEqual(calls[0], `fillRect:0,0,${EXPORT_SIZE},${EXPORT_SIZE}`);
    assert.equal(fakeCtx.drawnImages.length, 1);
    const drawn = fakeCtx.drawnImages[0];
    assert.equal(drawn.x, (EXPORT_SIZE - EXPORT_SEAL_SIZE) / 2);
    assert.equal(drawn.width, EXPORT_SEAL_SIZE);
    assert.ok(drawn.src.startsWith('data:image/svg+xml'));
    assert.match(decodeURIComponent(drawn.src.slice('data:image/svg+xml;charset=utf-8,'.length)), /data-char="印"/);
    assert.match(decodeURIComponent(drawn.src.slice('data:image/svg+xml;charset=utf-8,'.length)), /data-char="章"/);
  });

  it('导出版 SVG 含宣纸色底、纤维与朱砂印文', () => {
    const svg = buildExportSvg(stateWith('印'));
    assert.match(svg, new RegExp(`width="${EXPORT_SIZE}"`));
    assert.match(svg, /#fcf6e6/);
    assert.match(svg, /<line /);
    assert.match(svg, /rgba\(204,51,51,0\.8\)/);
    assert.match(svg, /data-char="印"/);
  });

  it('钤盖预览 SVG 随快照生成且可转 data URL', () => {
    const state = stateWith('书画');
    const svg = buildStampSvg(state, 120);
    assert.match(svg, /width="120"/);
    assert.match(svg, /data-char="书"/);
    assert.match(svg, /data-char="画"/);
    assert.ok(svgToDataUrl(svg).startsWith('data:image/svg+xml'));
  });

  it('drawPaperBackground 可脱离浏览器在纯 Node 环境运行', () => {
    const commands: string[] = [];
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      globalAlpha: 1,
      lineWidth: 1,
      fillRect: (x: number, y: number, width: number, height: number) =>
        commands.push(`rect:${width}x${height}@${x},${y}`),
      beginPath: () => commands.push('begin'),
      moveTo: () => undefined,
      lineTo: () => undefined,
      stroke: () => commands.push('stroke'),
    };
    assert.doesNotThrow(() => drawPaperBackground(ctx, 480, 480));
    assert.ok(commands.length > 20);
    assert.match(commands[0], /^rect:480x480/);
  });
});
