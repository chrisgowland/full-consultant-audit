// Shared readability utilities used by both NH and BUPA scorers

export function countSyllables(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return 0;
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches ? matches.length : 1;
}

export function readingEase(text) {
  const words = (text.match(/[A-Za-z]+/g) || []).map(w => w.toLowerCase());
  if (words.length < 10) return 0;
  const sentences = Math.max(1, (text.match(/[.!?]+/g) || []).length);
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const wps = words.length / sentences;
  const spw = syllables / words.length;
  return 206.835 - 1.015 * wps - 84.6 * spw;
}

// NH plain English: 0–5 scale using Flesch ease + word length + explainer phrases
export function plainEnglishScoreNH(aboutText) {
  if (!aboutText || aboutText.trim().length < 20) return 0;
  const ease = readingEase(aboutText);
  const words = aboutText.match(/[A-Za-z]+/g) || [];
  const avgWordLength = words.length === 0 ? 0 :
    words.reduce((sum, w) => sum + w.length, 0) / words.length;
  const hasExplainer = /\b(also known as|which means|for example|such as|this helps|so that)\b/i.test(aboutText);

  let score = 0;
  if (ease >= 60) score += 3;
  else if (ease >= 45) score += 2;
  else if (ease >= 30) score += 1;
  if (avgWordLength > 0 && avgWordLength <= 5.8) score += 1;
  if (hasExplainer) score += 1;
  return Math.max(0, Math.min(5, score));
}

// BUPA plain English: 0–10 scale (3 binary sub-criteria, each worth ~3.3 pts)
export function plainEnglishScoreBUPA(text) {
  if (!text || text.trim().length < 20) return { pass: false, score: 0 };
  const words = text.match(/[A-Za-z]+/g) || [];
  if (words.length < 40) return { pass: false, score: 0 };

  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 3);
  const avgSentenceLength = words.length / Math.max(1, sentences.length);
  const complexWords = words.filter(w => countSyllables(w) >= 3).length;
  const complexRatio = complexWords / words.length;
  const acronyms = (text.match(/\b[A-Z]{2,5}\b/g) || []).length;
  const acronymOk = acronyms <= 3 || (acronyms / (words.length / 60)) <= 1;

  const checks = [avgSentenceLength <= 22, complexRatio <= 0.22, acronymOk];
  const passed = checks.filter(Boolean).length;
  return { pass: passed >= 2, score: Math.round((passed / 3) * 10) };
}
