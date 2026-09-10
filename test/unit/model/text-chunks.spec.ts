import { chunkTextParts } from '../../../src/model/text-chunks';

function words(prefix: string, count: number, terminal = ''): string {
  return (
    Array.from({ length: count }, (_, index) => `${prefix}-${index}`).join(
      ' ',
    ) + terminal
  );
}

describe('text chunks', () => {
  it('keeps paragraphs intact when they fit separately', () => {
    const first = words('first', 900);
    const second = words('second', 700);

    expect(chunkTextParts([{ text: `${first}\n\n${second}` }], 1_500)).toEqual([
      first,
      second,
    ]);
  });

  it('splits an oversized paragraph between complete sentences', () => {
    const first = words('First', 600, '.');
    const second = words('Second', 300, '.');
    const third = words('Third', 600, '.');

    expect(
      chunkTextParts([{ text: `${first} ${second} ${third}` }], 1_000),
    ).toEqual([`${first} ${second}`, third]);
  });

  it('uses a word boundary only when one sentence exceeds the budget', () => {
    const text = words('word', 1_501);
    const chunks = chunkTextParts([{ text }], 1_500);

    expect(chunks.map((chunk) => chunk.split(/\s+/).length)).toEqual([
      1_500, 1,
    ]);
    expect(chunks.join(' ')).toBe(text);
  });
});
