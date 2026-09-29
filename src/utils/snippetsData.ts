export type LanguageType = 'javascript' | 'typescript' | 'python' | 'html' | 'css' | 'java' | 'go';
export type ThemeType = 'monokai' | 'dracula' | 'oneDark';

export interface Snippet {
  id: string;
  title: string;
  code: string;
  language: LanguageType;
  theme: ThemeType;
  timestamp: number;
  isFavorite: boolean;
}

const LANGUAGE_LABELS: Record<LanguageType, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  html: 'HTML',
  css: 'CSS',
  java: 'Java',
  go: 'Go',
};

const LANGUAGE_COLORS: Record<LanguageType, string> = {
  javascript: '#f7df1e',
  typescript: '#3178c6',
  python: '#3776ab',
  html: '#e34f26',
  css: '#a855f7',
  java: '#ed8b00',
  go: '#00add8',
};

const INITIAL_SNIPPETS: Snippet[] = [
  {
    id: 'snippet-1',
    title: 'JavaScript 防抖函数',
    code: `function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

const debouncedSearch = debounce((query) => {
  console.log('Searching:', query);
}, 300);`,
    language: 'javascript',
    theme: 'dracula',
    timestamp: Date.now() - 3600000 * 5,
    isFavorite: true,
  },
  {
    id: 'snippet-2',
    title: 'Python 快速排序',
    code: `def quicksort(arr):
    if len(arr) <= 1:
        return arr
    pivot = arr[len(arr) // 2]
    left = [x for x in arr if x < pivot]
    middle = [x for x in arr if x == pivot]
    right = [x for x in arr if x > pivot]
    return quicksort(left) + middle + quicksort(right)

numbers = [3, 6, 8, 10, 1, 2, 1]
print(quicksort(numbers))`,
    language: 'python',
    theme: 'monokai',
    timestamp: Date.now() - 3600000 * 4,
    isFavorite: false,
  },
  {
    id: 'snippet-3',
    title: 'TypeScript 泛型工具',
    code: `interface User {
  id: number;
  name: string;
  email: string;
}

type PartialUser = Partial<User>;
type ReadonlyUser = Readonly<User>;
type UserWithoutEmail = Omit<User, 'email'>;

function createUser(data: Partial<User): User {
  return {
    id: Date.now(),
    name: data.name ?? 'Anonymous',
    email: data.email ?? 'unknown@example.com',
  };
}`,
    language: 'typescript',
    theme: 'oneDark',
    timestamp: Date.now() - 3600000 * 3,
    isFavorite: true,
  },
  {
    id: 'snippet-4',
    title: 'HTML 响应式布局',
    code: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>响应式卡片布局</title>
</head>
<body>
  <div class="card-grid">
    <div class="card">卡片 1</div>
    <div class="card">卡片 2</div>
    <div class="card">卡片 3</div>
  </div>
</body>
</html>`,
    language: 'html',
    theme: 'dracula',
    timestamp: Date.now() - 3600000 * 2,
    isFavorite: false,
  },
  {
    id: 'snippet-5',
    title: 'CSS Flexbox 居中',
    code: `.flex-container {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.centered-box {
  padding: 2rem 3rem;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}`,
    language: 'css',
    theme: 'monokai',
    timestamp: Date.now() - 3600000,
    isFavorite: false,
  },
];

const SNIPPETS_STORAGE_KEY = 'code-snippets-data';
const FAVORITES_STORAGE_KEY = 'code-snippets-favorites';

export function getLanguageLabel(lang: LanguageType): string {
  return LANGUAGE_LABELS[lang];
}

export function getLanguageColor(lang: LanguageType): string {
  return LANGUAGE_COLORS[lang];
}

export function loadSnippets(): Snippet[] {
  try {
    const stored = localStorage.getItem(SNIPPETS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Snippet[];
      const favoriteIds = loadFavoriteIds();
      return parsed.map((s) => ({
        ...s,
        isFavorite: favoriteIds.includes(s.id),
      }));
    }
  } catch {
    // ignore
  }
  const favoriteIds = loadFavoriteIds();
  return INITIAL_SNIPPETS.map((s) => ({
    ...s,
    isFavorite: favoriteIds.includes(s.id),
  }));
}

export function saveSnippets(snippets: Snippet[]): void {
  try {
    localStorage.setItem(SNIPPETS_STORAGE_KEY, JSON.stringify(snippets));
  } catch {
    // ignore
  }
}

export function loadFavoriteIds(): string[] {
  try {
    const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as string[];
    }
  } catch {
    // ignore
  }
  return INITIAL_SNIPPETS.filter((s) => s.isFavorite).map((s) => s.id);
}

export function saveFavoriteIds(ids: string[]): void {
  try {
    localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

export function generateId(): string {
  return `snippet-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}
