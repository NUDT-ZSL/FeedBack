import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, test, expect, vi } from 'vitest';
import AnnotationPanel from './AnnotationPanel';
import { Annotation, PageData, SearchResult } from '../types';

const makeAnn = (id: string, pageNum: number, text: string, note = ''): Annotation => ({
  id,
  pageNum,
  text,
  note,
  highlightColor: '#fff3b0',
  timestamp: 1700000000000,
});

function setup(overrides: Partial<Parameters<typeof AnnotationPanel>[0]> = {}) {
  const props = {
    pages: [] as PageData[],
    currentPage: 1,
    selectedAnnotation: null,
    setSelectedAnnotation: vi.fn(),
    updateAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
    searchResults: [] as SearchResult[],
    jumpToPage: vi.fn(),
    searchQuery: '',
    ...overrides,
  };
  const utils = render(<AnnotationPanel {...props} />);
  return { props, ...utils };
}

describe('AnnotationPanel', () => {
  test('aggregates annotations across pages (module boundary: pages -> panel)', () => {
    const pages: PageData[] = [
      { pageNum: 1, content: '', annotations: [makeAnn('a1', 1, '第一段')] },
      { pageNum: 2, content: '', annotations: [makeAnn('a2', 2, '第二段', '页2笔记')] },
    ];
    setup({ pages });

    expect(screen.getByText('📌 注解 (2)')).toBeInTheDocument();
    expect(screen.getByText('第一段')).toBeInTheDocument();
    expect(screen.getByText('第二段')).toBeInTheDocument();
    expect(screen.getByText('第 1 页')).toBeInTheDocument();
    expect(screen.getByText('第 2 页')).toBeInTheDocument();
    // note preview rendered for the annotated entry
    expect(screen.getByText('页2笔记')).toBeInTheDocument();
  });

  test('shows empty state when there are no annotations', () => {
    setup({ pages: [{ pageNum: 1, content: '', annotations: [] }] });
    expect(screen.getByText('📌 注解 (0)')).toBeInTheDocument();
    expect(screen.getByText(/暂无注解/)).toBeInTheDocument();
  });

  test('clicking a card selects it and jumps page only when page differs', () => {
    const ann1 = makeAnn('a1', 1, '当前页注解');
    const ann2 = makeAnn('a2', 3, '其他页注解');
    const pages: PageData[] = [
      { pageNum: 1, content: '', annotations: [ann1] },
      { pageNum: 3, content: '', annotations: [ann2] },
    ];
    const { props } = setup({ pages, currentPage: 1 });

    fireEvent.click(screen.getByText('当前页注解'));
    expect(props.setSelectedAnnotation).toHaveBeenCalledWith(ann1);
    expect(props.jumpToPage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('其他页注解'));
    expect(props.setSelectedAnnotation).toHaveBeenCalledWith(ann2);
    expect(props.jumpToPage).toHaveBeenCalledWith(3);
  });

  test('selected annotation opens note editor; delete flows through callback', () => {
    const ann = makeAnn('a1', 2, '被选中文本');
    const pages: PageData[] = [{ pageNum: 2, content: '', annotations: [ann] }];
    const { props } = setup({ pages, currentPage: 2, selectedAnnotation: ann });

    expect(screen.getByText('✏️ 编辑笔记')).toBeInTheDocument();
    fireEvent.click(screen.getByText('🗑️ 删除'));
    expect(props.deleteAnnotation).toHaveBeenCalledWith('a1', 2);
  });

  test('typing in the note editor pushes innerHTML through updateAnnotation', () => {
    const ann = makeAnn('a1', 1, '文本');
    const pages: PageData[] = [{ pageNum: 1, content: '', annotations: [ann] }];
    const { props, container } = setup({ pages, selectedAnnotation: ann });

    const editor = container.querySelector('[data-placeholder]') as HTMLElement;
    editor.innerHTML = '我的<b>笔记</b>';
    fireEvent.input(editor);
    expect(props.updateAnnotation).toHaveBeenCalledWith('a1', {
      note: '我的<b>笔记</b>',
    });
  });

  test('auto-switches to search tab when a query arrives', () => {
    const results: SearchResult[] = [
      { pageNum: 2, text: '命中上下文', startIndex: 3 },
    ];
    const { rerender, props } = setup({ searchResults: results, searchQuery: '' });
    expect(screen.getByText('🔍 搜索结果 (1)')).toBeInTheDocument();

    rerender(
      <AnnotationPanel {...props} searchQuery="命中" searchResults={results} />
    );
    // search tab became active: result body is visible
    expect(screen.getByText('命中上下文')).toBeInTheDocument();
    expect(screen.getByText('第 2 页')).toBeInTheDocument();
  });

  test('search result click jumps page and selects linked annotation only when present', () => {
    const ann = makeAnn('a9', 4, '注解文本');
    const pages: PageData[] = [{ pageNum: 4, content: '', annotations: [ann] }];
    const results: SearchResult[] = [
      { pageNum: 4, text: '普通命中', startIndex: 0 },
      { pageNum: 4, text: '注解命中', startIndex: 0, annotationId: 'a9' },
    ];
    const { props } = setup({ pages, searchResults: results, searchQuery: '命中' });

    fireEvent.click(screen.getByText('普通命中'));
    expect(props.jumpToPage).toHaveBeenCalledWith(4);
    expect(props.setSelectedAnnotation).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('注解命中'));
    expect(props.setSelectedAnnotation).toHaveBeenCalledWith(ann);
  });

  test('shows "no match" hint when query has no results', () => {
    setup({ searchQuery: '不存在', searchResults: [] });
    // switch to the search tab manually
    fireEvent.click(screen.getByText('🔍 搜索结果 (0)'));
    expect(screen.getByText('未找到匹配内容')).toBeInTheDocument();
  });
});
