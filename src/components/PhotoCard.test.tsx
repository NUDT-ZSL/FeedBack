import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import PhotoCard from './PhotoCard';
import type { Photo } from '../types';

const photo: Photo = {
  id: 1,
  title: '测试作品',
  url: 'https://example.com/x.jpg',
  tags: ['风光'],
  likes: 10,
  date: '2024-01-01',
};

describe('PhotoCard 连续快速点赞', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('动画锁窗口内的连续点击只产生一次点赞', () => {
    const onLike = vi.fn();
    render(<PhotoCard photo={photo} onLike={onLike} onClick={() => {}} />);
    const likeBtn = screen.getByRole('button');

    // 同一时刻连续触发多次点击（模拟快速连点/双击）
    fireEvent.click(likeBtn);
    fireEvent.click(likeBtn);
    fireEvent.click(likeBtn);
    fireEvent.click(likeBtn);
    fireEvent.click(likeBtn);
    expect(onLike).toHaveBeenCalledTimes(1);
    expect(onLike).toHaveBeenCalledWith(1);
  });

  it('锁释放后的点击可再次点赞，行为可预期', () => {
    const onLike = vi.fn();
    render(<PhotoCard photo={photo} onLike={onLike} onClick={() => {}} />);
    const likeBtn = screen.getByRole('button');

    fireEvent.click(likeBtn);
    expect(onLike).toHaveBeenCalledTimes(1);

    // 窗口期内的点击被吞掉
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.click(likeBtn);
    expect(onLike).toHaveBeenCalledTimes(1);

    // 窗口期结束后恢复响应
    act(() => {
      vi.advanceTimersByTime(150);
    });
    fireEvent.click(likeBtn);
    expect(onLike).toHaveBeenCalledTimes(2);
  });

  it('点击点赞按钮不会触发卡片点击（不打开模态框）', () => {
    const onLike = vi.fn();
    const onClick = vi.fn();
    render(<PhotoCard photo={photo} onLike={onLike} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onLike).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });
});
