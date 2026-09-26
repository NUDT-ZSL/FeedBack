const KEYWORD_MAP = {
  '积分': '\\int', '∫': '\\int',
  '累加': '\\sum', '∑': '\\sum',
  '累乘': '\\prod', '∏': '\\prod',
  '极限': '\\lim',
  '根号': '\\sqrt', '√': '\\sqrt',
  '分数': 'FRAC',
  '导数': 'DERIV',
  '偏导': 'PDERIV',
  '矩阵': 'MATRIX',
  '从': 'FROM', '到': 'TO',
  '无穷': '\\infty', '∞': '\\infty',
  'pi': '\\pi', 'Pi': '\\pi', 'PI': '\\pi', 'π': '\\pi',
  'theta': '\\theta', 'Θ': '\\theta', 'θ': '\\theta',
  'alpha': '\\alpha', 'α': '\\alpha',
  'beta': '\\beta', 'β': '\\beta',
  'gamma': '\\gamma', 'γ': '\\gamma',
  'delta': '\\delta', 'δ': '\\delta',
  'lambda': '\\lambda', 'λ': '\\lambda',
  'mu': '\\mu', 'μ': '\\mu',
  'sigma': '\\sigma', 'σ': '\\sigma',
  'omega': '\\omega', 'Ω': '\\omega',
  'epsilon': '\\epsilon', 'ε': '\\epsilon',
  'nabla': '\\nabla', '∇': '\\nabla',
  'partial': '\\partial', '∂': '\\partial',
  '空集': '\\emptyset', '∅': '\\emptyset',
  '属于': '\\in', '∈': '\\in',
  '不属于': '\\notin', '∉': '\\notin',
  '子集': '\\subset', '⊂': '\\subset',
  '并集': '\\cup', '∪': '\\cup',
  '交集': '\\cap', '∩': '\\cap',
  '对所有': '\\forall', '∀': '\\forall',
  '存在': '\\exists', '∃': '\\exists',
  'dx': '\\, dx', 'dy': '\\, dy', 'dz': '\\, dz', 'dt': '\\, dt',
};

const FUNCTION_MAP = {
  'sin': '\\sin', 'cos': '\\cos', 'tan': '\\tan',
  'cot': '\\cot', 'sec': '\\sec', 'csc': '\\csc',
  'arcsin': '\\arcsin', 'arccos': '\\arccos', 'arctan': '\\arctan',
  'sinh': '\\sinh', 'cosh': '\\cosh', 'tanh': '\\tanh',
  'log': '\\log', 'ln': '\\ln', 'lg': '\\lg',
  'exp': '\\exp',
  'max': '\\max', 'min': '\\min',
  'sup': '\\sup', 'inf': '\\inf',
  'det': '\\det', 'dim': '\\dim', 'deg': '\\deg',
  'gcd': '\\gcd', 'hom': '\\hom', 'ker': '\\ker',
  'abs': 'ABS',
  'sqrt': 'SQRT',
  'frac': 'FRAC2',
};

const OPERATOR_MAP = {
  '>=': '\\geq', '≥': '\\geq',
  '<=': '\\leq', '≤': '\\leq',
  '!=': '\\neq', '≠': '\\neq',
  '<<': '\\ll', '>>': '\\gg',
  '+-': '\\pm', '±': '\\pm',
  '-+': '\\mp', '∓': '\\mp',
  '×': '\\times', '÷': '\\div', '·': '\\cdot',
  '=>': '\\Rightarrow', '⇒': '\\Rightarrow',
  '->': '\\to', '→': '\\to',
  '<-': '\\leftarrow', '←': '\\leftarrow',
  '<->': '\\leftrightarrow', '↔': '\\leftrightarrow',
  '~~': '\\sim',
  '≈': '\\approx', '~=': '\\approx',
  '≡': '\\equiv',
  '∝': '\\propto',
};

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function handleBracesSubSup(text) {
  text = text.replace(/([a-zA-Z0-9}\\])\^([a-zA-Z0-9]+)/g, '$1^{$2}');
  text = text.replace(/([a-zA-Z0-9}\\])_([a-zA-Z0-9]+)/g, '$1_{$2}');
  return text;
}

function handleSqrt(text) {
  text = text.replace(/SQRT\s*\(\s*([^()]+?)\s*\)/g, '\\sqrt{$1}');
  text = text.replace(/\\sqrt\s+(\S+)/g, '\\sqrt{$1}');
  text = text.replace(/n次根\s+(\d+)\s+(\S+)/g, '\\sqrt[$1]{$2}');
  return text;
}

