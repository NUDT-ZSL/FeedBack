import { LanternRenderer } from './LanternRenderer';
import {
  LanternWork,
  SKELETONS,
  SILK_COLORS,
} from './types';

export const syncRendererWithWork = (
  renderer: LanternRenderer,
  work: LanternWork | null
): void => {
  if (!work || !work.skeleton) {
    renderer.resetAll();
    return;
  }

  const skeletonDef = SKELETONS.find((s) => s.id === work.skeleton);
  if (!skeletonDef) {
    renderer.resetAll();
    return;
  }

  renderer.drawSkeleton({
    paths: skeletonDef.pathD,
    bounds: {
      x: skeletonDef.viewBox.x,
      y: skeletonDef.viewBox.y,
      width: skeletonDef.viewBox.w,
      height: skeletonDef.viewBox.h,
    },
  });

  const silkDef = SILK_COLORS.find((c) => c.id === work.silkColor);
  if (silkDef) {
    renderer.drawSilk({
      primary: silkDef.hex,
      secondary: silkDef.hex,
      opacity: silkDef.opacity,
    });
  }

  renderer.drawStrokes(work.strokes, work.lines);
  renderer.setLit(work.isLit);
  renderer.render();
};

const thumbnailCache = new Map<string, string>();

export const renderWorkThumbnail = (work: LanternWork): string => {
  const cacheKey = `${work.id}:${work.updatedAt}:${work.isLit}:${
    work.strokes.length + work.lines.length
  }`;
  const cached = thumbnailCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  const renderer = new LanternRenderer(canvas);
  syncRendererWithWork(renderer, work);
  const url = renderer.exportPNG({ w: 256, h: 256 }, true, work.isLit);
  thumbnailCache.set(cacheKey, url);

  if (thumbnailCache.size > 240) {
    const firstKey = thumbnailCache.keys().next().value;
    if (firstKey !== undefined) thumbnailCache.delete(firstKey);
  }

  return url;
};

const fullImageCache = new Map<string, string>();

export const renderWorkFullImage = (work: LanternWork): string => {
  const cacheKey = `${work.id}:${work.updatedAt}`;
  const cached = fullImageCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  const renderer = new LanternRenderer(canvas);
  syncRendererWithWork(renderer, work);
  const url = renderer.exportPNG({ w: 512, h: 512 }, true, work.isLit);
  fullImageCache.set(cacheKey, url);

  if (fullImageCache.size > 120) {
    const firstKey = fullImageCache.keys().next().value;
    if (firstKey !== undefined) fullImageCache.delete(firstKey);
  }

  return url;
};
