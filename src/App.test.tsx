import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, act, cleanup, within } from '@testing-library/react';
import App from './App';

const advance = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

const getCardByTitle = (title: string): HTMLElement => {
  const node = screen
    .getAllByText(title)
    .find(el => el.closest('.photo-card') !== null);
  if (!node) throw new Error(`未找到卡片: ${title}`);
  return node.closest('.photo-card') as HTMLElement;
};

const getRankingItemByTitle = (title: string): HTMLElement => {
  const node = screen
    .getAllByText(title)
    .find(el => el.closest('.ranking-item') !== null);
  if (!node) throw new Error(`未找到排行项: ${title}`);
  return node.closest('.ranking-item') as HTMLElement;
};

describe('App 跨视图状态一致性', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('模态框打开期间在卡片上点赞，模态框、卡片、排行三处同步更新', () => {
    render(<App />);
    const card = getCardByTitle('星空银河'); // 412 赞，热度第一

    // 打开模态框
    fireEvent.click(card);
    const modalInfo = document.querySelector('.modal-info') as HTMLElement;
    expect(modalInfo.textContent).toContain('412 次点赞');

    // 模态框打开期间，在画廊卡片上点赞
    fireEvent.click(within(card).getByRole('button'));

    // 模态框同步为最新点赞数
    expect(modalInfo.textContent).toContain('413 次点赞');
    // 卡片上的计数同步
    expect(card.querySelector('.like-count-number')?.textContent).toBe('413');
    // 排行中的计数同步
    const rankingItem = getRankingItemByTitle('星空银河');
    expect(rankingItem.querySelector('.ranking-likes')?.textContent).toBe('413');
  });

  it('标签筛选与搜索叠加：画廊精确匹配，排行与标签集合保持同源一致', () => {
    render(<App />);
    // 选择标签「风光」
    fireEvent.click(screen.getByRole('button', { name: '风光' }));
    // 叠加搜索「晨雾」
    fireEvent.change(screen.getByPlaceholderText('搜索作品...'), {
      target: { value: '晨雾' },
    });
    advance(200);

    const cards = document.querySelectorAll('.photo-card');
    expect(cards).toHaveLength(1);
    expect(within(cards[0] as HTMLElement).getByText('山间晨雾')).toBeInTheDocument();

    // 排行仍从同一份全量照片派生，榜首不变
    const firstRankingTitle = document.querySelector('.ranking-item .ranking-title');
    expect(firstRankingTitle?.textContent).toBe('星空银河');
    // 排行进度条基准为全量最大点赞数（星空银河 412 -> 100%）
    const firstFill = document.querySelector('.ranking-progress-fill') as HTMLElement;
    expect(firstFill.style.width).toBe('100%');
  });

  it('排序切换：热度/日期切换后画廊重排，排行保持热度口径', () => {
    render(<App />);
    const firstCardTitle = () =>
      document.querySelector('.photo-card .photo-title')?.textContent;

    expect(firstCardTitle()).toBe('星空银河'); // 默认按热度

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'date' } });
    expect(firstCardTitle()).toBe('湖泊秋色'); // 日期最新 2024-10-12

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'likes' } });
    expect(firstCardTitle()).toBe('星空银河');

    // 排行始终按热度，与排序切换无关
    expect(
      document.querySelector('.ranking-item .ranking-title')?.textContent,
    ).toBe('星空银河');
  });

  it('空结果：搜索无匹配时画廊显示空态，排行不受影响', () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('搜索作品...'), {
      target: { value: '完全不存在的关键词xyz' },
    });
    advance(200);

    expect(screen.getByText('没有找到匹配的作品')).toBeInTheDocument();
    expect(document.querySelectorAll('.photo-card')).toHaveLength(0);
    expect(document.querySelectorAll('.ranking-item')).toHaveLength(5);
  });

  it('连续快速点赞只累加一次，各视图仍保持一致', () => {
    render(<App />);
    const card = getCardByTitle('儿童写真'); // 278 赞，热度排行第 5
    const likeBtn = within(card).getByRole('button');

    fireEvent.click(likeBtn);
    fireEvent.click(likeBtn);
    fireEvent.click(likeBtn);

    expect(card.querySelector('.like-count-number')?.textContent).toBe('279');
    const rankingItem = getRankingItemByTitle('儿童写真');
    expect(rankingItem.querySelector('.ranking-likes')?.textContent).toBe('279');
  });
});