function handleFrac(text) {
  text = text.replace(/FRAC\s+(\S+)\s+(\S+)/g, '\\frac{$1}{$2}');
  text = text.replace(/FRAC2\s*\(\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)/g, '\\frac{$1}{$2}');
  let safety = 0;
  while (text.match(/(^|[^a-zA-Z0-9}])(\d+(?:\.\d+)?|[a-zA-Z])\s*\/\s*(\d+(?:\.\d+)?|[a-zA-Z])(?!})/) && safety < 50) {
    text = text.replace(/(^|[^a-zA-Z0-9}])(\d+(?:\.\d+)?|[a-zA-Z])\s*\/\s*(\d+(?:\.\d+)?|[a-zA-Z])(?!})/, '$1\\frac{$2}{$3}');
    safety++;
  }
  safety = 0;
  while (text.match(/\(([^()]+)\)\s*\/\s*\(([^()]+)\)/) && safety < 50) {
    text = text.replace(/\(([^()]+)\)\s*\/\s*\(([^()]+)\)/, '\\frac{$1}{$2}');
    safety++;
  }
  text = text.replace(/DERIV\s+(\S+)\s+(\S+)/g, '\\frac{d$1}{d$2}');
  text = text.replace(/d\/d([a-zA-Z])/g, '\\frac{d}{d$1}');
  text = text.replace(/PDERIV\s+(\S+)\s+(\S+)/g, '\\frac{\\partial $1}{\\partial $2}');
  text = text.replace(/∂\/∂([a-zA-Z])/g, '\\frac{\\partial}{\\partial $1}');
  return text;
}

function handleIntSumLim(text) {
  text = text.replace(/\\int\s+(.+?)\s+FROM\s+(\S+)\s+TO\s+(\S+)/g, '\\int_{$2}^{$3} $1');
  text = text.replace(/\\sum\s+(\S+)\s+FROM\s+(\S+)\s+TO\s+(\S+)\s+(.+)/g, '\\sum_{$1=$2}^{$3} $4');
  text = text.replace(/\\prod\s+(\S+)\s+FROM\s+(\S+)\s+TO\s+(\S+)\s+(.+)/g, '\\prod_{$1=$2}^{$3} $4');
  text = text.replace(/\\lim\s+(.+?)\s+(\S+)\s+TO\s+(\S+)/g, '\\lim_{$2 \\to $3} $1');
  text = text.replace(/_{([^}]+)\\to([^}]+)}/g, '_{$1 \\to $2}');
  return text;
}

function handleMatrix(text) {
  const matrixMatch = text.match(/MATRIX\s*\[\[([\s\S]+?)\]\]/);
  if (matrixMatch) {
    let inner = matrixMatch[1].trim();
    const rows = inner.split(/\]\s*,\s*\[/);
    const latexRows = rows.map(row => {
      const elems = row.split(',').map(e => e.trim()).filter(e => e.length > 0);
      return elems.join(' & ');
    });
    const matrixLatex = '\\begin{pmatrix} ' + latexRows.join(' \\\\ ') + ' \\end{pmatrix}';
    text = text.replace(/MATRIX\s*\[\[[\s\S]+?\]\]/, matrixLatex);
  }
  return text;
}

function handleAbs(text) {
  return text.replace(/ABS\s*\(\s*([^()]+?)\s*\)/g, '\\left| $1 \\right|');
}

function handleAutoParentheses(text) {
  const pairs = [
    [/\(([^()]+)\)/g, '\\left( ', ' \\right)'],
    [/\[([^\[\]]+)\]/g, '\\left[ ', ' \\right]'],
  ];
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 10) {
    changed = false;
    iterations++;
    for (const [regex, left, right] of pairs) {
      const newText = text.replace(regex, (match, group1) => {
        if (/\\\\(left|right|\{|\})/.test(group1)) return match;
        if (group1.includes('\\left') || group1.includes('\\right')) return match;
        if (/^(int|sum|prod|frac|sqrt|begin|end)/.test(group1.trim())) return match;
        if (group1.includes('&') || group1.includes('\\\\')) return match;
        changed = true;
        return left + group1 + right;
      });
      if (newText !== text) text = newText;
    }
  }
  return text;
}

function handleOperators(text) {
  const sortedOps = Object.keys(OPERATOR_MAP).sort((a, b) => b.length - a.length);
  for (const op of sortedOps) {
    const regex = new RegExp(escapeRegExp(op), 'g');
    text = text.replace(regex, OPERATOR_MAP[op]);
  }
  text = text.replace(/(?<!\\left|\\right|\w)\*(?!\w)/g, '\\cdot');
  return text;
}

function handleFunctions(text) {
  const sortedFuncs = Object.keys(FUNCTION_MAP).sort((a, b) => b.length - a.length);
  for (const fn of sortedFuncs) {
    const regex = new RegExp('(^|[^a-zA-Z\\\\])' + escapeRegExp(fn) + '(?=\\s*\\(|\\s|$)', 'g');
    text = text.replace(regex, (m, p1) => p1 + FUNCTION_MAP[fn]);
  }
  return text;
}

function handleKeywords(text) {
  const sortedKeys = Object.keys(KEYWORD_MAP).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    const regex = new RegExp(escapeRegExp(key), 'g');
    text = text.replace(regex, KEYWORD_MAP[key]);
  }
  return text;
}

function parseFormula(raw) {
  if (!raw || !raw.trim()) return '';
  let text = ' ' + raw.trim() + ' ';

  text = handleKeywords(text);
  text = handleMatrix(text);
  text = handleFunctions(text);
  text = handleFrac(text);
  text = handleSqrt(text);
  text = handleIntSumLim(text);
  text = handleAbs(text);
  text = handleBracesSubSup(text);
  text = handleOperators(text);
  text = handleAutoParentheses(text);
  text = handleBracesSubSup(text);

  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

module.exports = { parseFormula };
