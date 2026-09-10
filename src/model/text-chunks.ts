export function chunkTextParts(
  textParts: Array<{ text: string }>,
  maxWords: number,
): string[] {
  const units = textParts
    .map(({ text }) => sanitizeText(text).trim())
    .filter(Boolean)
    .flatMap((text) => splitText(text, maxWords));
  return packUnits(units, maxWords, '\n\n');
}

function splitText(text: string, maxWords: number): string[] {
  return text
    .split(/\r?\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .flatMap((paragraph) =>
      wordCount(paragraph) <= maxWords
        ? [paragraph]
        : splitLongParagraph(paragraph, maxWords),
    );
}

function splitLongParagraph(paragraph: string, maxWords: number): string[] {
  const Segmenter = (Intl as any).Segmenter;
  if (typeof Segmenter !== 'function') return splitWords(paragraph, maxWords);

  const segmenter = new Segmenter(undefined, { granularity: 'sentence' });
  const sentences = Array.from(
    segmenter.segment(paragraph),
    ({ segment }: { segment: string }) => segment.trim(),
  ).filter(Boolean);
  const units = sentences.flatMap((sentence) =>
    wordCount(sentence) <= maxWords
      ? [sentence]
      : splitWords(sentence, maxWords),
  );
  return packUnits(units, maxWords, ' ');
}

function packUnits(
  units: string[],
  maxWords: number,
  separator: string,
): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  for (const unit of units) {
    const unitWords = wordCount(unit);
    if (current.length && currentWords + unitWords > maxWords) {
      chunks.push(current.join(separator));
      current = [];
      currentWords = 0;
    }
    current.push(unit);
    currentWords += unitWords;
  }
  if (current.length) chunks.push(current.join(separator));
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
