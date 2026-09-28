function analyzeCode(code, language) {
  const lines = code.split('\n');
  const lineCount = lines.length;

  const cyclomaticComplexity = calculateCyclomaticComplexity(code, language);
  const commentRate = calculateCommentRate(code, language);
  const namingStyle = evaluateNamingStyle(code, language);
  const overallScore = calculateOverallScore(lineCount, cyclomaticComplexity, commentRate, namingStyle);

  return {
    lineCount,
    cyclomaticComplexity,
    commentRate,
    namingStyle,
    overallScore
  };
}

function calculateCyclomaticComplexity(code, language) {
  let complexity = 1;
  const patterns = {
    javascript: /\b(if|for|while|case|catch|&&|\|\||\?|:|else\s+if)\b/g,
    typescript: /\b(if|for|while|case|catch|&&|\|\||\?|:|else\s+if)\b/g,
    python: /\b(if|for|while|elif|except|and|or)\b/g,
    java: /\b(if|for|while|case|catch|&&|\|\||\?|:|else\s+if)\b/g,
    cpp: /\b(if|for|while|case|catch|&&|\|\||\?|:|else\s+if)\b/g,
    c: /\b(if|for|while|case|catch|&&|\|\||\?|:|else\s+if)\b/g,
    go: /\b(if|for|case|select|\|\&&|\|\||\?)\b/g,
    rust: /\b(if|for|while|match|case|\|\&&|\|\||\?)\b/g
  };

  const pattern = patterns[language] || patterns.javascript;
  const matches = code.match(pattern);
  if (matches) {
    complexity += matches.length;
  }

  const functions = code.match(/\bfunction\b|\b=>\b|\bdef\b|\bfunc\b|\bfn\b/g);
  if (functions) {
    complexity += functions.length;
  }

  return Math.min(complexity, 100);
}

function calculateCommentRate(code, language) {
  const lines = code.split('\n');
  let commentLines = 0;
  let inBlockComment = false;

  const commentPatterns = {
    javascript: { line: /^\s*\/\//, blockStart: /^\s*\/\*/, blockEnd: /\*\// },
    typescript: { line: /^\s*\/\//, blockStart: /^\s*\/\*/, blockEnd: /\*\// },
    python: { line: /^\s*#/, blockStart: /^\s*"""/, blockEnd: /"""/ },
    java: { line: /^\s*\/\//, blockStart: /^\s*\/\*/, blockEnd: /\*\// },
    cpp: { line: /^\s*\/\//, blockStart: /^\s*\/\*/, blockEnd: /\*\// },
    c: { line: /^\s*\/\//, blockStart: /^\s*\/\*/, blockEnd: /\*\// },
    go: { line: /^\s*\/\//, blockStart: /^\s*\/\*/, blockEnd: /\*\// },
    rust: { line: /^\s*\/\//, blockStart: /^\s*\/\*/, blockEnd: /\*\// }
  };

  const patterns = commentPatterns[language] || commentPatterns.javascript;

  for (const line of lines) {
    if (inBlockComment) {
      commentLines++;
      if (patterns.blockEnd.test(line)) {
        inBlockComment = false;
      }
    } else if (patterns.blockStart.test(line)) {
      commentLines++;
      inBlockComment = true;
      if (patterns.blockEnd.test(line)) {
        inBlockComment = false;
      }
    } else if (patterns.line.test(line)) {
      commentLines++;
    }
  }

  const totalLines = lines.length || 1;
  return Math.round((commentLines / totalLines) * 100);
}

function evaluateNamingStyle(code, language) {
  let score = 100;
  const camelCase = /\b[a-z][a-zA-Z0-9]*\b/g;
  const PascalCase = /\b[A-Z][a-zA-Z0-9]*\b/g;
  const snake_case = /\b[a-z_][a-z0-9_]*\b/g;
  const SCREAMING_SNAKE_CASE = /\b[A-Z_][A-Z0-9_]*\b/g;
  const badNames = /\b(foo|bar|baz|tmp|temp|test|x|y|z|a|b|c|d|e|f|g|h|i|j|k|l|m|n|o|p|q|r|s|t|u|v|w)\b/g;

  const identifiers = new Set();
  const variablePatterns = [
    /\b(?:const|let|var|let|const)\s+([a-zA-Z_$][\w$]*)/g,
    /\bfunction\s+([a-zA-Z_$][\w$]*)/g,
    /\bclass\s+([a-zA-Z_$][\w$]*)/g,
    /\b(?:def|fn|func)\s+([a-zA-Z_$][\w$]*)/g
  ];

  for (const pattern of variablePatterns) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      identifiers.add(match[1]);
    }
  }

  if (identifiers.size === 0) {
    return 70;
  }

  const idArray = Array.from(identifiers);
  const goodNames = idArray.filter(id => 
    camelCase.test(id) || PascalCase.test(id) || snake_case.test(id) || SCREAMING_SNAKE_CASE.test(id)
  );

  const badMatches = code.match(badNames);
  if (badMatches) {
    score -= Math.min(badMatches.length * 5, 30);
  }

  const shortNames = idArray.filter(id => id.length < 2);
  score -= Math.min(shortNames.length * 3, 20);

  const goodRatio = goodNames.length / idArray.length;
  score = Math.round(score * (0.5 + goodRatio * 0.5));

  return Math.max(0, Math.min(100, score));
}

function calculateOverallScore(lineCount, complexity, commentRate, namingStyle) {
  const lineScore = lineCount <= 50 ? 100 : lineCount <= 100 ? 80 : lineCount <= 200 ? 60 : 40;
  const complexityScore = complexity <= 10 ? 100 : complexity <= 20 ? 80 : complexity <= 30 ? 60 : 40;
  const commentScore = commentRate >= 20 ? 100 : commentRate >= 10 ? 80 : commentRate >= 5 ? 60 : 40;
  const namingScore = namingStyle;

  const overall = Math.round(
    lineScore * 0.2 +
    complexityScore * 0.3 +
    commentScore * 0.25 +
    namingScore * 0.25
  );

  return Math.max(0, Math.min(100, overall));
}

module.exports = { analyzeCode };
