import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from '../App';

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}));

const makeTxtFile = (lineCount: number, name = 'book.txt') => {
  const lines = Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`);
  return new File([lines.join('\n')], name, { type: 'text/plain' });
};

const uploadFile = async (container: HTMLElement, file: File) => {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText('📤 导出注解')).toBeEnabled());
};

const mockSelection = (text: string) => {
  const sel = {
    toString: () => text,
    getRangeAt: () => ({
      getBoundingClientRect: () => ({ left: 10, top: 10, width: 30, height: 12 }),
    }),
    removeAllRanges: vi.fn(),
  };
  (window as any).getSelection = vi.fn().mockReturnValue(sel);
};

const highlightCurrentSelection = async () => {
  const highlightBtn = screen.getByText('🖍️ 高亮');
  const toolbar = highlightBtn.parentElement as HTMLElement;
  // mouseUp anywhere inside the page container triggers selection capture
  fireEvent.mouseUp(toolbar.parentElement as HTMLElement);
  await waitFor(() => expect(toolbar).toHaveStyle('display: flex'));
  fireEvent.click(highlightBtn);
};

describe('App - text file workflow', () => {
  it('starts empty with export disabled, and paginates an uploaded txt file', async () => {
    const { container } = render(<App />);
    expect(screen.getByText('请上传 PDF 或 TXT 文件开始阅读')).toBeInTheDocument();
    expect(screen.getByText('📤 导出注解')).toBeDisabled();

    await uploadFile(container, makeTxtFile(85)); // 40 lines per page -> 3 pages

    expect(screen.getByText('📤 导出注解')).toBeEnabled();
    expect(screen.getByText('1')).toBeInTheDocument(); // current page indicator
    expect(screen.getByText('line 1', { exact: false })).toBeInTheDocument();

    // navigate forward and back across the page boundary
    fireEvent.click(screen.getByText('下一页 ▶'));
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('line 41', { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByText('◀ 上一页'));
    expect(screen.getByText('line 1', { exact: false })).toBeInTheDocument();
  });

  it('creates a highlight from a text selection and shows it in the panel', async () => {
    const { container } = render(<App />);
    await uploadFile(container, makeTxtFile(10));

    mockSelection('line 5');
    await highlightCurrentSelection();

    await waitFor(() =>
      expect(screen.getByText(/注解 \(1\)/)).toBeInTheDocument()
    );
    // the annotation card and the note editor both reflect the new annotation
    expect(screen.getByText('📌 选中文本:')).toBeInTheDocument();
  });

  it('keeps duplicate highlights as separate annotations', async () => {
    const { container } = render(<App />);
    await uploadFile(container, makeTxtFile(10));

    mockSelection('line 5');
    await highlightCurrentSelection();
    await highlightCurrentSelection();

    await waitFor(() =>
      expect(screen.getByText(/注解 \(2\)/)).toBeInTheDocument()
    );
  });

  it('deletes the selected annotation and returns to the empty state', async () => {
    const { container } = render(<App />);
    await uploadFile(container, makeTxtFile(10));

    mockSelection('line 5');
    await highlightCurrentSelection();
    await waitFor(() => expect(screen.getByText(/注解 \(1\)/)).toBeInTheDocument());

    fireEvent.click(screen.getByText('🗑️ 删除'));
    await waitFor(() => expect(screen.getByText(/暂无注解/)).toBeInTheDocument());
    expect(screen.queryByText('📌 选中文本:')).not.toBeInTheDocument();
  });

  it('adopts pages pushed by the PDF viewer through the pdfPagesLoaded event', async () => {
    render(<App />);
    const pages = [
      { pageNum: 1, content: 'pdf page one', annotations: [] },
      { pageNum: 2, content: 'pdf page two', annotations: [] },
    ];
    act(() => {
      window.dispatchEvent(new CustomEvent('pdfPagesLoaded', { detail: pages }));
    });
    expect(screen.getByText('pdf page one')).toBeInTheDocument();
    fireEvent.click(screen.getByText('下一页 ▶'));
    expect(screen.getByText('pdf page two')).toBeInTheDocument();
  });
});
