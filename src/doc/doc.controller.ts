import { Controller, Get, Post, Body, Param, Patch, Delete, ParseIntPipe, Res, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { DocService } from './doc.service';
import { DocIngestService } from './doc-ingest.service';
import { DocEntity } from 'src/doc/doc.entity';
import { CreateDocDto, UpdateDocDto } from './dto/doc.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const HTMLtoDOCX = require('html-to-docx');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const puppeteer = require('puppeteer');

@Controller('docs')
export class DocController {
  constructor(
    private readonly docService: DocService,
    private readonly docIngestService: DocIngestService,
  ) { }

  @Get(':id/export/docx')
  async exportDocx(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const doc = await this.docService.findOne(id);
    if (!doc) {
      throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    }

    const html = doc.content || '<p></p>';
    const wrappedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
    const docxBuffer = await HTMLtoDOCX(wrappedHtml, null, {
      table: { row: { cantSplit: true } },
      footer: false,
      header: false,
    });

    const safeName = (doc.name || 'document').replace(/[^\w\s.-]/g, '_').trim() || 'document';
    const encodedName = encodeURIComponent(doc.name || 'document');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"; filename*=UTF-8''${encodedName}.docx`);
    res.send(docxBuffer);
  }

  @Get(':id/export/pdf')
  async exportPdf(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const doc = await this.docService.findOne(id);
    if (!doc) {
      throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    }

    const html = doc.content || '<p></p>';
    const wrappedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;padding:40px;line-height:1.6;color:#222}img{max-width:100%}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:8px}</style></head><body>${html}</body></html>`;

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setContent(wrappedHtml, { waitUntil: 'networkidle0' });
      const pdfUint8 = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' } });
      const pdfBuffer = Buffer.from(pdfUint8);

      const safeName = (doc.name || 'document').replace(/[^\w\s.-]/g, '_').trim() || 'document';
      const encodedName = encodeURIComponent(doc.name || 'document');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"; filename*=UTF-8''${encodedName}.pdf`);
      res.end(pdfBuffer);
    } finally {
      await browser.close();
    }
  }

  @Get(':id')
  async getId(@Param('id', ParseIntPipe) id: number): Promise<DocEntity | null> {
    return await this.docService.findOne(id);
  }

  @Get('thread/:threadId')
  async getByThread(
    @Param('threadId', ParseIntPipe) threadId: number,
  ): Promise<DocEntity[]> {
    return await this.docService.findByThread(threadId);
  }

  @Get('project/:projectId')
  async getByProject(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<DocEntity[]> {
    return await this.docService.findByProject(projectId);
  }

  @Get('resource/:resourceId')
  async getByResource(
    @Param('resourceId', ParseIntPipe) resourceId: number,
  ): Promise<DocEntity | null> {
    return await this.docService.findByResource(resourceId);
  }

  @Post()
  @RequirePermissions(Permission.DOCUMENTS)
  async create(@Body() dto: CreateDocDto): Promise<DocEntity> {
    return await this.docService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.DOCUMENTS)
  async update(
    @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDocDto): Promise<DocEntity | null> {
    const updated = await this.docService.update(id, dto);

    if (updated && dto.content !== undefined) {
      const fullDoc = await this.docService.findOneWithProject(id);
      if (fullDoc) {
        this.docIngestService.scheduleIngest(id, fullDoc.project?.id, dto.content);
      }
    }

    return updated;
  }

  @Delete(':id')
  @RequirePermissions(Permission.DOCUMENTS)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.docService.remove(id);
  }
}
