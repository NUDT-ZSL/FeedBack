import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { PageData } from '../types';

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}));

import PDFViewer from './PDFViewer';

const basePages: PageData[] = [
  {
    pageNum: 1,
    content: 'alpha beta gamma beta',
    annotations: [
      {
        id: 'a1',
        pageNum: 1,
        text: 'beta',
        highlightColor: '#fff3b0',
        note: '',
        timestamp: 1700000000000,
      },
    ],
  },
  { pageNum: 2, content: 'second page content', annotations: [] },
];

function setup(overrides: Partial<Parameters<typeof PDFViewer>[0]> = {}) {
  const props = {
    fileType: 'text' as const,
    fileName: 'book.txt',
    pages: basePages,
    currentPage: 1,
    setCurrentPage: vi.fn(),
    zoom: 1,
    setZoom: vi.fn(),
    addAnnotation: vi.fn(),
    searchQuery: '',
    searchResults: [],
    ...overrides,
  };
  const utils = render(<PDFViewer {...props} />);
  return { props, ...utils };
}

function mockSelection(text: string) {
  const selection = {
    toString: () => text,
    getRangeAt: () => ({
      getBoundingClientRect: () => ({ left: 10, top: 10, width: 40, height: 12 }),
    }),
    removeAllRanges: vi.fn(),
  };
  window.getSelection = vi.fn().mockReturnValue(selection);
  return selection;
}

const toolbarOf = (label: string) => screen.getByText(label).closest('div')!;

describe('PDFViewer text rendering', () => {
  test('renders annotation highlight with background color', () => {
    const { container } = setup();
    const highlighted = container.querySelector('span[style*="background"]');
    expect(highlighted).not.toBeNull();
    expect(highlighted!.textContent).toBe('beta');
    expect((highlighted as HTMLElement).style.backgroundColor).toBe('rgb(255, 243, 176)');
  });

  test('search matches get the search-match class', () => {
    const { container } = setup({ searchQuery: 'gamma' });
    const match = container.querySelector('span.search-match');
    expect(match).not.toBeNull();
    expect(match!.textContent).toBe('gamma');
  });

  test('overlap of annotation and search merges into a "both" span', () => {
    const { container } = setup({ searchQuery: 'beta' });
    const both = container.querySelector('span.search-match[style*="background"]');
    expect(both).not.toBeNull();
    expect(both!.textContent).toBe('beta');
  });
});

describe('PDFViewer navigation and zoom', () => {
  test('page buttons respect boundaries and report target page', () => {
    const { props, rerender } = setup({ currentPage: 1 });
    const prev = screen.getByText('◀ 上一页') as HTMLButtonElement;
    const next = screen.getByText('下一页 ▶') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    fireEvent.click(next);
    expect(props.setCurrentPage).toHaveBeenCalledWith(2);

    rerender(<PDFViewer {...props} currentPage={2} />);
    expect((screen.getByText('下一页 ▶') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('◀ 上一页'));
    expect(props.setCurrentPage).toHaveBeenCalledWith(1);
  });

  test('zoom slider reports parsed value', () => {
    const { props, container } = setup();
    const slider = container.querySelector('input[type="range"]')!;
    fireEvent.change(slider, { target: { value: '1.5' } });
    expect(props.setZoom).toHaveBeenCalledWith(1.5);
  });
});

describe('PDFViewer selection toolbar', () => {
  const realGetSelection = window.getSelection;

  beforeEach(() => {
    mockSelection('beta');
  });

  afterEach(() => {
    window.getSelection = realGetSelection;
  });

  const selectText = async () => {
    const content = screen.getByText(/alpha/);
    fireEvent.mouseUp(content);
    await waitFor(() =>
      expect(toolbarOf('🖍️ 高亮')).toHaveStyle('display: flex')
    );
  };

  test('highlight action creates annotation and hides toolbar', async () => {
    const { props } = setup();
    await selectText();

    fireEvent.click(screen.getByText('🖍️ 高亮'));
    expect(props.addAnnotation).toHaveBeenCalledWith({
      text: 'beta',
      highlightColor: '#fff3b0',
      note: '',
      pageNum: 1,
    });
    await waitFor(() =>
      expect(toolbarOf('🖍️ 高亮')).toHaveStyle('display: none')
    );
  });

  test('note mode: save carries draft, cancel discards', async () => {
    const { props } = setup();
    await selectText();

    fireEvent.click(screen.getByText('📝 笔记'));
    const textarea = screen.getByPlaceholderText('输入笔记内容...');
    fireEvent.change(textarea, { target: { value: '这是一条笔记' } });
    fireEvent.click(screen.getByText('💾 保存'));

    expect(props.addAnnotation).toHaveBeenCalledWith({
      text: 'beta',
      highlightColor: '#fff3b0',
      note: '这是一条笔记',
      pageNum: 1,
    });

    // repeat operation: select again, then cancel
    await selectText();
    fireEvent.click(screen.getByText('📝 笔记'));
    fireEvent.click(screen.getByText('取消'));
    expect(props.addAnnotation).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(toolbarOf('🖍️ 高亮')).toHaveStyle('display: none')
    );
  });

  test('whitespace-only selection never opens the toolbar', async () => {
    mockSelection('   ');
    setup();
    fireEvent.mouseUp(screen.getByText(/alpha/));
    // give the internal 10ms timeout a chance to fire
    await new Promise((r) => setTimeout(r, 30));
    expect(toolbarOf('🖍️ 高亮')).toHaveStyle('display: none');
  });
});
