import { render, screen, fireEvent } from '@testing-library/react';
import AnnotationPanel from '../components/AnnotationPanel';
import { Annotation, PageData, SearchResult } from '../types';

const annotation: Annotation = {
  id: 'a1',
  text: 'annotated phrase',
  highlightColor: '#fff3b0',
  note: 'a note about it',
  timestamp: 1700000000000,
  pageNum: 2,
};

const pages: PageData[] = [
  { pageNum: 1, content: 'page one', annotations: [] },
  { pageNum: 2, content: 'page two', annotations: [annotation] },
];

const setup = (propOverrides: Record<string, unknown> = {}) => {
  const props = {
    pages,
    currentPage: 1,
    selectedAnnotation: null as Annotation | null,
    setSelectedAnnotation: vi.fn(),
    updateAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
    searchResults: [] as SearchResult[],
    jumpToPage: vi.fn(),
    searchQuery: '',
    ...propOverrides,
  };
  const utils = render(<AnnotationPanel {...props} />);
  return { props, ...utils };
};

describe('AnnotationPanel - search tab', () => {
  it('switches to the search tab automatically when a query arrives', () => {
    const { rerender, props } = setup();
    expect(screen.getByText(/注解 \(1\)/)).toHaveStyle({ fontWeight: 600 });

    const searchResults: SearchResult[] = [
      { pageNum: 2, text: '...annotated phrase...', startIndex: 5 },
    ];
    rerender(
      <AnnotationPanel {...props} searchQuery="phrase" searchResults={searchResults} />
    );
    expect(screen.getByText('...annotated phrase...')).toBeInTheDocument();
  });

  it('shows a not-found message for a query with no results', () => {
    setup({ searchQuery: 'zzz', searchResults: [] });
    expect(screen.getByText('未找到匹配内容')).toBeInTheDocument();
  });

  it('jumps to the result page when a content result is clicked', () => {
    const results: SearchResult[] = [{ pageNum: 2, text: 'hit', startIndex: 3 }];
    const { props } = setup({ searchQuery: 'hit', searchResults: results });
    fireEvent.click(screen.getByText('hit'));
    expect(props.jumpToPage).toHaveBeenCalledWith(2);
    expect(props.setSelectedAnnotation).not.toHaveBeenCalled();
  });

  it('also selects the annotation when an annotation result is clicked', () => {
    const results: SearchResult[] = [
      { pageNum: 2, text: 'annotated phrase', startIndex: 0, annotationId: 'a1' },
    ];
    const { props } = setup({ searchQuery: 'phrase', searchResults: results });
    fireEvent.click(screen.getByText('annotated phrase'));
    expect(props.jumpToPage).toHaveBeenCalledWith(2);
    expect(props.setSelectedAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1' })
    );
  });

  it('recovers to the annotations tab when the query is cleared and tab clicked', () => {
    const { props, rerender } = setup({ searchQuery: 'phrase' });
    rerender(<AnnotationPanel {...props} searchQuery="" />);
    fireEvent.click(screen.getByText(/注解 \(1\)/));
    expect(screen.getByText('annotated phrase')).toBeInTheDocument();
  });
});
