import { Controller, Get, Post, Body, Param, Patch, Delete, ParseIntPipe, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { BibliographyService } from './bibliography.service';
import { BibliographyEntryEntity } from './bibliography-entry.entity';

@Controller('bibliography')
export class BibliographyController {
  constructor(private readonly bibliographyService: BibliographyService) { }

  @Get()
  async findAll(): Promise<BibliographyEntryEntity[]> {
    return await this.bibliographyService.findAll();
  }

  @Get('global')
  async findGlobal(): Promise<BibliographyEntryEntity[]> {
    return await this.bibliographyService.findGlobal();
  }

  @Get('project/:projectId')
  async findByProject(
    @Param('projectId', ParseIntPipe) projectId: number,
  ): Promise<BibliographyEntryEntity[]> {
    return await this.bibliographyService.findByProject(projectId);
  }

  @Get('export/bibtex')
  async exportBibTeX(
    @Query('projectId') projectId: string,
    @Query('ids') ids: string,
    @Res() res: Response,
  ): Promise<void> {
    const parsedProjectId = projectId ? parseInt(projectId, 10) : undefined;
    const parsedIds = ids ? ids.split(',').map((id) => parseInt(id, 10)) : undefined;
    const bibtex = await this.bibliographyService.exportBibTeX(parsedProjectId, parsedIds);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="bibliography.bib"');
    res.send(bibtex);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<BibliographyEntryEntity | null> {
    return await this.bibliographyService.findOne(id);
  }

  @Post()
  async create(@Body() data: Partial<BibliographyEntryEntity>): Promise<BibliographyEntryEntity> {
    return await this.bibliographyService.create(data);
  }

  @Post('import/resource/:resourceId')
  async importFromResource(
    @Param('resourceId', ParseIntPipe) resourceId: number,
    @Body('projectId') projectId?: number,
  ): Promise<BibliographyEntryEntity> {
    return await this.bibliographyService.importFromResource(resourceId, projectId);
  }

  @Post('import/bibtex')
  async importBibTeX(
    @Body('bibtex') bibtex: string,
    @Body('projectId') projectId?: number,
  ): Promise<BibliographyEntryEntity[]> {
    return await this.bibliographyService.importBibTeX(bibtex, projectId);
  }

  @Patch(':id/make-global')
  async makeGlobal(@Param('id', ParseIntPipe) id: number): Promise<BibliographyEntryEntity | null> {
    return await this.bibliographyService.makeGlobal(id);
  }

  @Patch(':id/assign-project')
  async assignProject(
    @Param('id', ParseIntPipe) id: number,
    @Body('projectId', ParseIntPipe) projectId: number,
  ): Promise<BibliographyEntryEntity | null> {
    return await this.bibliographyService.assignProject(id, projectId);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: Partial<BibliographyEntryEntity>,
  ): Promise<BibliographyEntryEntity | null> {
    return await this.bibliographyService.update(id, data);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.bibliographyService.remove(id);
  }
}
