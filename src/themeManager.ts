export interface ThemeColors {
  background: string;
  foreground: string;
  primary: string;
  comment: string;
  keyword: string;
  string: string;
  number: string;
  function: string;
  variable: string;
  operator: string;
  punctuation: string;
  className: string;
  property: string;
}

export interface Theme {
  name: string;
  displayName: string;
  colors: ThemeColors;
  fontFamily: string;
  previewColors: {
    primary: string;
    background: string;
  };
}

const themes: Theme[] = [
  {
    name: 'monokai',
    displayName: 'Monokai',
    colors: {
      background: '#272822',
      foreground: '#f8f8f2',
      primary: '#f92672',
      comment: '#75715e',
      keyword: '#f92672',
      string: '#e6db74',
      number: '#ae81ff',
      function: '#a6e22e',
      variable: '#f8f8f2',
      operator: '#f92672',
      punctuation: '#f8f8f2',
      className: '#a6e22e',
      property: '#66d9ef',
    },
    fontFamily: "'Fira Code', 'JetBrains Mono', 'Source Code Pro', monospace",
    previewColors: {
      primary: '#f92672',
      background: '#272822',
    },
  },
  {
    name: 'solarized-light',
    displayName: 'Solarized Light',
    colors: {
      background: '#fdf6e3',
      foreground: '#657b83',
      primary: '#268bd2',
      comment: '#93a1a1',
      keyword: '#859900',
      string: '#2aa198',
      number: '#d33682',
      function: '#268bd2',
      variable: '#657b83',
      operator: '#859900',
      punctuation: '#657b83',
      className: '#b58900',
      property: '#268bd2',
    },
    fontFamily: "'Source Code Pro', 'JetBrains Mono', 'Fira Code', monospace",
    previewColors: {
      primary: '#268bd2',
      background: '#fdf6e3',
    },
  },
  {
    name: 'dracula',
    displayName: 'Dracula',
    colors: {
      background: '#282a36',
      foreground: '#f8f8f2',
      primary: '#bd93f9',
      comment: '#6272a4',
      keyword: '#ff79c6',
      string: '#f1fa8c',
      number: '#bd93f9',
      function: '#50fa7b',
      variable: '#f8f8f2',
      operator: '#ff79c6',
      punctuation: '#f8f8f2',
      className: '#8be9fd',
      property: '#ffb86c',
    },
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Source Code Pro', monospace",
    previewColors: {
      primary: '#bd93f9',
      background: '#282a36',
    },
  },
  {
    name: 'nord',
    displayName: 'Nord',
    colors: {
      background: '#2e3440',
      foreground: '#d8dee9',
      primary: '#88c0d0',
      comment: '#616e88',
      keyword: '#81a1c1',
      string: '#a3be8c',
      number: '#b48ead',
      function: '#88c0d0',
      variable: '#d8dee9',
      operator: '#81a1c1',
      punctuation: '#d8dee9',
      className: '#8fbcbb',
      property: '#ebcb8b',
    },
    fontFamily: "'Fira Code', 'JetBrains Mono', 'Source Code Pro', monospace",
    previewColors: {
      primary: '#88c0d0',
      background: '#2e3440',
    },
  },
  {
    name: 'one-dark',
    displayName: 'One Dark',
    colors: {
      background: '#282c34',
      foreground: '#abb2bf',
      primary: '#61afef',
      comment: '#5c6370',
      keyword: '#c678dd',
      string: '#98c379',
      number: '#d19a66',
      function: '#61afef',
      variable: '#e06c75',
      operator: '#56b6c2',
      punctuation: '#abb2bf',
      className: '#e5c07b',
      property: '#e06c75',
    },
    fontFamily: "'Fira Code', 'JetBrains Mono', 'Source Code Pro', monospace",
    previewColors: {
      primary: '#61afef',
      background: '#282c34',
    },
  },
  {
    name: 'github-light',
    displayName: 'GitHub Light',
    colors: {
      background: '#ffffff',
      foreground: '#24292e',
      primary: '#0366d6',
      comment: '#6a737d',
      keyword: '#d73a49',
      string: '#032f62',
      number: '#005cc5',
      function: '#6f42c1',
      variable: '#24292e',
      operator: '#d73a49',
      punctuation: '#24292e',
      className: '#e36209',
      property: '#005cc5',
    },
    fontFamily: "'Source Code Pro', 'JetBrains Mono', 'Fira Code', monospace",
    previewColors: {
      primary: '#0366d6',
      background: '#ffffff',
    },
  },
  {
    name: 'tokyo-night',
    displayName: 'Tokyo Night',
    colors: {
      background: '#1a1b26',
      foreground: '#a9b1d6',
      primary: '#7aa2f7',
      comment: '#565f89',
      keyword: '#bb9af7',
      string: '#9ece6a',
      number: '#ff9e64',
      function: '#7aa2f7',
      variable: '#c0caf5',
      operator: '#89ddff',
      punctuation: '#a9b1d6',
      className: '#0db9d7',
      property: '#f7768e',
    },
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Source Code Pro', monospace",
    previewColors: {
      primary: '#7aa2f7',
      background: '#1a1b26',
    },
  },
];

const STORAGE_KEY = 'codeTheme';
const DEFAULT_THEME = 'github-light';

let currentThemeName: string = DEFAULT_THEME;

export function getThemes(): Theme[] {
  return themes;
}

export function getTheme(name?: string): Theme {
  const themeName = name || currentThemeName;
  return themes.find((t) => t.name === themeName) || themes[0];
}

export function setTheme(name: string): Theme {
  const theme = themes.find((t) => t.name === name);
  if (theme) {
    currentThemeName = name;
    saveThemeToStorage(name);
    applyThemeToDOM(theme);
  }
  return theme || getTheme();
}

export function getCurrentTheme(): Theme {
  return getTheme(currentThemeName);
}

export function initTheme(): Theme {
  const savedTheme = loadThemeFromStorage();
  if (savedTheme && themes.find((t) => t.name === savedTheme)) {
    currentThemeName = savedTheme;
  }
  const theme = getCurrentTheme();
  applyThemeToDOM(theme);
  return theme;
}

function applyThemeToDOM(theme: Theme): void {
  const root = document.documentElement;
  root.style.setProperty('--theme-bg', theme.colors.background);
  root.style.setProperty('--theme-fg', theme.colors.foreground);
  root.style.setProperty('--theme-primary', theme.colors.primary);
  root.style.setProperty('--theme-comment', theme.colors.comment);
  root.style.setProperty('--theme-keyword', theme.colors.keyword);
  root.style.setProperty('--theme-string', theme.colors.string);
  root.style.setProperty('--theme-number', theme.colors.number);
  root.style.setProperty('--theme-function', theme.colors.function);
  root.style.setProperty('--theme-variable', theme.colors.variable);
  root.style.setProperty('--theme-operator', theme.colors.operator);
  root.style.setProperty('--theme-punctuation', theme.colors.punctuation);
  root.style.setProperty('--theme-class', theme.colors.className);
  root.style.setProperty('--theme-property', theme.colors.property);
  root.style.setProperty('--theme-font-family', theme.fontFamily);
  root.classList.remove(...themes.map((t) => `theme-${t.name}`));
  root.classList.add(`theme-${theme.name}`);
}

function saveThemeToStorage(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // ignore storage errors
  }
}

function loadThemeFromStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
