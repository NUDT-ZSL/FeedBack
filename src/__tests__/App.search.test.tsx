import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}));

const uploadBook = async (container: HTMLElement) => {
  const lines = Array.from({ length: 50 }, (_, i) => `chapter line ${i + 1}`);
  const file = new File([lines.join('\n')], 'book.txt', { type: 'text/plain' });
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText('下一页 ▶')).toBeEnabled());
};

const searchFor = async (query: string) => {
  const input = screen.getByPlaceholderText('🔍 搜索内容...');
  await userEvent.clear(input);
  if (query) await userEvent.type(input, query);
};

describe('App - search workflow', () => {
  it('finds matches across pages after the debounce and reports counts', async () => {
    const { container } = render(<App />);
    await uploadBook(container);

    await searchFor('line 3');
    // "line 3" matches line 3 and line 30-39, spread over pages 1 and 2
    await waitFor(
      () => expect(screen.getByText(/搜索结果 \([1-9]/)).toBeInTheDocument(),
      { timeout: 2000 }
    );
    // the panel auto-switched to the search tab and lists page hits
    expect(screen.getAllByText(/第 \d+ 页/).length).toBeGreaterThan(0);
  });

  it('shows a not-found state, then recovers when the query is fixed', async () => {
    const { container } = render(<App />);
    await uploadBook(container);

    await searchFor('zzz-no-such-text');
    await waitFor(
      () => expect(screen.getByText('未找到匹配内容')).toBeInTheDocument(),
      { timeout: 2000 }
    );

    await searchFor('chapter');
    await waitFor(
      () => expect(screen.getByText(/搜索结果 \([1-9]/)).toBeInTheDocument(),
      { timeout: 2000 }
    );
    expect(screen.queryByText('未找到匹配内容')).not.toBeInTheDocument();
  });

  it('clears results when the query is emptied', async () => {
    const { container } = render(<App />);
    await uploadBook(container);

    await searchFor('chapter');
    await waitFor(
      () => expect(screen.getByText(/搜索结果 \([1-9]/)).toBeInTheDocument(),
      { timeout: 2000 }
    );

    await searchFor('');
    await waitFor(() =>
      expect(screen.getByText(/搜索结果 \(0\)/)).toBeInTheDocument()
    );
  });

  it('jumps to the page of a clicked search result', async () => {
    const { container } = render(<App />);
    await uploadBook(container);

    // "line 45" only exists on page 2
    await searchFor('line 45');
    await waitFor(
      () => expect(screen.getByText(/搜索结果 \([1-9]/)).toBeInTheDocument(),
      { timeout: 2000 }
    );

    const result = screen.getByText(/line 45/, { selector: 'div' });
    fireEvent.click(result);
    // the reader jumped to page 2: previous-page button becomes enabled
    expect(screen.getByText('◀ 上一页')).toBeEnabled();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});
