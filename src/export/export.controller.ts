import { Controller, Get, Post, Body, Res, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ExportService } from './export.service';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permission.enum';
import { ExportProjectsDto } from './dto/export.dto';

@Controller('export')
export class ExportController {
  constructor(private readonly exportService: ExportService) { }

  @Get('projects')
  async getProjectsForExport() {
    return await this.exportService.getProjectsForExport();
  }

  @Post()
  @RequirePermissions(Permission.EXPORT)
  async exportProjects(
    @Body() body: ExportProjectsDto,
    @Res() res: Response,
  ) {
    try {
      const {
        projectIds = [],
        includeOriginalFiles = true,
        includeMetadata = true,
        includeContent = true,
      } = body;

      const { stream, filename } = await this.exportService.createExportArchive(
        projectIds,
        includeOriginalFiles,
        includeMetadata,
        includeContent,
      );

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      stream.pipe(res);
    } catch (error) {
      throw new HttpException(
        `Export failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
