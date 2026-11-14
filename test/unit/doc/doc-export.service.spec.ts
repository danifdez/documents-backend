import { DocExportService } from '../../../src/doc/doc-export.service';
import { renderHtmlToDocx } from '../../../src/common/html-to-docx';

jest.mock('../../../src/common/html-to-docx', () => ({
  renderHtmlToDocx: jest.fn(),
}));
jest.mock('puppeteer', () => ({ launch: jest.fn() }));

const renderHtmlToDocxMock = renderHtmlToDocx as jest.Mock;

describe('DocExportService', () => {
  beforeEach(() => {
    renderHtmlToDocxMock.mockReset();
  });

  it('delegates DOCX rendering to the shared converter', async () => {
    const docx = Buffer.from('docx');
    renderHtmlToDocxMock.mockResolvedValue(docx);
    const service = new DocExportService();

    await expect(service.renderDocx('<p>Hello</p>')).resolves.toBe(docx);

    expect(renderHtmlToDocxMock).toHaveBeenCalledWith('<p>Hello</p>');
  });
});
