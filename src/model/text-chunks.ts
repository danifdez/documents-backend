export function chunkTextParts(
  textParts: Array<{ text: string }>,
  maxWords: number,
): string[] {
  const units = textParts
    .map(({ text }) => sanitizeText(text).trim())
    .filter(Boolean)
    .flatMap((text) => splitWords(text, maxWords));
  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  for (const unit of units) {
    const unitWords = wordCount(unit);
    if (current.length && currentWords + unitWords > maxWords) {
      chunks.push(current.join('\n\n'));
      current = [];
      currentWords = 0;
    }
    current.push(unit);
    currentWords += unitWords;
  }
  if (current.length) chunks.push(current.join('\n\n'));
  return chunks;
}

function sanitizeText(text: string): string {
  return text
    .replace(/data:[a-zA-Z0-9+./;=-]*;base64,[A-Za-z0-9+/=]+/g, '[image]')
    .replace(/\S{2000,}/g, '[blob]');
}

function splitWords(text: string, maxWords: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  for (let index = 0; index < words.length; index += maxWords) {
    parts.push(words.slice(index, index + maxWords).join(' '));
  }
  return parts;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
