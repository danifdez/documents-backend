import { Injectable } from '@nestjs/common';
import { renderHtmlToDocx } from '../common/html-to-docx';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const puppeteer = require('puppeteer');

const MAX_CONCURRENT_PDF_EXPORTS = 2;

@Injectable()
export class DocExportService {
  private activePdfExports = 0;
  private readonly waiters: Array<() => void> = [];

  async renderDocx(html: string): Promise<Buffer> {
    return renderHtmlToDocx(html);
  }

  async renderPdf(html: string): Promise<Buffer> {
    await this.acquirePdfSlot();

    let browser: any = null;
    try {
      const wrappedHtml =
        '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<style>body{font-family:sans-serif;padding:40px;line-height:1.6;' +
        'color:#222}img{max-width:100%}' +
        'table{border-collapse:collapse;width:100%}' +
        'td,th{border:1px solid #ccc;padding:8px}' +
        '</style></head><body>' +
        html +
        '</body></html>';

      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (request: any) => {
        const url = String(request.url());
        if (url === 'about:blank' || url.startsWith('data:')) {
          request.continue();
        } else {
          request.abort();
        }
      });
      await page.setContent(wrappedHtml, { waitUntil: 'domcontentloaded' });
      const pdfUint8 = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
      });
      return Buffer.from(pdfUint8);
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
      this.releasePdfSlot();
    }
  }

  private acquirePdfSlot(): Promise<void> {
    if (this.activePdfExports < MAX_CONCURRENT_PDF_EXPORTS) {
      this.activePdfExports += 1;
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.activePdfExports += 1;
        resolve();
      });
    });
  }

  private releasePdfSlot(): void {
    this.activePdfExports = Math.max(0, this.activePdfExports - 1);
    const next = this.waiters.shift();
    if (next) next();
  }
}
