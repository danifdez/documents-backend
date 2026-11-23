// eslint-disable-next-line @typescript-eslint/no-require-imports
const HTMLtoDOCX = require('@turbodocx/html-to-docx');

export async function renderHtmlToDocx(html: string): Promise<Buffer> {
  const wrappedHtml =
    '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>' +
    html +
    '</body></html>';
  return await HTMLtoDOCX(wrappedHtml, null, {
    table: { row: { cantSplit: true } },
    footer: false,
    header: false,
  });
}
