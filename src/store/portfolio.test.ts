import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  portfolioReducer,
  selectAllTags,
  selectFilteredPhotos,
  selectTopPhotos,
  selectMaxLikes,
  selectSelectedPhoto,
} from './portfolio';
import { initialPhotos } from '../data/photos';

const makeState = () => createInitialState(initialPhotos);

describe('单一数据源派生一致性', () => {
  it('标签筛选与搜索叠加：结果同时满足两个条件，且与源集合共享同一对象引用', () => {
    const state = makeState();
    const result = selectFilteredPhotos(state.photos, ['风光'], '晨雾', 'likes');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('山间晨雾');
    // 派生结果与源集合中的对象是同一引用，不存在第二份数据
    expect(result[0]).toBe(state.photos.find(p => p.id === result[0].id));
  });

  it('多标签 + 搜索叠加：取并集标签后再与搜索求交', () => {
    const state = makeState();
    const result = selectFilteredPhotos(state.photos, ['人像', '街拍'], '写真', 'likes');
    expect(result.map(p => p.title).sort()).toEqual(['儿童写真', '情侣写真']);
  });

  it('排序切换：按热度降序 / 按日期降序，且过滤条件保持一致', () => {
    const state = makeState();
    const byLikes = selectFilteredPhotos(state.photos, [], '', 'likes');
    for (let i = 1; i < byLikes.length; i++) {
      expect(byLikes[i - 1].likes).toBeGreaterThanOrEqual(byLikes[i].likes);
    }
    const byDate = selectFilteredPhotos(state.photos, [], '', 'date');
    for (let i = 1; i < byDate.length; i++) {
      expect(new Date(byDate[i - 1].date).getTime())
        .toBeGreaterThanOrEqual(new Date(byDate[i].date).getTime());
    }
    expect(byDate[0].title).toBe('湖泊秋色');
    // 同一筛选条件下，两种排序包含完全相同的照片集合
    expect(new Set(byLikes.map(p => p.id))).toEqual(new Set(byDate.map(p => p.id)));
  });

  it('模态框打开期间点赞：selectedPhoto 派生值同步反映最新点赞数', () => {
    let state = makeState();
    state = portfolioReducer(state, { type: 'OPEN_PHOTO', id: 1 });
    expect(selectSelectedPhoto(state.photos, state.selectedPhotoId)?.likes).toBe(128);

    state = portfolioReducer(state, { type: 'LIKE_PHOTO', id: 1 });
    const selected = selectSelectedPhoto(state.photos, state.selectedPhotoId);
    expect(selected?.likes).toBe(129);
    // 与画廊派生数据中的同一张照片是同一对象
    const gallery = selectFilteredPhotos(state.photos, [], '', 'likes');
    expect(gallery.find(p => p.id === 1)).toBe(selected);
  });

  it('排行、进度条基准与画廊来自同一份照片集合，点赞后各视图同步', () => {
    let state = makeState();
    state = portfolioReducer(state, { type: 'LIKE_PHOTO', id: 14 }); // 星空银河 412 -> 413
    const top = selectTopPhotos(state.photos);
    const gallery = selectFilteredPhotos(state.photos, [], '', 'likes');
    expect(top).toHaveLength(5);
    expect(top[0].id).toBe(14);
    expect(top[0].likes).toBe(413);
    expect(gallery[0]).toBe(top[0]);
    expect(selectMaxLikes(state.photos)).toBe(413);
  });

  it('空结果：搜索无匹配时画廊为空，其余选择器仍然可用', () => {
    const state = makeState();
    expect(selectFilteredPhotos(state.photos, [], '不存在的作品xyz', 'likes')).toEqual([]);
    expect(selectFilteredPhotos(state.photos, ['风光'], '美食', 'date')).toEqual([]);
    expect(selectAllTags(state.photos).length).toBeGreaterThan(0);
    expect(selectTopPhotos(state.photos)).toHaveLength(5);
    expect(selectMaxLikes([])).toBe(0);
    expect(selectSelectedPhoto(state.photos, null)).toBeNull();
    expect(selectSelectedPhoto(state.photos, 999)).toBeNull();
  });

  it('点赞为不可变更新：原集合不被修改，且单次 dispatch 只累加一次', () => {
    const state = makeState();
    const prevPhotos = state.photos;
    const next = portfolioReducer(state, { type: 'LIKE_PHOTO', id: 1 });
    expect(next.photos).not.toBe(prevPhotos);
    expect(prevPhotos.find(p => p.id === 1)?.likes).toBe(128);
    expect(next.photos.find(p => p.id === 1)?.likes).toBe(129);
  });
});
