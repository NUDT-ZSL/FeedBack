export type Language = 'html' | 'css' | 'javascript' | 'python' | 'auto';

const languagePatterns: Record<Exclude<Language, 'auto'>, { keywords: string[]; patterns: RegExp[] }> = {
  html: {
    keywords: ['<!DOCTYPE', '<html', '<head', '<body', '<div', '<span', '<p>', '<a ', '<img', '<script', '<style', 'class=', 'id='],
    patterns: [/<[a-z][\s\S]*>/i, /<\/[a-z]+>/i, /<!DOCTYPE\s+html>/i],
  },
  css: {
    keywords: ['{', '}', ';', ':', '@media', '@import', '@keyframes', 'display:', 'color:', 'background', 'font-', 'margin:', 'padding:', 'border:'],
    patterns: [/\{[\s\S]*\}/, /@media\s*\(/, /#[0-9a-fA-F]{3,6}/, /:\s*[0-9]+(px|em|rem|%)/],
  },
  javascript: {
    keywords: ['const ', 'let ', 'var ', 'function ', '=>', 'import ', 'export ', 'return ', 'if ', 'else ', 'for ', 'while ', 'class ', 'new ', 'async ', 'await '],
    patterns: [/\b(function|const|let|var)\s+\w+/, /=>\s*[{(]/, /\.(log|warn|error|push|pop|map|filter|reduce)\(/, /import\s+.*from/],
  },
  python: {
    keywords: ['def ', 'class ', 'import ', 'from ', 'if ', 'elif ', 'else:', 'for ', 'while ', 'return ', 'print(', 'with ', 'try:', 'except:', 'lambda '],
    patterns: [/def\s+\w+\s*\(/, /:\s*$/, /\b(self|__init__|__name__)\b/, /print\s*\(/, /\b(if|elif|else|for|while|def|class)\s+.+:/],
  },
};

export function detectLanguage(code: string): Exclude<Language, 'auto'> {
  if (!code || code.trim().length === 0) {
    return 'javascript';
  }

  const trimmedCode = code.trim();
  const scores: Record<Exclude<Language, 'auto'>, number> = {
    html: 0,
    css: 0,
    javascript: 0,
    python: 0,
  };

  for (const lang of Object.keys(languagePatterns) as Exclude<Language, 'auto'>[]) {
    const { keywords, patterns } = languagePatterns[lang];
    
    for (const keyword of keywords) {
      if (trimmedCode.includes(keyword)) {
        scores[lang] += 2;
      }
    }
    
    for (const pattern of patterns) {
      if (pattern.test(trimmedCode)) {
        scores[lang] += 3;
      }
    }
  }

  let maxScore = 0;
  let detectedLang: Exclude<Language, 'auto'> = 'javascript';

  for (const lang of Object.keys(scores) as Exclude<Language, 'auto'>[]) {
    if (scores[lang] > maxScore) {
      maxScore = scores[lang];
      detectedLang = lang;
    }
  }

  if (maxScore === 0) {
    return 'javascript';
  }

  return detectedLang;
}

export function resolveLanguage(language: Language, code: string): Exclude<Language, 'auto'> {
  if (language === 'auto') {
    return detectLanguage(code);
  }
  return language;
}

export const languageOptions: { value: Language; label: string }[] = [
  { value: 'auto', label: '自动检测' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
];
