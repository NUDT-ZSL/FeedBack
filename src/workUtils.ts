import { LanternRenderer, Skeleton as RendererSkeleton, SilkColor as RendererSilk } from './LanternRenderer';
import { SILK_COLORS, SKELETONS, Work } from './types';

export function createWork(): Work {
  return {
    id: `work-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    skeletonId: null,
    silkColorId: null,
    strokes: [],
    lines: [],
    isLit: false,
    createdAt: Date.now(),
    randomId: Math.random().toString(36).slice(2, 8).toUpperCase(),
    saved: false,
  };
}

export function toRendererSkeleton(skeletonId: string): RendererSkeleton | null {
  const skeleton = SKELETONS.find((item) => item.id === skeletonId);
  if (!skeleton) {
    return null;
  }
  return {
    paths: skeleton.pathD,
    bounds: {
      x: skeleton.viewBox.x,
      y: skeleton.viewBox.y,
      width: skeleton.viewBox.w,
      height: skeleton.viewBox.h,
    },
  };
}

export function toRendererSilk(silkColorId: string): RendererSilk | null {
  const silk = SILK_COLORS.find((item) => item.id === silkColorId);
  if (!silk) {
    return null;
  }
  return {
    primary: silk.hex,
    secondary: silk.hex,
    opacity: silk.opacity,
  };
}

export function loadWorkIntoRenderer(renderer: LanternRenderer, work: Work): void {
  renderer.reset();

  const skeleton = work.skeletonId ? toRendererSkeleton(work.skeletonId) : null;
  if (skeleton) {
    renderer.drawSkeleton(skeleton);
  }

  const silk = work.silkColorId ? toRendererSilk(work.silkColorId) : null;
  if (silk) {
    renderer.drawSilk(silk);
  }

  renderer.drawStrokes(work.strokes, work.lines);
  renderer.setLitGlow(work.isLit);
  renderer.render();
}

export function exportWorkPNG(work: Work, size = { w: 512, h: 512 }): string {
  const canvas = document.createElement('canvas');
  const renderer = new LanternRenderer(canvas);
  loadWorkIntoRenderer(renderer, work);
  return renderer.exportPNG(size, true);
}

export function downloadDataURL(dataURL: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataURL;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function formatTimestamp(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    hour12: false,
  });
}
