import { Controller, Get, Post, Body, Param, Patch, Delete, ParseIntPipe, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { BibliographyService } from './bibliography.service';
import { BibliographyEntryEntity } from './bibliography-entry.entity';
import { CreateBibliographyEntryDto, UpdateBibliographyEntryDto } from './dto/bibliography-entry.dto';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';

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
  @RequirePermissions(Permission.BIBLIOGRAPHY)
  async create(@Body() dto: CreateBibliographyEntryDto): Promise<BibliographyEntryEntity> {
    return await this.bibliographyService.create(dto);
  }

  @Post('import/resource/:resourceId')
  @RequirePermissions(Permission.BIBLIOGRAPHY)
  async importFromResource(
    @Param('resourceId', ParseIntPipe) resourceId: number,
    @Body('projectId') projectId?: number,
  ): Promise<BibliographyEntryEntity> {
    return await this.bibliographyService.importFromResource(resourceId, projectId);
  }

  @Post('import/bibtex')
  @RequirePermissions(Permission.BIBLIOGRAPHY)
  async importBibTeX(
    @Body('bibtex') bibtex: string,
    @Body('projectId') projectId?: number,
  ): Promise<BibliographyEntryEntity[]> {
    return await this.bibliographyService.importBibTeX(bibtex, projectId);
  }

  @Patch(':id/make-global')
  @RequirePermissions(Permission.BIBLIOGRAPHY)
  async makeGlobal(@Param('id', ParseIntPipe) id: number): Promise<BibliographyEntryEntity | null> {
    return await this.bibliographyService.makeGlobal(id);
  }

  @Patch(':id/assign-project')
  @RequirePermissions(Permission.BIBLIOGRAPHY)
  async assignProject(
    @Param('id', ParseIntPipe) id: number,
    @Body('projectId', ParseIntPipe) projectId: number,
  ): Promise<BibliographyEntryEntity | null> {
    return await this.bibliographyService.assignProject(id, projectId);
  }

  @Patch(':id')
  @RequirePermissions(Permission.BIBLIOGRAPHY)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBibliographyEntryDto,
  ): Promise<BibliographyEntryEntity | null> {
    return await this.bibliographyService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.BIBLIOGRAPHY)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return await this.bibliographyService.remove(id);
  }
}
