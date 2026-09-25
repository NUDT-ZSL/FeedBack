import { render, screen, fireEvent } from '@testing-library/react';
import AnnotationPanel from '../components/AnnotationPanel';
import { Annotation, PageData } from '../types';

const ann = (over: Partial<Annotation>): Annotation => ({
  id: 'a1',
  text: 'highlighted text',
  highlightColor: '#fff3b0',
  note: '',
  timestamp: 1700000000000,
  pageNum: 1,
  ...over,
});

const makePages = (): PageData[] => [
  { pageNum: 1, content: 'page one', annotations: [ann({})] },
  { pageNum: 2, content: 'page two', annotations: [ann({ id: 'a2', text: 'second page text', pageNum: 2 })] },
];

const setup = (propOverrides: Record<string, unknown> = {}) => {
  const props = {
    pages: makePages(),
    currentPage: 1,
    selectedAnnotation: null as Annotation | null,
    setSelectedAnnotation: vi.fn(),
    updateAnnotation: vi.fn(),
    deleteAnnotation: vi.fn(),
    searchResults: [],
    jumpToPage: vi.fn(),
    searchQuery: '',
    ...propOverrides,
  };
  const utils = render(<AnnotationPanel {...props} />);
  return { props, ...utils };
};

describe('AnnotationPanel - annotation list', () => {
  it('shows empty state when there are no annotations', () => {
    setup({ pages: [{ pageNum: 1, content: 'x', annotations: [] }] });
    expect(screen.getByText(/暂无注解/)).toBeInTheDocument();
    expect(screen.getByText(/注解 \(0\)/)).toBeInTheDocument();
  });

  it('aggregates annotations from all pages into one list', () => {
    setup();
    expect(screen.getByText(/注解 \(2\)/)).toBeInTheDocument();
    expect(screen.getByText('highlighted text')).toBeInTheDocument();
    expect(screen.getByText('second page text')).toBeInTheDocument();
  });

  it('selects an annotation without jumping when it is on the current page', () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('highlighted text'));
    expect(props.setSelectedAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1' })
    );
    expect(props.jumpToPage).not.toHaveBeenCalled();
  });

  it('jumps to the page when selecting an annotation from another page', () => {
    const { props } = setup();
    fireEvent.click(screen.getByText('second page text'));
    expect(props.jumpToPage).toHaveBeenCalledWith(2);
  });
});

describe('AnnotationPanel - note editing and deletion', () => {
  it('saves note edits through updateAnnotation', () => {
    const selected = ann({ note: 'old' });
    const { props, container } = setup({ selectedAnnotation: selected });
    const editor = container.querySelector('[contenteditable]') as HTMLElement;
    expect(editor).toBeTruthy();
    // the editor is seeded with the existing note
    expect(editor.innerHTML).toBe('old');

    editor.innerHTML = 'revised <b>note</b>';
    fireEvent.input(editor);
    expect(props.updateAnnotation).toHaveBeenCalledWith('a1', {
      note: 'revised <b>note</b>',
    });
  });

  it('applies rich-text formatting via execCommand and persists the result', () => {
    const execCommand = vi.fn();
    (document as any).execCommand = execCommand;
    const selected = ann({});
    const { props, container } = setup({ selectedAnnotation: selected });
    const editor = container.querySelector('[contenteditable]') as HTMLElement;
    editor.innerHTML = 'formatted';

    fireEvent.click(screen.getByText('B'));
    expect(execCommand).toHaveBeenCalledWith('bold', false);
    expect(props.updateAnnotation).toHaveBeenCalledWith('a1', { note: 'formatted' });
  });

  it('deletes the selected annotation with its id and page number', () => {
    const selected = ann({ id: 'a2', pageNum: 2 });
    const { props } = setup({ selectedAnnotation: selected });
    fireEvent.click(screen.getByText('🗑️ 删除'));
    expect(props.deleteAnnotation).toHaveBeenCalledWith('a2', 2);
  });
});
