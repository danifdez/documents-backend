import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  ParseIntPipe,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { DocService } from './doc.service';
import { DocIngestService } from './doc-ingest.service';
import { DocExportService } from './doc-export.service';
import { DocEntity } from 'src/doc/doc.entity';
import { CreateDocDto, UpdateDocDto } from './dto/doc.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

@Controller('docs')
export class DocController {
  constructor(
    private readonly docService: DocService,
    private readonly docIngestService: DocIngestService,
    private readonly docExportService: DocExportService,
  ) {}

  @Get(':id/export/docx')
  @RequirePermissions(Permission.EXPORT)
  async exportDocx(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const doc = await this.docService.findOne(id);
    if (!doc) {
      throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    }

    const html = doc.content || '<p></p>';
    const docxBuffer = await this.docExportService.renderDocx(html);

    const safeName =
      (doc.name || 'document').replace(/[^\w\s.-]/g, '_').trim() || 'document';
    const encodedName = encodeURIComponent(doc.name || 'document');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName}.docx"; filename*=UTF-8''${encodedName}.docx`,
    );
    res.send(docxBuffer);
  }

  @Get(':id/export/pdf')
  @RequirePermissions(Permission.EXPORT)
  async exportPdf(@Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const doc = await this.docService.findOne(id);
    if (!doc) {
      throw new HttpException('Document not found', HttpStatus.NOT_FOUND);
    }

    const html = doc.content || '<p></p>';
    const pdfBuffer = await this.docExportService.renderPdf(html);

    const safeName =
      (doc.name || 'document').replace(/[^\w\s.-]/g, '_').trim() || 'document';
    const encodedName = encodeURIComponent(doc.name || 'document');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName}.pdf"; filename*=UTF-8''${encodedName}.pdf`,
    );
    res.end(pdfBuffer);
  }

  @Get(':id')
  async getId(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<DocEntity | null> {
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
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDocDto,
  ): Promise<DocEntity | null> {
    const updated = await this.docService.update(id, dto);

    if (updated && dto.content !== undefined) {
      const fullDoc = await this.docService.findOneWithProject(id);
      if (fullDoc) {
        this.docIngestService.scheduleIngest(
          id,
          fullDoc.project?.id,
          dto.content,
        );
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
