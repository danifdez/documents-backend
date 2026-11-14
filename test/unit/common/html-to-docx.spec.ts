import { renderHtmlToDocx } from '../../../src/common/html-to-docx';

jest.mock('html-to-docx', () => jest.fn());

// eslint-disable-next-line @typescript-eslint/no-require-imports
const HTMLtoDOCX = require('html-to-docx') as jest.Mock;

describe('renderHtmlToDocx', () => {
  beforeEach(() => {
    HTMLtoDOCX.mockReset();
  });

  it('uses the existing document wrapper and conversion options', async () => {
    const docx = Buffer.from('docx');
    HTMLtoDOCX.mockResolvedValue(docx);

    await expect(renderHtmlToDocx('<p>Hello</p>')).resolves.toBe(docx);

    expect(HTMLtoDOCX).toHaveBeenCalledWith(
      '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>Hello</p></body></html>',
      null,
      {
        table: { row: { cantSplit: true } },
        footer: false,
        header: false,
      },
    );
  });
});
