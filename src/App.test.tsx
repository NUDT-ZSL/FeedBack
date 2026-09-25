import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, afterEach } from 'vitest';
import App from './App';

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}));

const realGetSelection = window.getSelection;

afterEach(() => {
  window.getSelection = realGetSelection;
});

function mockSelection(text: string) {
  window.getSelection = vi.fn().mockReturnValue({
    toString: () => text,
    getRangeAt: () => ({
      getBoundingClientRect: () => ({ left: 10, top: 10, width: 40, height: 12 }),
    }),
    removeAllRanges: vi.fn(),
  }) as unknown as typeof window.getSelection;
}

function makeTxtFile(lines: number) {
  const content = Array.from(
    { length: lines },
    (_, i) => `line ${i + 1} hello world`
  ).join('\n');
  return new File([content], 'book.txt', { type: 'text/plain' });
}

async function uploadTxt(container: HTMLElement, lines = 45) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [makeTxtFile(lines)] } });
  // 45 lines -> 2 pages (40 lines per page)
  await screen.findByText('◀ 上一页');
}

describe('App integration', () => {
  test('initial state: upload prompt shown, export disabled', () => {
    render(<App />);
    expect(screen.getByText('请上传 PDF 或 TXT 文件开始阅读')).toBeInTheDocument();
    expect(screen.getByText('📤 导出注解')).toBeDisabled();
  });

  test('txt upload splits content into 40-line pages', async () => {
    const { container } = render(<App />);
    await uploadTxt(container, 45);

    expect(screen.getByText('📌 注解 (0)')).toBeInTheDocument();
    // page 1 content visible, page 2 reachable via navigation
    expect(screen.getByText(/line 1 hello world/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('下一页 ▶'));
    expect(screen.getByText(/line 41 hello world/)).toBeInTheDocument();
    expect(screen.getByText('下一页 ▶')).toBeDisabled();
  });

  test('search is debounced, switches panel tab, and result click jumps page', async () => {
    const { container } = render(<App />);
    await uploadTxt(container, 45);

    fireEvent.change(screen.getByPlaceholderText('🔍 搜索内容...'), {
      target: { value: 'hello' },
    });
    // 45 lines x 1 occurrence each
    await screen.findByText('🔍 搜索结果 (45)', undefined, { timeout: 2000 });

    // panel auto-switched to search tab: results are listed
    const page2Hits = await screen.findAllByText('第 2 页');
    fireEvent.click(page2Hits[0]);
    // jumped to page 2: previous button becomes enabled
    expect(screen.getByText('◀ 上一页')).toBeEnabled();
    expect(screen.getByText(/line 41 hello world/)).toBeInTheDocument();
  });

  test('full annotation lifecycle: highlight -> edit note -> delete', async () => {
    const { container } = render(<App />);
    await uploadTxt(container, 45);

    // select text in the reader and highlight it
    mockSelection('hello world');
    fireEvent.mouseUp(screen.getByText(/line 1 hello world/));
    const highlightBtn = await screen.findByText('🖍️ 高亮');
    await waitFor(() =>
      expect(highlightBtn.closest('div')).toHaveStyle('display: flex')
    );
    fireEvent.click(highlightBtn);

    // App state -> panel boundary: annotation listed, editor opened
    await screen.findByText('📌 注解 (1)');
    expect(screen.getByText('✏️ 编辑笔记')).toBeInTheDocument();

    // edit the note through the panel editor
    const editor = container.querySelector('[data-placeholder]') as HTMLElement;
    editor.innerHTML = '重点笔记';
    fireEvent.input(editor);
    // editor content + annotation card preview both reflect the new note
    await waitFor(() =>
      expect(screen.getAllByText('重点笔记').length).toBeGreaterThanOrEqual(2)
    );

    // repeat operation: a second highlight yields a second annotation
    fireEvent.mouseUp(screen.getByText(/line 2 hello world/));
    await waitFor(() =>
      expect(screen.getByText('🖍️ 高亮').closest('div')).toHaveStyle('display: flex')
    );
    fireEvent.click(screen.getByText('🖍️ 高亮'));
    await screen.findByText('📌 注解 (2)');

    // delete the selected annotation -> editor closes, count drops
    fireEvent.click(screen.getByText('🗑️ 删除'));
    await screen.findByText('📌 注解 (1)');
    expect(screen.queryByText('✏️ 编辑笔记')).not.toBeInTheDocument();
  });

  test('export produces JSON snapshot of pages and annotations', async () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const createdBlobs: Blob[] = [];
    (URL as any).createObjectURL = vi.fn((blob: Blob) => {
      createdBlobs.push(blob);
      return 'blob:mock';
    });
    (URL as any).revokeObjectURL = vi.fn();

    const { container } = render(<App />);
    await uploadTxt(container, 45);

    mockSelection('hello world');
    fireEvent.mouseUp(screen.getByText(/line 1 hello world/));
    await waitFor(() =>
      expect(screen.getByText('🖍️ 高亮').closest('div')).toHaveStyle('display: flex')
    );
    fireEvent.click(screen.getByText('🖍️ 高亮'));
    await screen.findByText('📌 注解 (1)');

    fireEvent.click(screen.getByText('📤 导出注解'));
    expect(clickSpy).toHaveBeenCalled();
    expect(createdBlobs).toHaveLength(1);

    const exportedText = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsText(createdBlobs[0]);
    });
    const exported = JSON.parse(exportedText);
    expect(exported.pages).toHaveLength(2);
    const allAnnotations = exported.pages.flatMap((p: any) => p.annotations);
    expect(allAnnotations).toHaveLength(1);
    expect(allAnnotations[0]).toEqual({
      text: 'hello world',
      highlightColor: '#fff3b0',
      note: '',
    });
    clickSpy.mockRestore();
  });
});
